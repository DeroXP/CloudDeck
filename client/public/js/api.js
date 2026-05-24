// REST + WebSocket client. Wraps the same protocol the agent uses on the
// other end (see ws-bridge.js + agent/index.js).

const json = r => r.json().catch(() => null);

export const api = {
  async health() {
    return fetch('/api/health').then(json);
  },
  async config() {
    return fetch('/api/public-config').then(json);
  },
  async me() {
    const r = await fetch('/api/me', { credentials: 'include' });
    if (!r.ok) return null;
    return (await r.json()).user;
  },
  async logout() {
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },
  async library() {
    return fetch('/api/library', { credentials: 'include' }).then(json);
  },
  async lastPlayed() {
    return fetch('/api/last-played', { credentials: 'include' }).then(json);
  },
  async sessions() {
    return fetch('/api/sessions', { credentials: 'include' }).then(json);
  },
  async gameStats(gameId) {
    return fetch(`/api/game-stats/${encodeURIComponent(gameId)}`, { credentials: 'include' }).then(json);
  },
  async recordSession(body) {
    return fetch('/api/sessions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json);
  },
  async screenshots() {
    return fetch('/api/screenshots', { credentials: 'include' }).then(json);
  },
  async wake() {
    return fetch('/api/wake', { method: 'POST', credentials: 'include' }).then(json);
  },
  async deviceSettings(deviceId) {
    return fetch(`/api/settings/device/${encodeURIComponent(deviceId)}`, { credentials: 'include' }).then(json);
  },
  async saveDeviceSettings(deviceId, settings) {
    return fetch(`/api/settings/device/${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).then(json);
  },
  async sleepSchedule() {
    return fetch('/api/settings/sleep-schedule', { credentials: 'include' }).then(json);
  },
  async saveSleepSchedule(schedule) {
    return fetch('/api/settings/sleep-schedule', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule),
    }).then(json);
  },
  async users() {
    return fetch('/api/users', { credentials: 'include' }).then(json);
  },
  async createUser(body) {
    return fetch('/api/users', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json);
  },
  async deleteUser(id) {
    return fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' }).then(json);
  },
};

// ---- Realtime WebSocket ----
export class Realtime extends EventTarget {
  constructor({ url, deviceId }) {
    super();
    this.url = url;
    this.deviceId = deviceId;
    this.ws = null;
    this.reconnectAt = 1000;
    this.pending = new Map();
    this.lastPingAt = 0;
    this.pingStart = 0;
    this.pingMs = null;
    this.pingHistory = [];   // last ~20 samples for jitter calc
    this.connected = false;
  }

  connect(token) {
    const u = new URL(this.url);
    u.searchParams.set('token', token);
    u.searchParams.set('device', this.deviceId);
    this.ws = new WebSocket(u.toString());

    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.reconnectAt = 1000;
      this.dispatchEvent(new Event('open'));
      this._startPing();
    });

    this.ws.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._handle(msg);
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this._stopPing();
      this.dispatchEvent(new Event('close'));
      setTimeout(() => this.connect(token), this.reconnectAt);
      this.reconnectAt = Math.min(30000, Math.round(this.reconnectAt * 1.7));
    });
  }

  _handle(msg) {
    if (msg.type === 'client-pong' && msg.payload?.t) {
      this.pingMs = Date.now() - this.pingStart;
      this.pingHistory.push(this.pingMs);
      if (this.pingHistory.length > 30) this.pingHistory.shift();
      this.dispatchEvent(new CustomEvent('ping', { detail: { ping: this.pingMs, jitter: this._jitter() } }));
      return;
    }
    if (msg.replyTo && this.pending.has(msg.replyTo)) {
      const { resolve, reject, timer } = this.pending.get(msg.replyTo);
      clearTimeout(timer);
      this.pending.delete(msg.replyTo);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.payload);
      return;
    }
    this.dispatchEvent(new CustomEvent('msg', { detail: msg }));
    this.dispatchEvent(new CustomEvent(`msg:${msg.type}`, { detail: msg.payload || {} }));
  }

  _jitter() {
    if (this.pingHistory.length < 2) return 0;
    const diffs = [];
    for (let i = 1; i < this.pingHistory.length; i++) {
      diffs.push(Math.abs(this.pingHistory[i] - this.pingHistory[i - 1]));
    }
    return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  }

  send(msg) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendCommand(type, payload, { timeoutMs = 15000 } = {}) {
    if (!this.connected) return Promise.reject(new Error('Not connected'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command ${type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ target: 'agent', type, id, payload, expectsReply: true });
    });
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.connected) return;
      this.pingStart = Date.now();
      this.send({ type: 'client-ping', id: crypto.randomUUID() });
    }, 2000);
  }
  _stopPing() { clearInterval(this.pingTimer); }
}
