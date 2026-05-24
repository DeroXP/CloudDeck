// PC stats dashboard. Subscribes to 'stats' broadcasts from the agent and
// updates the meters on each frame. Snapshot is also fetched once on render
// so the panel has data before the first 2.5s push arrives.

import { api } from './api.js';

export class DashboardModule {
  constructor({ realtime }) {
    this.realtime = realtime;
    this.last = null;
    this.rendered = null;
    this.realtime.addEventListener('msg:stats', e => {
      this.last = e.detail;
      this._update();
    });
  }

  render = async (root) => {
    const grid = document.createElement('div');
    grid.className = 'cd-dash';
    grid.innerHTML = this._template();
    root.appendChild(grid);
    this.rendered = grid;
    if (this.last) this._update();
  };

  _template() {
    return `
      <div class="cd-dash-card">
        <div class="cd-dash-label">CPU</div>
        <div><span class="cd-dash-value" data-k="cpu-usage">—</span><span class="cd-dash-unit">%</span></div>
        <div class="cd-dash-meter"><div class="cd-dash-meter-fill" data-k="cpu-fill"></div></div>
        <div class="cd-dash-label" style="margin-top:10px;">Temp <span data-k="cpu-temp">—</span>°C</div>
      </div>
      <div class="cd-dash-card">
        <div class="cd-dash-label">GPU</div>
        <div><span class="cd-dash-value" data-k="gpu-usage">—</span><span class="cd-dash-unit">%</span></div>
        <div class="cd-dash-meter"><div class="cd-dash-meter-fill" data-k="gpu-fill"></div></div>
        <div class="cd-dash-label" style="margin-top:10px;">Temp <span data-k="gpu-temp">—</span>°C · <span data-k="gpu-model">—</span></div>
      </div>
      <div class="cd-dash-card">
        <div class="cd-dash-label">RAM</div>
        <div><span class="cd-dash-value" data-k="ram-percent">—</span><span class="cd-dash-unit">%</span></div>
        <div class="cd-dash-meter"><div class="cd-dash-meter-fill" data-k="ram-fill"></div></div>
        <div class="cd-dash-label" style="margin-top:10px;"><span data-k="ram-used">—</span> GB / <span data-k="ram-total">—</span> GB</div>
      </div>
      <div class="cd-dash-card">
        <div class="cd-dash-label">Active Game</div>
        <div class="cd-dash-value" style="font-size:18px;" data-k="active-game">None</div>
        <div class="cd-dash-label" style="margin-top:10px;">Duration <span data-k="game-duration">—</span></div>
      </div>
      <div class="cd-dash-card">
        <div class="cd-dash-label">Stream</div>
        <div class="cd-dash-value" style="font-size:18px;" data-k="stream-res">—</div>
        <div class="cd-dash-label" style="margin-top:10px;"><span data-k="stream-fps">—</span> fps · <span data-k="stream-bitrate">—</span> Mbps</div>
      </div>
      <div class="cd-dash-card">
        <div class="cd-dash-label">Network</div>
        <div><span class="cd-dash-value" data-k="net-ping">—</span><span class="cd-dash-unit">ms</span></div>
        <div class="cd-dash-label" style="margin-top:10px;">Jitter <span data-k="net-jitter">—</span> ms · Loss <span data-k="net-loss">—</span>%</div>
      </div>
    `;
  }

  _update() {
    if (!this.rendered || !this.last) return;
    const set = (k, v) => {
      const el = this.rendered.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = v;
    };
    const fill = (k, pct) => {
      const el = this.rendered.querySelector(`[data-k="${k}"]`);
      if (el) el.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
    };
    const s = this.last;
    if (s.cpu) {
      set('cpu-usage', s.cpu.usage != null ? Math.round(s.cpu.usage) : '—');
      set('cpu-temp', s.cpu.temp != null ? Math.round(s.cpu.temp) : '—');
      fill('cpu-fill', s.cpu.usage);
    }
    if (s.gpu) {
      set('gpu-usage', s.gpu.usage != null ? Math.round(s.gpu.usage) : '—');
      set('gpu-temp', s.gpu.temp != null ? Math.round(s.gpu.temp) : '—');
      set('gpu-model', s.gpu.model || s.gpu.vendor || '');
      fill('gpu-fill', s.gpu.usage);
    }
    if (s.ram) {
      set('ram-percent', s.ram.percent ?? '—');
      set('ram-used', s.ram.used != null ? (s.ram.used / 1073741824).toFixed(1) : '—');
      set('ram-total', s.ram.total != null ? (s.ram.total / 1073741824).toFixed(1) : '—');
      fill('ram-fill', s.ram.percent);
    }
  }

  setActiveGame(name, startedAt) {
    if (!this.rendered) return;
    const el = this.rendered.querySelector('[data-k="active-game"]');
    if (el) el.textContent = name || 'None';
    const dur = this.rendered.querySelector('[data-k="game-duration"]');
    if (dur && startedAt) {
      clearInterval(this._durTimer);
      const tick = () => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        dur.textContent = `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
      };
      tick();
      this._durTimer = setInterval(tick, 30000);
    } else if (dur) {
      clearInterval(this._durTimer);
      dur.textContent = '—';
    }
  }
}
