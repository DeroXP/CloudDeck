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
        <div class="cd-field" title="Resolution Sunshine encodes the stream at. Higher = sharper, more bandwidth + GPU load. Pick a value your PC and your network can both sustain.">
          <label class="cd-field-label">Resolution <span class="cd-help">?</span></label>
          <select id="set-res" title="Stream resolution. 1080p is the safe default; 1440p needs ~30 Mbps; 4K needs a strong GPU + LAN.">
            ${['720p','1080p','1440p','4k', detected.resolution].filter((v,i,a)=>a.indexOf(v)===i).map(r =>
              `<option value="${r}" ${s.resolution===r?'selected':''}>${r}${r===detected.resolution?' (auto-detected)':''}</option>`).join('')}
          </select>
        </div>
        <div class="cd-field-hint">Resolution the game renders at on your PC for streaming. Doesn't affect what you see when sitting in front of the PC physically.</div>

        <div class="cd-field" title="Target frame rate of the stream. Most games feel great at 60. 120/144 only matters for fast-paced shooters and needs proportionally more bandwidth.">
          <label class="cd-field-label">FPS <span class="cd-help">?</span></label>
          <select id="set-fps" title="Higher FPS = smoother motion but exponentially more bandwidth. Cap below your monitor's refresh rate.">
            ${[30,60,90,120,144].map(f =>
              `<option value="${f}" ${(s.fps||defaults.fps||60)==f?'selected':''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="cd-field-hint">Frame rate the stream targets. 60 FPS is the universal sweet spot for game streaming.</div>

        <div class="cd-field" title="Video bitrate in kilobits per second. Higher = better image quality but eats your upload bandwidth. ~20 Mbps for 1080p60 is normal; bump to 50+ for 4K.">
          <label class="cd-field-label">Bitrate (kbps) <span class="cd-help">?</span></label>
          <input id="set-bitrate" type="number" min="1000" max="100000" step="1000" value="${s.bitrate||defaults.bitrate||20000}" title="20000 = 20 Mbps (good for 1080p60). 50000 = 50 Mbps (good for 4K60). Test on your network — too high makes Moonlight stutter." />
        </div>
        <div class="cd-field-hint">Video bandwidth ceiling. ~20000 (20 Mbps) is good for 1080p60. Auto-detected from this device: ${detected.resolution} @ ${detected.fps} Hz</div>
      </div>

      <div class="cd-settings-section">
        <h3>Audio</h3>
        <div class="cd-field" title="Audio bitrate in kbps. 256 is studio-quality stereo, 128 is fine for chat/podcast-y games, 320 is overkill for most cases.">
          <label class="cd-field-label">Bitrate (kbps) <span class="cd-help">?</span></label>
          <select id="set-abitrate" title="Audio bandwidth — 256 kbps is transparent for stereo gameplay.">
            ${[128,256,320].map(b => `<option value="${b}" ${(s.audioBitrate||defaults.audioBitrate||256)==b?'selected':''}>${b}</option>`).join('')}
          </select>
        </div>
        <div class="cd-field-hint">Audio quality of the stream. 256 kbps is more than enough for stereo games.</div>

        <div class="cd-field" title="Pass 5.1 / 7.1 surround channels through to the client device. Only useful if your viewing device has surround output (e.g. a soundbar or AV receiver via HDMI). Most phones and laptops just downmix to stereo so leave this off.">
          <label class="cd-field-label">Surround passthrough <span class="cd-help">?</span></label>
          <input id="set-surround" type="checkbox" ${s.audioSurround ? 'checked' : ''} />
        </div>
        <div class="cd-field-hint">Send raw 5.1/7.1 channels instead of downmixed stereo. Only flip this on if you're streaming to a device with surround speakers.</div>
      </div>

      ${this.me?.role === 'admin' ? `
      <div class="cd-settings-section">
        <h3>Sleep Schedule</h3>
        <div class="cd-field" title="When on, the PC agent will automatically put the PC to sleep at the configured time on the selected days. If you're actively streaming when it fires, you get a prompt instead of immediate sleep.">
          <label class="cd-field-label">Enabled <span class="cd-help">?</span></label>
          <input id="sleep-enabled" type="checkbox" ${sleepSchedule?.schedule?.enabled?'checked':''} />
        </div>
        <div class="cd-field" title="Daily time at which the sleep trigger fires (PC's local time).">
          <label class="cd-field-label">Sleep at <span class="cd-help">?</span></label>
          <input id="sleep-time" type="time" value="${sleepSchedule?.schedule?.time || '00:00'}" />
        </div>
        <div class="cd-field" title="Days of the week the sleep schedule is active. Click each letter to toggle.">
          <label class="cd-field-label">Days <span class="cd-help">?</span></label>
          <div id="sleep-days" style="display:flex; gap:6px;">
            ${['S','M','T','W','T','F','S'].map((d, i) =>
              `<button data-day="${i}" class="day-btn ${sleepSchedule?.schedule?.days?.includes(i)?'on':''}" title="Toggle ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}">${d}</button>`).join('')}
          </div>
        </div>
        <div class="cd-field-hint">Sets a recurring time for the PC to put itself to sleep. Skipped if you're actively gaming — you'll get a "Sleep now?" prompt.</div>
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
