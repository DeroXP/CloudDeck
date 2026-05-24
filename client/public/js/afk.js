// AFK detection. Activates only while a stream is active. Watches for
// meaningful input (mouse beyond a delta, controller beyond deadzone, key/tap
// events). Idle for AFK_TIMEOUT_MINUTES → start countdown. Countdown reaches
// zero → emit 'afk-fire' so the parent can close the game and sleep the PC.

import { input } from './input.js';

export class AFKMonitor extends EventTarget {
  constructor({ timeoutMs, countdownSec, deadzone }) {
    super();
    this.timeoutMs = timeoutMs;
    this.countdownSec = countdownSec;
    this.deadzone = deadzone;
    this.enabled = false;
    this.lastInputAt = Date.now();
    this.timer = null;
    this.countdownTimer = null;
    this.countdownEnd = 0;

    this.afkEl = document.getElementById('afk');
    this.timerEl = document.getElementById('afk-timer');
    document.getElementById('afk-dismiss').addEventListener('click', () => this.dismiss());

    this._bindActivity();
  }

  enable() {
    this.enabled = true;
    this.lastInputAt = Date.now();
    this._tick();
    this.timer = setInterval(() => this._tick(), 10_000);
  }

  disable() {
    this.enabled = false;
    clearInterval(this.timer);
    this._stopCountdown();
    this.afkEl.classList.remove('cd-afk-active');
  }

  _bindActivity() {
    let lastMouse = { x: 0, y: 0 };
    window.addEventListener('mousemove', e => {
      const dx = Math.abs(e.clientX - lastMouse.x);
      const dy = Math.abs(e.clientY - lastMouse.y);
      if (dx + dy > 8) this._recordActivity();
      lastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('keydown', () => this._recordActivity());
    window.addEventListener('mousedown', () => this._recordActivity());
    window.addEventListener('touchstart', () => this._recordActivity());

    input.addEventListener('nav', () => this._recordActivity());
    input.addEventListener('confirm', () => this._recordActivity());
    input.addEventListener('back', () => this._recordActivity());
    input.addEventListener('button-down', () => this._recordActivity());
  }

  _recordActivity() {
    this.lastInputAt = Date.now();
    if (this.afkEl.classList.contains('cd-afk-active')) {
      this.dismiss();
    }
  }

  dismiss() {
    this.afkEl.classList.remove('cd-afk-active');
    this._stopCountdown();
    this.lastInputAt = Date.now();
    this.dispatchEvent(new Event('dismissed'));
  }

  _tick() {
    if (!this.enabled) return;
    if (this.afkEl.classList.contains('cd-afk-active')) return;
    const idleMs = Date.now() - this.lastInputAt;
    if (idleMs >= this.timeoutMs) {
      this._startCountdown();
    }
  }

  _startCountdown() {
    this.afkEl.classList.add('cd-afk-active');
    this.countdownEnd = Date.now() + this.countdownSec * 1000;
    this.dispatchEvent(new Event('countdown-start'));
    const update = () => {
      const remaining = Math.max(0, this.countdownEnd - Date.now());
      const sec = Math.floor(remaining / 1000);
      this.timerEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      if (remaining <= 0) {
        clearInterval(this.countdownTimer);
        this.afkEl.classList.remove('cd-afk-active');
        this.dispatchEvent(new Event('fire'));
      }
    };
    update();
    this.countdownTimer = setInterval(update, 200);
  }

  _stopCountdown() {
    clearInterval(this.countdownTimer);
  }
}
