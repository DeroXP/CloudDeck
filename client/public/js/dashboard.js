// PC stats dashboard. Subscribes to 'stats' broadcasts from the agent and
// to 'ping' events on the realtime connection. Renders only metrics we can
// actually populate — broken cards (Stream / Network / Active Game / CPU
// temp) were dropped after user feedback ("they don't show anything").

export class DashboardModule {
  constructor({ realtime }) {
    this.realtime = realtime;
    this.last = null;
    this.lastPing = null;
    this.rendered = null;

    this.realtime.addEventListener('msg:stats', e => {
      this.last = e.detail;
      this._update();
    });
    // Ping is tracked client-side from WebSocket round-trip — always have it
    // even when the agent is silent.
    this.realtime.addEventListener('ping', e => {
      this.lastPing = e.detail;
      this._updatePing();
    });
  }

  render = async (root) => {
    const grid = document.createElement('div');
    grid.className = 'cd-dash';
    grid.innerHTML = this._template();
    root.appendChild(grid);
    this.rendered = grid;
    if (this.last) this._update();
    if (this.lastPing) this._updatePing();
  };

  _template() {
    return `
      <div class="cd-dash-card">
        <div class="cd-dash-label">CPU</div>
        <div><span class="cd-dash-value" data-k="cpu-usage">—</span><span class="cd-dash-unit">%</span></div>
        <div class="cd-dash-meter"><div class="cd-dash-meter-fill" data-k="cpu-fill"></div></div>
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
        <div class="cd-dash-label">Ping</div>
        <div><span class="cd-dash-value" data-k="ping-value">—</span><span class="cd-dash-unit">ms</span></div>
        <div class="cd-dash-label" style="margin-top:10px;">Jitter <span data-k="ping-jitter">—</span> ms</div>
      </div>
      <!-- Disk cards inserted here at render-time, one per drive -->
      <div data-k="disks-mount"></div>
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
    this._renderDisks(s.disks);
  }

  _updatePing() {
    if (!this.rendered || !this.lastPing) return;
    const set = (k, v) => {
      const el = this.rendered.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = v;
    };
    set('ping-value', this.lastPing.ping ?? '—');
    set('ping-jitter', this.lastPing.jitter ?? '—');
  }

  _renderDisks(disks) {
    if (!this.rendered) return;
    const mount = this.rendered.querySelector('[data-k="disks-mount"]');
    if (!mount || !disks) return;
    mount.innerHTML = disks.map(d => `
      <div class="cd-dash-card">
        <div class="cd-dash-label">Drive ${escapeHtml(d.mount)}</div>
        <div><span class="cd-dash-value">${d.percent}</span><span class="cd-dash-unit">%</span></div>
        <div class="cd-dash-meter"><div class="cd-dash-meter-fill" style="width:${d.percent}%"></div></div>
        <div class="cd-dash-label" style="margin-top:10px;">${gb(d.used)} GB / ${gb(d.size)} GB free ${gb(d.size - d.used)} GB</div>
      </div>
    `).join('');
    // Re-parent the disk cards into the grid itself instead of nested
    // inside a wrapper div, so they're true grid items.
    while (mount.firstChild) {
      this.rendered.insertBefore(mount.firstChild, mount);
    }
  }

  // No-op kept so main.js can keep calling it; we don't display "active game"
  // anymore (it lived in a card that's now removed).
  setActiveGame() {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function gb(bytes) {
  return (bytes / 1073741824).toFixed(1);
}
