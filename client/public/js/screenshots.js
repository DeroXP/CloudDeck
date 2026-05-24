// Screenshot gallery. Renders thumbnails in a grid; click to open full size.

import { api } from './api.js';
import { focus } from './focus.js';

export class ScreenshotsModule {
  constructor({ realtime }) {
    this.realtime = realtime;
    this.shots = [];
    this.realtime.addEventListener('msg:screenshot-added', e => {
      const shot = e.detail;
      if (!this.shots.find(s => s.id === shot.id)) {
        this.shots.unshift(shot);
        if (this.rendered) this._renderInto(this.rendered);
      }
    });
  }

  async load() {
    const data = await api.screenshots().catch(() => null);
    this.shots = data?.screenshots || [];
  }

  render = async (root) => {
    if (this.shots.length === 0) await this.load();
    const wrap = document.createElement('div');
    root.appendChild(wrap);
    this.rendered = wrap;
    this._renderInto(wrap);
  };

  _renderInto(wrap) {
    wrap.innerHTML = '';
    focus.unregisterGroup('items-screenshots');
    if (this.shots.length === 0) {
      wrap.innerHTML = '<div style="text-align:center; color:var(--cd-fg-dim); padding:40px;">No screenshots yet. Take one in-game with Steam\'s capture key (F12 by default).</div>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'cd-shots';
    for (const s of this.shots) {
      const card = document.createElement('div');
      card.className = 'cd-shot';
      card.innerHTML = `<img alt="" loading="lazy" src="${s.thumbnailUrl}" />`;
      card.addEventListener('click', () => this._openLightbox(s));
      focus.register('items-screenshots', card);
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
  }

  _openLightbox(s) {
    const lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.92);display:grid;place-items:center;cursor:zoom-out;';
    lb.innerHTML = `<img src="${s.thumbnailUrl}" style="max-width:96vw;max-height:92vh;border-radius:8px;box-shadow:var(--cd-shadow);" />`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }
}
