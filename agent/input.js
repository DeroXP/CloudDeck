// Input simulation for remote-desktop mode. Browser sends normalized mouse/
// keyboard events; we replay them on the Windows desktop via robotjs.

import { robot } from './optional-deps.js';

export class InputManager {
  constructor() {
    this.screen = robot.getScreenSize();
  }

  handle(event) {
    if (!robot.available) {
      return { ok: false, error: 'robotjs not available' };
    }
    switch (event.type) {
      case 'mouse-move': {
        const { x, y, normalized } = event;
        const px = normalized ? Math.round(x * this.screen.width) : x;
        const py = normalized ? Math.round(y * this.screen.height) : y;
        robot.moveMouse(px, py);
        return { ok: true };
      }
      case 'mouse-click': {
        const button = event.button || 'left';
        robot.mouseClick(button, !!event.double);
        return { ok: true };
      }
      case 'mouse-down': {
        robot.mouseToggle('down', event.button || 'left');
        return { ok: true };
      }
      case 'mouse-up': {
        robot.mouseToggle('up', event.button || 'left');
        return { ok: true };
      }
      case 'scroll': {
        robot.scrollMouse(event.dx || 0, event.dy || 0);
        return { ok: true };
      }
      case 'key-tap': {
        robot.keyTap(event.key, event.modifiers || []);
        return { ok: true };
      }
      case 'key-down': {
        robot.keyToggle(event.key, 'down', event.modifiers || []);
        return { ok: true };
      }
      case 'key-up': {
        robot.keyToggle(event.key, 'up', event.modifiers || []);
        return { ok: true };
      }
      case 'type-string': {
        robot.typeString(event.text || '');
        return { ok: true };
      }
      // Gamepad-style inputs from mobile virtual gamepad. We translate axis
      // deltas to mouse movement and face buttons to common keys. In a future
      // iteration this should route through a virtual gamepad driver
      // (ViGEmBus) for real controller input — robotjs only does mouse/kb.
      case 'gamepad-axis': {
        const dx = event.x * 8;
        const dy = event.y * 8;
        const s = this.screen;
        // Use absolute positioning relative to current cursor — robotjs doesn't expose getMousePos in all builds
        robot.moveMouse(
          Math.max(0, Math.min(s.width - 1, Math.round(s.width / 2 + dx))),
          Math.max(0, Math.min(s.height - 1, Math.round(s.height / 2 + dy))),
        );
        return { ok: true };
      }
      case 'gamepad-button': {
        const map = {
          a: 'enter', b: 'escape', x: 'space', y: 'tab',
          start: 'enter', back: 'escape',
          lb: 'left', rb: 'right', up: 'up', down: 'down', left: 'left', right: 'right',
        };
        const key = map[event.button];
        if (!key) return { ok: false, error: `unmapped button ${event.button}` };
        if (event.down) robot.keyToggle(key, 'down');
        else robot.keyToggle(key, 'up');
        return { ok: true };
      }
      default:
        return { ok: false, error: `unknown input event ${event.type}` };
    }
  }
}
