// Universal input router. Listens for keyboard, gamepad, and touch input;
// emits high-level navigation actions on a single event target so the rest
// of the UI doesn't care which input method fired.
//
// Events emitted (CustomEvent on `input` target):
//   nav        — { direction: 'up' | 'down' | 'left' | 'right' }
//   confirm
//   back
//   menu       — start / options button
//   shoulder   — { side: 'left' | 'right' }
//   home       — long-hold B / Circle
//   input-mode — { mode }
//
// Also raw gamepad/keyboard events flow through here so the remote-desktop
// module can subscribe directly.

import { focus } from './focus.js';

class InputRouter extends EventTarget {
  constructor() {
    super();
    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
    this._bindGamepad();
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _setMode(mode) {
    focus.setInputMode(mode);
    this._emit('input-mode', { mode });
  }

  // -- Keyboard --
  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      if (this._shouldSkipKey(e)) return;
      this._setMode('mouse');   // typing is closer to mouse mode for UI hints
      switch (e.key) {
        case 'ArrowLeft': this._emit('nav', { direction: 'left' }); e.preventDefault(); break;
        case 'ArrowRight': this._emit('nav', { direction: 'right' }); e.preventDefault(); break;
        case 'ArrowUp': this._emit('nav', { direction: 'up' }); e.preventDefault(); break;
        case 'ArrowDown': this._emit('nav', { direction: 'down' }); e.preventDefault(); break;
        case 'Enter': this._emit('confirm'); e.preventDefault(); break;
        case 'Escape': this._emit('back'); e.preventDefault(); break;
        case 'Tab':
          // Let browser handle when an input is focused; we intercept only in XMB
          break;
      }
      if (e.ctrlKey && /^[1-4]$/.test(e.key)) {
        this._emit('jump-cat', { index: parseInt(e.key, 10) - 1 });
        e.preventDefault();
      }
    });
  }

  _shouldSkipKey(e) {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  // -- Mouse --
  _bindMouse() {
    let lastMove = 0;
    window.addEventListener('mousemove', () => {
      const now = Date.now();
      if (now - lastMove > 200) {
        this._setMode('mouse');
      }
      lastMove = now;
    });
    window.addEventListener('click', e => {
      this._setMode('mouse');
    });
  }

  // -- Touch --
  _bindTouch() {
    let startX = 0, startY = 0, startT = 0, startEl = null;
    window.addEventListener('touchstart', e => {
      this._setMode('touch');
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startT = Date.now();
        startEl = e.target;
      }
    }, { passive: true });
    window.addEventListener('touchend', e => {
      if (e.changedTouches.length !== 1) return;
      // Mobile navigates categories via the bottom tab bar, and the game grid
      // / panels are natively scrollable. A scroll flick used to be misread
      // as a category-switch / focus-move nav gesture. Suppress swipe-to-nav
      // when the gesture started inside a scroll container.
      if (startEl?.closest?.('.cd-games, .cd-items, .cd-shots, .cd-settings, .cd-dash, .cd-detail-scroll')) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const dt = Date.now() - startT;
      if (dt > 500) return;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) < 40) return;  // tap, not swipe
      if (adx > ady) this._emit('nav', { direction: dx > 0 ? 'left' : 'right' });
      else this._emit('nav', { direction: dy > 0 ? 'up' : 'down' });
    });
  }

  // -- Gamepad (Gamepad API polling loop) --
  _bindGamepad() {
    const last = new Map();   // index -> { buttons: [...], axes: [...] }
    let homeHoldStart = 0;

    const tick = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad) continue;
        this._setMode('controller');
        const prev = last.get(pad.index) || { buttons: [], axes: [] };
        // Buttons
        const map = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'ls', 'rs', 'up', 'down', 'left', 'right', 'home'];
        for (let i = 0; i < pad.buttons.length; i++) {
          const now = pad.buttons[i].pressed;
          const was = prev.buttons[i] || false;
          if (now && !was) this._gamepadBtnDown(map[i]);
          if (!now && was) this._gamepadBtnUp(map[i]);
        }
        // Hold-B for home
        const bIdx = 1;
        if (pad.buttons[bIdx]?.pressed) {
          if (!homeHoldStart) homeHoldStart = Date.now();
          else if (Date.now() - homeHoldStart > 800) {
            this._emit('home');
            homeHoldStart = -Infinity;
          }
        } else {
          homeHoldStart = 0;
        }
        // Sticks (treat first non-deadzone press as a nav event)
        const dz = 0.5;
        const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
        const stickKey = `s_${pad.index}`;
        const prevStick = last.get(stickKey) || { ax: 0, ay: 0 };
        if (Math.abs(ax) > dz && Math.abs(prevStick.ax) <= dz) {
          this._emit('nav', { direction: ax > 0 ? 'right' : 'left' });
        }
        if (Math.abs(ay) > dz && Math.abs(prevStick.ay) <= dz) {
          this._emit('nav', { direction: ay > 0 ? 'down' : 'up' });
        }
        last.set(stickKey, { ax, ay });
        last.set(pad.index, {
          buttons: pad.buttons.map(b => b.pressed),
          axes: pad.axes.slice(),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _gamepadBtnDown(name) {
    switch (name) {
      case 'a': this._emit('confirm'); break;
      case 'b': this._emit('back'); break;
      case 'start': this._emit('menu'); break;
      case 'lb': this._emit('shoulder', { side: 'left' }); break;
      case 'rb': this._emit('shoulder', { side: 'right' }); break;
      case 'up': this._emit('nav', { direction: 'up' }); break;
      case 'down': this._emit('nav', { direction: 'down' }); break;
      case 'left': this._emit('nav', { direction: 'left' }); break;
      case 'right': this._emit('nav', { direction: 'right' }); break;
      case 'home': this._emit('home'); break;
    }
    this._emit('button-down', { button: name });
  }
  _gamepadBtnUp(name) {
    this._emit('button-up', { button: name });
  }
}

export const input = new InputRouter();
