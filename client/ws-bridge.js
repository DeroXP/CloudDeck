// WebSocket signaling bridge.
//
// Two kinds of connections:
//   - Agent (PC): authenticated with AGENT_TOKEN, registers itself as `agent:<id>`.
//     For now we support a single primary agent; the protocol is forward-compatible
//     with multiple agents per deployment.
//   - Browser: authenticated with a JWT access token, registers as `client:<userId>:<deviceId>`.
//
// Messages are JSON envelopes:
//   { type, id?, payload?, replyTo? }
//
// Browser → agent commands are routed through this bridge: the browser sends a
// message with `target: 'agent'`, the bridge forwards to the active agent, and
// any `replyTo` echo is routed back to the originating browser by `id`.
//
// Agent → all-browsers events (status, stats, library, screenshot-added, etc.)
// are broadcast to every connected browser for that user.

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

export class WSBridge {
  constructor({ server, auth, store, agentToken, logger = console }) {
    this.auth = auth;
    this.store = store;
    this.agentToken = agentToken;
    this.logger = logger;

    this.agents = new Map();   // agentId -> { ws, info, lastHeartbeat }
    this.clients = new Map();  // clientId -> { ws, userId, deviceId, role }
    this.pendingReplies = new Map(); // messageId -> clientId

    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => this._handleUpgrade(req, socket, head));

    this.wss.on('connection', (ws, req, ctx) => this._handleConnection(ws, req, ctx));

    this._startHeartbeat();
  }

  // ---- Public: send a server-originated event to all browsers ----
  broadcastToBrowsers(payload, filter = null) {
    for (const [, client] of this.clients) {
      if (filter && !filter(client)) continue;
      this._send(client.ws, payload);
    }
  }

  // Send to all browsers of a specific user
  notifyUser(userId, payload) {
    this.broadcastToBrowsers(payload, c => c.userId === userId);
  }

  // True if any PC agent is currently connected
  hasAgent() {
    return this.agents.size > 0;
  }

  primaryAgent() {
    const first = this.agents.values().next();
    return first.done ? null : first.value;
  }

  // Issue a command to the active agent. Returns a promise that resolves with
  // the agent's reply, or rejects on timeout / no agent.
  sendToAgent(type, payload, { timeoutMs = 10000 } = {}) {
    const agent = this.primaryAgent();
    if (!agent) return Promise.reject(new Error('No agent connected'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(id);
        reject(new Error(`Agent command ${type} timed out`));
      }, timeoutMs);
      this.pendingReplies.set(id, { resolve, reject, timer, internal: true });
      this._send(agent.ws, { type, id, payload, expectsReply: true });
    });
  }

  // ---- Lifecycle ----
  _handleUpgrade(req, socket, head) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (path === '/ws/agent') {
      const token = url.searchParams.get('token') || req.headers['x-agent-token'];
      if (token !== this.agentToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, ws => {
        this.wss.emit('connection', ws, req, { kind: 'agent' });
      });
      return;
    }

    if (path === '/ws/client') {
      const token = url.searchParams.get('token');
      const payload = token && this.auth.verifyAccessToken(token);
      if (!payload) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const deviceId = url.searchParams.get('device') || randomUUID();
      this.wss.handleUpgrade(req, socket, head, ws => {
        this.wss.emit('connection', ws, req, {
          kind: 'client',
          userId: payload.sub,
          username: payload.username,
          role: payload.role,
          deviceId,
        });
      });
      return;
    }

    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }

  _handleConnection(ws, req, ctx) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    if (ctx.kind === 'agent') {
      this._registerAgent(ws);
    } else {
      this._registerClient(ws, ctx);
    }
  }

  _registerAgent(ws) {
    const agentId = randomUUID();
    const record = {
      id: agentId,
      ws,
      info: null,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now(),
    };
    this.agents.set(agentId, record);
    this.logger.info?.(`[ws] agent connected: ${agentId}`);

    this._broadcastPcStatus('online');

    ws.on('message', raw => this._handleAgentMessage(record, raw));
    ws.on('close', () => {
      this.agents.delete(agentId);
      this.logger.info?.(`[ws] agent disconnected: ${agentId}`);
      if (this.agents.size === 0) this._broadcastPcStatus('offline');
    });
    ws.on('error', err => this.logger.error?.(`[ws] agent error:`, err));

    // Tell the agent who's already watching
    this._send(ws, {
      type: 'hello',
      payload: {
        clientsConnected: this.clients.size,
        serverTime: Date.now(),
      },
    });
  }

  _registerClient(ws, ctx) {
    const clientId = randomUUID();
    const record = {
      id: clientId,
      ws,
      userId: ctx.userId,
      username: ctx.username,
      role: ctx.role,
      deviceId: ctx.deviceId,
      connectedAt: Date.now(),
    };
    this.clients.set(clientId, record);
    this.logger.info?.(`[ws] client connected: ${ctx.username} (${ctx.role})`);

    // Send current PC status immediately
    this._send(ws, {
      type: 'pc-status',
      payload: { online: this.hasAgent() },
    });

    ws.on('message', raw => this._handleClientMessage(record, raw));
    ws.on('close', () => {
      this.clients.delete(clientId);
      this.logger.info?.(`[ws] client disconnected: ${ctx.username}`);
    });
    ws.on('error', err => this.logger.error?.(`[ws] client error:`, err));
  }

  _handleAgentMessage(agent, raw) {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return; }

    agent.lastHeartbeat = Date.now();

    // Reply to a previously-sent command from a browser, or from us internally
    if (msg.replyTo) {
      const pending = this.pendingReplies.get(msg.replyTo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingReplies.delete(msg.replyTo);
        if (pending.internal) {
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.payload);
        } else {
          const client = this.clients.get(pending.clientId);
          if (client) this._send(client.ws, msg);
        }
      }
      return;
    }

    switch (msg.type) {
      case 'agent-info':
        agent.info = msg.payload;
        return;
      case 'heartbeat':
        // already updated lastHeartbeat
        this._send(agent.ws, { type: 'heartbeat-ack', payload: { t: Date.now() } });
        return;
      case 'stats':
      case 'library':
      case 'game-launched':
      case 'game-ended':
      case 'screenshot-added':
      case 'notification':
      case 'session-ended':
      case 'update-available':
      case 'crash':
      case 'resume-game':
      case 'handoff-detected':
        // Broadcast to all browsers
        this.broadcastToBrowsers(msg);
        return;
      case 'log':
        this.logger.info?.(`[agent] ${msg.payload?.message}`);
        return;
      default:
        this.logger.warn?.(`[ws] unknown agent message type: ${msg.type}`);
    }
  }

  _handleClientMessage(client, raw) {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return; }

    // Browser → agent command relay
    if (msg.target === 'agent') {
      if (!this.hasAgent()) {
        return this._send(client.ws, {
          type: 'error',
          id: msg.id,
          payload: { error: 'PC agent is not connected' },
        });
      }
      // Guests can browse and launch but cannot do admin actions
      if (client.role !== 'admin' && this._isAdminCommand(msg.type)) {
        return this._send(client.ws, {
          type: 'error',
          id: msg.id,
          payload: { error: 'Admin role required for this action' },
        });
      }
      const agent = this.primaryAgent();
      const forwardId = msg.id || randomUUID();
      if (msg.expectsReply) {
        this.pendingReplies.set(forwardId, { clientId: client.id });
      }
      this._send(agent.ws, {
        type: msg.type,
        id: forwardId,
        payload: msg.payload,
        expectsReply: !!msg.expectsReply,
        from: { userId: client.userId, deviceId: client.deviceId, role: client.role },
      });
      return;
    }

    // Client-only ping for ping-widget
    if (msg.type === 'client-ping') {
      this._send(client.ws, { type: 'client-pong', id: msg.id, payload: { t: Date.now() } });
      return;
    }
  }

  _isAdminCommand(type) {
    return [
      'sleep-pc',
      'wake-pc',
      'remote-desktop-input',
      'remote-desktop-start',
      'remote-desktop-stop',
      'set-sleep-schedule',
      'set-stream-config',
      'agent-update-now',
      'reset-config',
    ].includes(type);
  }

  _broadcastPcStatus(status) {
    this.broadcastToBrowsers({
      type: 'pc-status',
      payload: { online: status === 'online' },
    });
  }

  _send(ws, msg) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, agent] of this.agents) {
        if (!agent.ws.isAlive) {
          agent.ws.terminate();
          this.agents.delete(id);
          continue;
        }
        agent.ws.isAlive = false;
        agent.ws.ping();
      }
      for (const [id, client] of this.clients) {
        if (!client.ws.isAlive) {
          client.ws.terminate();
          this.clients.delete(id);
          continue;
        }
        client.ws.isAlive = false;
        client.ws.ping();
      }
    }, 30000);
    this.heartbeatTimer.unref?.();
  }

  shutdown() {
    clearInterval(this.heartbeatTimer);
    for (const [, agent] of this.agents) agent.ws.close();
    for (const [, client] of this.clients) client.ws.close();
    this.wss.close();
  }
}
