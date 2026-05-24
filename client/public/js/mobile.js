// Mobile virtual gamepad. Uses nipplejs for the analog stick (loaded via
// CDN script tag in index.html), plus tap-based face/shoulder buttons. All
// events translate to remote-desktop-input messages so the agent simulates
// the action on the host.

export class MobileGamepad {
  constructor({ realtime }) {
    this.realtime = realtime;
    this.el = document.getElementById('mobile-pad');
    this.padLeft = document.getElementById('pad-left');
    this.active = false;
    this.joystick = null;
  }

  enable() {
    if (this.active) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    this.active = true;
    this.el.classList.add('cd-mobile-pad-active');

    if (window.nipplejs && !this.joystick) {
      this.joystick = window.nipplejs.create({
        zone: this.padLeft,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: '#e63946',
        size: 120,
      });
      this.joystick.on('move', (_evt, data) => {
        if (!data?.vector) return;
        this.realtime.send({
          target: 'agent',
          type: 'remote-desktop-input',
          payload: { type: 'gamepad-axis', x: data.vector.x, y: -data.vector.y },
        });
      });
      this.joystick.on('end', () => {
        this.realtime.send({
          target: 'agent',
          type: 'remote-desktop-input',
          payload: { type: 'gamepad-axis', x: 0, y: 0 },
        });
      });
    }

    this.el.querySelectorAll('[data-btn]').forEach(btn => {
      const name = btn.dataset.btn;
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        this.realtime.send({
          target: 'agent',
          type: 'remote-desktop-input',
          payload: { type: 'gamepad-button', button: name, down: true },
        });
      }, { passive: false });
      btn.addEventListener('touchend', e => {
        e.preventDefault();
        this.realtime.send({
          target: 'agent',
          type: 'remote-desktop-input',
          payload: { type: 'gamepad-button', button: name, down: false },
        });
      });
    });
  }

  disable() {
    this.active = false;
    this.el.classList.remove('cd-mobile-pad-active');
    if (this.joystick) {
      this.joystick.destroy();
      this.joystick = null;
    }
  }
}
