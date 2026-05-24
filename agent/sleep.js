// Smart sleep scheduler + Windows sleep trigger.
//
// The scheduler holds at most one armed slot per day. When the configured
// time elapses we either sleep immediately (if no active session) or set a
// "pending" flag that fires the next time the user disconnects or AFK lands.
//
// Actual sleep uses `rundll32.exe powrprof.dll,SetSuspendState` which is the
// standard Win32 sleep call. We disable hibernate first so the call always
// produces a real sleep instead of hibernate-when-set-otherwise.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class SleepManager {
  constructor({ onPromptUser, onAutoSleep }) {
    this.onPromptUser = onPromptUser || (() => {});
    this.onAutoSleep = onAutoSleep || (() => {});

    this.schedule = null;     // { time: "HH:MM", days: [0..6], enabled: bool }
    this.pending = false;     // true if a scheduled-sleep fired during a session
    this.tickHandle = null;
  }

  setSchedule(schedule) {
    this.schedule = schedule;
    if (!schedule?.enabled) {
      this.pending = false;
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      return;
    }
    if (!this.tickHandle) {
      this.tickHandle = setInterval(() => this._tick(), 60_000);
      this.tickHandle.unref?.();
    }
  }

  _tick() {
    if (!this.schedule?.enabled) return;
    const now = new Date();
    const day = now.getDay();
    if (!this.schedule.days?.includes(day)) return;
    const [hh, mm] = this.schedule.time.split(':').map(n => parseInt(n, 10));
    if (now.getHours() !== hh || now.getMinutes() !== mm) return;
    this.pending = true;
    this.onPromptUser({ scheduledAt: Date.now() });
  }

  // Called when user dismisses the session-end prompt — defer until next natural close
  defer() { this.pending = true; }

  // Called from outside when AFK fires or stream disconnects
  onSessionEnded() {
    if (this.pending) {
      this.pending = false;
      this.onAutoSleep({ reason: 'scheduled' });
    }
  }

  async sleepNow() {
    try {
      // Disable hibernate so SetSuspendState actually sleeps; admin required.
      await execAsync('powercfg /hibernate off').catch(() => {});
    } catch { /* not admin — try anyway */ }
    await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    return { ok: true };
  }
}
