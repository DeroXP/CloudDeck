// Forward Windows toast/Xbox notifications to Railway so they can appear as
// in-stream toasts in the XMB overlay. The Notification Center API requires
// some ceremony; for now we tail Steam's overlay log (which contains friend/
// achievement events) and Windows' notification database (UserNotifications
// in WinRT). The simpler v1 implementation only forwards Steam events.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class Notifications {
  constructor({ onNotification }) {
    this.onNotification = onNotification || (() => {});
    this.tail = null;
  }

  async start() {
    // Steam's overlay log path
    const candidates = [
      path.join(path.dirname(path.dirname(config.steam.userDataDir)), 'logs', 'gameoverlayrenderer_log.txt'),
    ];
    for (const file of candidates) {
      if (fsSync.existsSync(file)) {
        this._tail(file);
        break;
      }
    }
  }

  _tail(file) {
    let lastSize = 0;
    try { lastSize = fsSync.statSync(file).size; } catch { lastSize = 0; }
    fsSync.watchFile(file, { interval: 2000 }, async () => {
      try {
        const stat = await fs.stat(file);
        if (stat.size <= lastSize) { lastSize = stat.size; return; }
        const fd = await fs.open(file, 'r');
        const buf = Buffer.alloc(stat.size - lastSize);
        await fd.read(buf, 0, buf.length, lastSize);
        await fd.close();
        lastSize = stat.size;
        const text = buf.toString('utf8');
        this._parseSteam(text);
      } catch { /* file may rotate */ }
    });
  }

  _parseSteam(text) {
    // Best-effort string match; Steam doesn't publish a schema. Common events:
    //   "achievement awarded"
    //   "friend joined"
    //   "message from"
    for (const line of text.split('\n')) {
      const m =
        /achievement awarded.*\] (.+)/i.exec(line) ||
        /friend.*?\] (.+)/i.exec(line) ||
        /message from.*?\] (.+)/i.exec(line);
      if (m) {
        this.onNotification({
          source: 'steam',
          text: m[0].trim(),
          at: Date.now(),
        });
      }
    }
  }
}
