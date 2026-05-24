// Wrappers for optional native deps. We don't want a missing robotjs build
// to crash the whole agent — instead these modules return a stub with the same
// surface and log a warning when the underlying capability is exercised.

let robotjs = null;
let robotjsLoadError = null;
try {
  robotjs = (await import('robotjs')).default;
} catch (err) {
  robotjsLoadError = err.message;
}

export const robot = robotjs ? {
  available: true,
  moveMouse: (x, y) => robotjs.moveMouse(x, y),
  moveMouseSmooth: (x, y) => robotjs.moveMouseSmooth(x, y),
  mouseClick: (button = 'left', double = false) => robotjs.mouseClick(button, double),
  mouseToggle: (down, button = 'left') => robotjs.mouseToggle(down, button),
  scrollMouse: (x, y) => robotjs.scrollMouse(x, y),
  keyTap: (key, modifiers) => robotjs.keyTap(key, modifiers),
  keyToggle: (key, down, modifiers) => robotjs.keyToggle(key, down, modifiers),
  typeString: (s) => robotjs.typeString(s),
  getScreenSize: () => robotjs.getScreenSize(),
} : {
  available: false,
  loadError: robotjsLoadError,
  _warn() {
    if (!this._warned) {
      console.warn('[agent] robotjs unavailable — input simulation disabled. ' + (robotjsLoadError || ''));
      this._warned = true;
    }
  },
  moveMouse() { this._warn(); },
  moveMouseSmooth() { this._warn(); },
  mouseClick() { this._warn(); },
  mouseToggle() { this._warn(); },
  scrollMouse() { this._warn(); },
  keyTap() { this._warn(); },
  keyToggle() { this._warn(); },
  typeString() { this._warn(); },
  getScreenSize() { return { width: 1920, height: 1080 }; },
};

let nodeWindows = null;
try { nodeWindows = (await import('node-windows')).default; }
catch { nodeWindows = null; }
export const winService = nodeWindows;
