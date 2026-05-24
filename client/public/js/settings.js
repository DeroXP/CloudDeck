// Settings panel — stream config, audio, sleep schedule, AFK timing,
// 2FA setup, user management (admin only), and a reset-config escape hatch.

import { api } from './api.js';
import { focus } from './focus.js';

export class SettingsModule {
  constructor({ realtime, me, deviceId, onReload, toast }) {
    this.realtime = realtime;
    this.me = me;
    this.deviceId = deviceId;
    this.onReload = onReload;
    this.toast = toast;
  }

  render = async (root) => {
    focus.unregisterGroup('items-settings');
    const wrap = document.createElement('div');
    wrap.className = 'cd-settings';
    root.appendChild(wrap);

    const [deviceSettings, sleepSchedule, users] = await Promise.all([
      api.deviceSettings(this.deviceId).catch(() => ({ settings: null, defaults: {} })),
      api.sleepSchedule().catch(() => null),
      this.me?.role === 'admin' ? api.users().catch(() => null) : null,
    ]);

    const s = deviceSettings.settings || deviceSettings.defaults || {};
    const defaults = deviceSettings.defaults || {};
    // Auto-detect screen
    const detected = {
      resolution: `${screen.width}x${screen.height}`,
      fps: screen.refreshRate || 60,
    };

    wrap.innerHTML = `
      <div class="cd-settings-section">
        <h3>Stream</h3>
        <div class="cd-field">
          <label class="cd-field-label">Resolution</label>
          <select id="set-res">
            ${['720p','1080p','1440p','4k', detected.resolution].filter((v,i,a)=>a.indexOf(v)===i).map(r =>
              `<option value="${r}" ${s.resolution===r?'selected':''}>${r}${r===detected.resolution?' (auto-detected)':''}</option>`).join('')}
          </select>
        </div>
        <div class="cd-field">
          <label class="cd-field-label">FPS</label>
          <select id="set-fps">
            ${[30,60,90,120,144].map(f =>
              `<option value="${f}" ${(s.fps||defaults.fps||60)==f?'selected':''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="cd-field">
          <label class="cd-field-label">Bitrate (kbps)</label>
          <input id="set-bitrate" type="number" min="1000" max="100000" step="1000" value="${s.bitrate||defaults.bitrate||20000}" />
        </div>
        <div class="cd-field-hint">Auto-detected from this device: ${detected.resolution} @ ${detected.fps} Hz</div>
      </div>

      <div class="cd-settings-section">
        <h3>Audio</h3>
        <div class="cd-field">
          <label class="cd-field-label">Bitrate (kbps)</label>
          <select id="set-abitrate">
            ${[128,256,320].map(b => `<option value="${b}" ${(s.audioBitrate||defaults.audioBitrate||256)==b?'selected':''}>${b}</option>`).join('')}
          </select>
        </div>
        <div class="cd-field">
          <label class="cd-field-label">Surround passthrough</label>
          <input id="set-surround" type="checkbox" ${s.audioSurround ? 'checked' : ''} />
        </div>
      </div>

      ${this.me?.role === 'admin' ? `
      <div class="cd-settings-section">
        <h3>Sleep Schedule</h3>
        <div class="cd-field">
          <label class="cd-field-label">Enabled</label>
          <input id="sleep-enabled" type="checkbox" ${sleepSchedule?.schedule?.enabled?'checked':''} />
        </div>
        <div class="cd-field">
          <label class="cd-field-label">Sleep at</label>
          <input id="sleep-time" type="time" value="${sleepSchedule?.schedule?.time || '00:00'}" />
        </div>
        <div class="cd-field">
          <label class="cd-field-label">Days</label>
          <div id="sleep-days" style="display:flex; gap:6px;">
            ${['S','M','T','W','T','F','S'].map((d, i) =>
              `<button data-day="${i}" class="day-btn ${sleepSchedule?.schedule?.days?.includes(i)?'on':''}">${d}</button>`).join('')}
          </div>
        </div>
        <style>
          .day-btn.on { background: rgba(230,57,70,0.2); border-color: var(--cd-red); }
        </style>
      </div>

      <div class="cd-settings-section">
        <h3>Users</h3>
        <div id="users-list"></div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <input id="new-user" placeholder="Guest username" style="flex:1;" />
          <input id="new-pass" type="password" placeholder="Password" style="flex:1;" />
          <button id="add-user">+ Add Guest</button>
        </div>
      </div>
      ` : ''}

      <div class="cd-settings-section">
        <h3>Account</h3>
        <div class="cd-field">
          <label class="cd-field-label">Signed in as</label>
          <span>${this.me?.username || '—'} (${this.me?.role || '—'})</span>
        </div>
        <div class="cd-field">
          <label class="cd-field-label">2FA</label>
          <span>${this.me?.twoFactorEnabled ? '✓ Enabled' : 'Not set up'}</span>
        </div>
        <div class="actions" style="margin-top:14px;">
          <button id="setup-2fa">${this.me?.twoFactorEnabled ? 'Disable 2FA' : 'Set up 2FA'}</button>
          <button id="logout-btn">Sign out</button>
        </div>
        <div id="twofa-area" style="margin-top:14px;"></div>
      </div>

      <div class="cd-settings-section">
        <button id="save-btn" style="padding: 12px 24px;">Save settings</button>
      </div>
    `;

    // Make form controls focusable
    wrap.querySelectorAll('button, input, select').forEach(el => focus.register('items-settings', el));

    // Wire interactions
    wrap.querySelector('#save-btn').addEventListener('click', async () => {
      const payload = {
        resolution: wrap.querySelector('#set-res').value,
        fps: parseInt(wrap.querySelector('#set-fps').value, 10),
        bitrate: parseInt(wrap.querySelector('#set-bitrate').value, 10),
        audioBitrate: parseInt(wrap.querySelector('#set-abitrate').value, 10),
        audioSurround: wrap.querySelector('#set-surround').checked,
      };
      await api.saveDeviceSettings(this.deviceId, payload);

      if (this.me?.role === 'admin') {
        const sleep = {
          enabled: wrap.querySelector('#sleep-enabled').checked,
          time: wrap.querySelector('#sleep-time').value,
          days: [...wrap.querySelectorAll('.day-btn.on')].map(b => parseInt(b.dataset.day, 10)),
        };
        await api.saveSleepSchedule(sleep);
        try {
          await this.realtime.sendCommand('set-sleep-schedule', sleep);
        } catch { /* agent might be offline */ }
      }
      this.toast?.('Settings saved', 'ok');
    });

    if (this.me?.role === 'admin') {
      wrap.querySelectorAll('.day-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          btn.classList.toggle('on');
        });
      });

      const usersList = wrap.querySelector('#users-list');
      const renderUsers = (list) => {
        usersList.innerHTML = list.map(u => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom: 1px solid var(--cd-border);">
            <span>${u.username} <small style="color:var(--cd-fg-dim);">(${u.role})</small></span>
            ${u.id !== this.me?.id ? `<button data-uid="${u.id}" class="del-user">Remove</button>` : ''}
          </div>
        `).join('');
        usersList.querySelectorAll('.del-user').forEach(b => {
          b.addEventListener('click', async () => {
            if (!confirm(`Delete user?`)) return;
            await api.deleteUser(b.dataset.uid);
            const fresh = await api.users();
            renderUsers(fresh.users);
          });
        });
      };
      renderUsers(users?.users || []);
      wrap.querySelector('#add-user').addEventListener('click', async () => {
        const username = wrap.querySelector('#new-user').value.trim();
        const password = wrap.querySelector('#new-pass').value;
        if (!username || password.length < 8) {
          this.toast?.('Username and 8+ char password required', 'warn');
          return;
        }
        const res = await api.createUser({ username, password, role: 'guest' });
        if (res?.error) { this.toast?.(res.error, 'warn'); return; }
        wrap.querySelector('#new-user').value = '';
        wrap.querySelector('#new-pass').value = '';
        const fresh = await api.users();
        renderUsers(fresh.users);
      });
    }

    wrap.querySelector('#logout-btn').addEventListener('click', async () => {
      await api.logout();
      location.href = '/login';
    });

    wrap.querySelector('#setup-2fa').addEventListener('click', async () => {
      const area = wrap.querySelector('#twofa-area');
      if (this.me?.twoFactorEnabled) {
        if (!confirm('Disable 2FA?')) return;
        await fetch('/api/auth/2fa/disable', { method: 'POST', credentials: 'include' });
        this.toast?.('2FA disabled', 'ok');
        this.onReload?.();
        return;
      }
      const r = await fetch('/api/auth/2fa/setup', { method: 'POST', credentials: 'include' });
      const data = await r.json();
      area.innerHTML = `
        <p style="font-size:12px;color:var(--cd-fg-dim);">Scan this QR with your authenticator app, then enter the 6-digit code below.</p>
        <img src="${data.qrCode}" style="border-radius:8px; max-width:200px; margin:8px 0;" />
        <div style="display:flex; gap:8px;">
          <input id="twofa-code" placeholder="6-digit code" inputmode="numeric" maxlength="6" style="flex:1;" />
          <button id="confirm-2fa">Confirm</button>
        </div>
      `;
      area.querySelector('#confirm-2fa').addEventListener('click', async () => {
        const code = area.querySelector('#twofa-code').value;
        const r = await fetch('/api/auth/2fa/confirm', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: data.secret, code }),
        });
        const out = await r.json();
        if (out.ok) {
          this.toast?.('2FA enabled', 'ok');
          area.innerHTML = '';
          this.onReload?.();
        } else {
          this.toast?.(out.error || 'Invalid code', 'warn');
        }
      });
    });
  };
}
