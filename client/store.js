// File-based JSON persistence. Small enough for a household-scale deployment;
// swap for SQLite later if you outgrow it. Each "table" is its own JSON file
// loaded into memory on boot and flushed on every write.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const TABLES = {
  users: [],
  sessions: [],
  refreshTokens: [],
  lastPlayed: {},        // { userId: [{ gameId, platform, name, art, playedAt }, ...] }
  deviceSettings: {},    // { userId: { deviceId: { resolution, fps, bitrate, ... } } }
  sleepSchedule: {},     // { userId: { time: "00:00", days: [0..6], enabled: bool } }
  config: {},            // { onboardingComplete, sunshineReachable, piConfigured, ... }
};

export class Store {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.data = JSON.parse(JSON.stringify(TABLES));
    this.writeQueue = new Map();
    this.flushTimers = new Map();
  }

  async init() {
    if (!fsSync.existsSync(this.dataDir)) {
      await fs.mkdir(this.dataDir, { recursive: true });
    }
    for (const table of Object.keys(TABLES)) {
      const file = path.join(this.dataDir, `${table}.json`);
      try {
        const raw = await fs.readFile(file, 'utf8');
        this.data[table] = JSON.parse(raw);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        await this._flush(table);
      }
    }
  }

  // Debounced flush — coalesce bursts of writes to a single disk hit.
  _scheduleFlush(table) {
    if (this.flushTimers.has(table)) return;
    const timer = setTimeout(async () => {
      this.flushTimers.delete(table);
      await this._flush(table);
    }, 50);
    this.flushTimers.set(table, timer);
  }

  async _flush(table) {
    const file = path.join(this.dataDir, `${table}.json`);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data[table], null, 2));
    await fs.rename(tmp, file);
  }

  async flushAll() {
    for (const table of Object.keys(this.data)) {
      await this._flush(table);
    }
  }

  // ---- Users ----
  getUsers() { return this.data.users; }
  getUserById(id) { return this.data.users.find(u => u.id === id); }
  getUserByUsername(username) {
    const lc = username.toLowerCase();
    return this.data.users.find(u => u.username.toLowerCase() === lc);
  }
  upsertUser(user) {
    const idx = this.data.users.findIndex(u => u.id === user.id);
    if (idx >= 0) this.data.users[idx] = user;
    else this.data.users.push(user);
    this._scheduleFlush('users');
  }
  deleteUser(id) {
    this.data.users = this.data.users.filter(u => u.id !== id);
    this._scheduleFlush('users');
  }

  // ---- Sessions (gameplay sessions, for history) ----
  addSession(session) {
    this.data.sessions.push(session);
    // Cap to last 10k entries to keep file size manageable
    if (this.data.sessions.length > 10000) {
      this.data.sessions = this.data.sessions.slice(-10000);
    }
    this._scheduleFlush('sessions');
  }
  getSessions(userId) {
    return this.data.sessions.filter(s => s.userId === userId);
  }
  getRecentSessions(userId, n = 50) {
    return this.getSessions(userId).slice(-n).reverse();
  }

  // ---- Refresh tokens ----
  addRefreshToken(record) {
    this.data.refreshTokens.push(record);
    this._scheduleFlush('refreshTokens');
  }
  findRefreshToken(token) {
    return this.data.refreshTokens.find(r => r.token === token);
  }
  revokeRefreshToken(token) {
    this.data.refreshTokens = this.data.refreshTokens.filter(r => r.token !== token);
    this._scheduleFlush('refreshTokens');
  }
  purgeExpiredRefreshTokens() {
    const now = Date.now();
    const before = this.data.refreshTokens.length;
    this.data.refreshTokens = this.data.refreshTokens.filter(r => r.expiresAt > now);
    if (this.data.refreshTokens.length !== before) this._scheduleFlush('refreshTokens');
  }

  // ---- Last played ----
  recordPlay(userId, game) {
    const list = this.data.lastPlayed[userId] || [];
    const filtered = list.filter(g => g.gameId !== game.gameId);
    filtered.unshift({ ...game, playedAt: Date.now() });
    this.data.lastPlayed[userId] = filtered.slice(0, 10);
    this._scheduleFlush('lastPlayed');
  }
  getLastPlayed(userId, n = 3) {
    return (this.data.lastPlayed[userId] || []).slice(0, n);
  }

  // ---- Device settings ----
  getDeviceSettings(userId, deviceId) {
    return this.data.deviceSettings[userId]?.[deviceId] || null;
  }
  setDeviceSettings(userId, deviceId, settings) {
    if (!this.data.deviceSettings[userId]) this.data.deviceSettings[userId] = {};
    this.data.deviceSettings[userId][deviceId] = settings;
    this._scheduleFlush('deviceSettings');
  }

  // ---- Sleep schedule ----
  getSleepSchedule(userId) {
    return this.data.sleepSchedule[userId] || null;
  }
  setSleepSchedule(userId, schedule) {
    this.data.sleepSchedule[userId] = schedule;
    this._scheduleFlush('sleepSchedule');
  }

  // ---- Config (singleton blob) ----
  getConfig() { return this.data.config; }
  setConfig(patch) {
    this.data.config = { ...this.data.config, ...patch };
    this._scheduleFlush('config');
  }
}
