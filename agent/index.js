// CloudDeck PC agent entry point.
//
// Connects to the Railway WebSocket, registers itself, then services commands
// from the browser (which Railway forwards on its behalf). Also pushes
// telemetry on an interval and notifies on events (game launch/end, screenshot
// added, crash, update available, etc.).

import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config } from './config.js';
import { Library } from './library.js';
import { Launcher } from './launcher.js';
import { SunshineClient } from './sunshine.js';
import { DisplayManager } from './display.js';
import { InputManager } from './input.js';
import { Stats } from './stats.js';
import { ScreenshotWatcher } from './screenshots.js';
import { Audio } from './audio.js';
import { SleepManager } from './sleep.js';
import { Resume } from './resume.js';
import { Updater } from './updater.js';
import { Notifications } from './notifications.js';

// Allow self-signed certs from local Sunshine
if (config.sunshine.url.startsWith('https://localhost')) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// ---- Bootstrap subsystems ----
const library = new Library();
const sunshine = new SunshineClient(config.sunshine);
const display = new DisplayManager({ sunshine });
const input = new InputManager();
const stats = new Stats();
const audio = new Audio();
const screenshots = new ScreenshotWatcher({
  onNew: shot => send({ type: 'screenshot-added', payload: shot }),
});
const notifications = new Notifications({
  onNotification: note => send({ type: 'notification', payload: note }),
});
const sleepMgr = new SleepManager({
  onPromptUser: ctx => send({ type: 'scheduled-sleep-prompt', payload: ctx }),
  onAutoSleep: () => sleepMgr.sleepNow().catch(err => console.error(err)),
});
const resume = new Resume({ library });
const updater = new Updater({
  currentVersion: pkg.version,
  onUpdateAvailable: info => send({ type: 'update-available', payload: info }),
});

const launcher = new Launcher({
  onLaunched: ({ game, pid }) => {
    send({ type: 'game-launched', payload: { gameId: game.id, name: game.name, pid } });
  },
  onEnded: async info => {
    send({
      type: 'game-ended',
      payload: {
        gameId: info.game.id,
        name: info.game.name,
        durationSeconds: info.durationSeconds,
        clean: info.clean,
        exitCode: info.exitCode,
      },
    });
    if (!info.clean) {
      send({
        type: 'crash',
        payload: { gameId: info.game.id, exitCode: info.exitCode, name: info.game.name },
      });
    }
    if (config.muteSpeakers) await audio.restoreSpeakers().catch(() => {});
    await display.deactivateVirtual().catch(() => {});
    sleepMgr.onSessionEnded();
  },
});

// ---- WebSocket loop ----
let ws = null;
let reconnectAt = config.reconnectMinMs;
let connected = false;
const pending = new Map();
let statsTimer = null;
let heartbeatTimer = null;

function connect() {
  const url = `${config.railwayUrl.replace(/\/+$/, '')}/ws/agent?token=${encodeURIComponent(config.agentToken)}`;
  console.log(`[agent] connecting to ${url.replace(config.agentToken, '***')}`);
  ws = new WebSocket(url, {
    perMessageDeflate: false,
    handshakeTimeout: 10000,
  });

  ws.on('open', () => {
    connected = true;
    reconnectAt = config.reconnectMinMs;
    console.log('[agent] connected');
    send({
      type: 'agent-info',
      payload: {
        version: pkg.version,
        os: `${os.type()} ${os.release()}`,
        hostname: os.hostname(),
        cpus: os.cpus().length,
        memTotal: os.totalmem(),
        startedAt: Date.now(),
      },
    });
    startTelemetry();
  });

  ws.on('message', raw => handleMessage(raw));

  ws.on('close', () => {
    connected = false;
    stopTelemetry();
    scheduleReconnect();
  });

  ws.on('error', err => {
    console.warn('[agent] socket error:', err.message);
  });
}

function scheduleReconnect() {
  const delay = reconnectAt;
  reconnectAt = Math.min(config.reconnectMaxMs, Math.round(reconnectAt * 1.7));
  console.log(`[agent] reconnecting in ${delay}ms`);
  setTimeout(connect, delay);
}

function send(msg) {
  if (!connected) return;
  try { ws.send(JSON.stringify(msg)); }
  catch (err) { console.warn('[agent] send failed:', err.message); }
}

async function handleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  // Internal types
  if (msg.type === 'hello') return;
  if (msg.type === 'heartbeat-ack') return;
  if (msg.type === 'pong') return;

  const { type, id, payload, expectsReply, from } = msg;

  try {
    const result = await dispatch(type, payload, { from });
    if (expectsReply && id) {
      send({ replyTo: id, payload: result });
    }
  } catch (err) {
    console.warn(`[agent] command ${type} failed:`, err.message);
    if (expectsReply && id) {
      send({ replyTo: id, error: err.message });
    }
  }
}

async function dispatch(type, payload = {}, { from } = {}) {
  switch (type) {
    case 'library-fetch':
      return library.fetch({ refresh: !!payload.refresh });

    case 'library-refresh':
      return library.fetch({ refresh: true });

    case 'launch-game': {
      const games = (await library.fetch()).games;
      const game = games.find(g => g.id === payload.gameId);
      if (!game) throw new Error('Game not found');
      // Optionally apply stream config from the client first
      if (payload.streamConfig) {
        const [w, h] = parseResolution(payload.streamConfig.resolution || '1080p');
        await display.activateVirtual({ width: w, height: h, fps: payload.streamConfig.fps || 60 });
      }
      if (config.muteSpeakers) await audio.muteSpeakers().catch(() => {});
      return launcher.launch(game);
    }

    case 'close-game':
      return launcher.close({ userInitiated: true });

    case 'set-stream-config': {
      const [w, h] = parseResolution(payload.resolution || '1080p');
      return sunshine.applyStreamConfig({
        width: w,
        height: h,
        fps: payload.fps || 60,
        bitrate: payload.bitrate || 20000,
      });
    }

    case 'check-resume-game':
      return { detected: await resume.detectRunningGame() };

    case 'sleep-pc':
      await launcher.close({ userInitiated: true }).catch(() => {});
      await display.deactivateVirtual().catch(() => {});
      await audio.restoreSpeakers().catch(() => {});
      return sleepMgr.sleepNow();

    case 'set-sleep-schedule':
      sleepMgr.setSchedule(payload);
      return { ok: true };

    case 'defer-sleep':
      sleepMgr.defer();
      return { ok: true };

    case 'remote-desktop-start':
      await display.activateVirtual({
        width: payload.width || 1920,
        height: payload.height || 1080,
        fps: payload.fps || 60,
      });
      return { ok: true, streamUrl: sunshine.browserStreamUrl(config.sunshine.browserStreamUrl) };

    case 'remote-desktop-stop':
      return display.deactivateVirtual();

    case 'remote-desktop-input':
      if (!config.enableRemoteDesktop) {
        throw new Error('Remote desktop disabled by config');
      }
      return input.handle(payload);

    case 'screenshot-list':
      return { screenshots: await screenshots.list() };

    case 'screenshot-fetch':
      return screenshots.fetch(payload.id);

    case 'stats-snapshot':
      return stats.snapshot();

    case 'sunshine-status':
      return sunshine.health();

    case 'agent-update-check':
      return updater.check();

    case 'agent-update-now': {
      const info = await updater.check();
      if (!info) return { ok: true, message: 'No update available' };
      const download = await updater.download(info);
      // After this the process exits; the browser will see the disconnect.
      await updater.applyAndRestart(download.path);
      return { ok: true, applying: true };
    }

    case 'ping':
      return { t: Date.now() };

    default:
      throw new Error(`Unknown command: ${type}`);
  }
}

function parseResolution(spec) {
  if (typeof spec === 'string') {
    const m = /^(\d+)x(\d+)$/.exec(spec);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    const presets = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160] };
    return presets[spec.toLowerCase()] || presets['1080p'];
  }
  return [1920, 1080];
}

function startTelemetry() {
  stopTelemetry();
  statsTimer = setInterval(async () => {
    try {
      const snap = await stats.snapshot();
      send({ type: 'stats', payload: snap });
    } catch (err) {
      console.warn('[agent] stats snapshot failed:', err.message);
    }
  }, config.statsIntervalMs);
  statsTimer.unref?.();

  heartbeatTimer = setInterval(() => send({ type: 'heartbeat', payload: { t: Date.now() } }), config.heartbeatIntervalMs);
  heartbeatTimer.unref?.();
}

function stopTelemetry() {
  clearInterval(statsTimer);
  clearInterval(heartbeatTimer);
  statsTimer = heartbeatTimer = null;
}

// ---- Boot ----
console.log(`[CloudDeck agent v${pkg.version}] starting`);
console.log(`[CloudDeck agent] Sunshine: ${config.sunshine.url}`);
console.log(`[CloudDeck agent] Railway:  ${config.railwayUrl}`);

await screenshots.start().catch(err => console.warn('[agent] screenshots disabled:', err.message));
await notifications.start().catch(err => console.warn('[agent] notifications disabled:', err.message));
updater.start();

connect();

// ---- Shutdown ----
async function shutdown() {
  console.log('[agent] shutting down…');
  await launcher.close({ userInitiated: true }).catch(() => {});
  await screenshots.stop().catch(() => {});
  updater.stop();
  if (ws) ws.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
