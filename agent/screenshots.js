// Steam screenshot watcher. Steam writes screenshots to the userdata folder
// at userdata/<steamID>/760/remote/<appID>/screenshots/. We also watch the
// "external" Pictures\Screenshots folder if the user prefers Windows-style
// PrintScreen captures. New files trigger a notification to Railway; the
// proxied bytes are served on demand via `screenshot-fetch`.

import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export class ScreenshotWatcher {
  constructor({ onNew } = {}) {
    this.onNew = onNew || (() => {});
    this.index = new Map();   // id -> abs path
    this.watcher = null;
  }

  async start() {
    const dirs = await this._resolveDirs();
    if (dirs.length === 0) {
      console.warn('[screenshots] no screenshot directories found; watcher disabled');
      return;
    }
    // ignoreInitial:false so the initial scan populates our index, but we
    // only *announce* (push to the browser) files added AFTER the watcher's
    // 'ready' event. Otherwise every agent restart re-broadcast every
    // pre-existing screenshot to any connected browser.
    this._ready = false;
    this.watcher = chokidar.watch(dirs, {
      ignoreInitial: false,
      depth: 6,
      awaitWriteFinish: { stabilityThreshold: 500 },
    });
    this.watcher.on('add', file => this._add(file));
    this.watcher.on('ready', () => { this._ready = true; });
    console.log(`[screenshots] watching ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'}`);
  }

  async _resolveDirs() {
    const dirs = new Set();
    if (config.screenshotDir) dirs.add(config.screenshotDir);

    // Steam userdata
    try {
      const users = await fs.readdir(config.steam.userDataDir);
      for (const u of users) {
        const candidate = path.join(config.steam.userDataDir, u, '760', 'remote');
        try {
          await fs.access(candidate);
          dirs.add(candidate);
        } catch { /* skip */ }
      }
    } catch { /* not present */ }

    // Windows Pictures/Screenshots
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const winShots = path.join(userProfile, 'Pictures', 'Screenshots');
      try { await fs.access(winShots); dirs.add(winShots); }
      catch { /* skip */ }
    }
    return [...dirs];
  }

  async _add(file) {
    if (!/\.(jpe?g|png|webp|bmp)$/i.test(file)) return;
    const id = Buffer.from(file).toString('base64url');
    if (this.index.has(id)) return;
    this.index.set(id, file);
    // Files present during the initial scan are indexed silently — only
    // genuinely new captures (after 'ready') get announced to the browser.
    if (!this._ready) return;
    // Use the file's real mtime, not "now", so a screenshot's timestamp is
    // consistent with what list() reports and sorts correctly.
    let takenAt = Date.now();
    try { takenAt = (await fs.stat(file)).mtimeMs; } catch { /* keep now */ }
    this.onNew({
      id,
      name: path.basename(file),
      takenAt,
      thumbnailUrl: `/api/screenshots/${id}`,
    });
  }

  async list() {
    const entries = [];
    for (const [id, file] of this.index) {
      let stat;
      try { stat = await fs.stat(file); } catch { continue; }
      entries.push({
        id,
        name: path.basename(file),
        takenAt: stat.mtimeMs,
        thumbnailUrl: `/api/screenshots/${id}`,
      });
    }
    return entries.sort((a, b) => b.takenAt - a.takenAt);
  }

  async fetch(id) {
    const file = this.index.get(id);
    if (!file) return null;
    const buf = await fs.readFile(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  }

  async stop() {
    await this.watcher?.close();
  }
}
