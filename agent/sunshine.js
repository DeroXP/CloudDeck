// Thin client around the Sunshine HTTP API. Sunshine ships a config-web at
// :47990 (HTTPS, self-signed by default) and the stream itself runs on :47989
// for the browser client. We hit the config API to:
//   - list / launch / close "apps" (Sunshine's concept for launchable items)
//   - drive virtual display creation/teardown
//   - apply stream resolution/FPS/bitrate before a session starts
//
// The default Sunshine cert is self-signed so we deliberately disable TLS
// verification for localhost. This is fine because the agent runs on the same
// host as Sunshine.

import https from 'node:https';

export class SunshineClient {
  constructor({ url, username, password }) {
    this.url = url.replace(/\/+$/, '');
    this.auth = username ? `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` : null;
    this.agent = new https.Agent({ rejectUnauthorized: false });
  }

  async _request(path, init = {}) {
    const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    if (this.auth) headers.Authorization = this.auth;
    const res = await fetch(this.url + path, {
      ...init,
      headers,
      // Node 20+ supports `dispatcher` for undici; for simple cases we just
      // disable TLS verification globally via an env hint if needed.
      // We can't pass `https.Agent` to global fetch directly, so for HTTPS
      // self-signed cases we set NODE_TLS_REJECT_UNAUTHORIZED at startup if
      // SUNSHINE_URL is HTTPS to localhost. See index.js startup.
    });
    if (!res.ok) {
      throw new Error(`Sunshine ${path} → ${res.status}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  async health() {
    try {
      await this._request('/api/apps');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async listApps() {
    return this._request('/api/apps').catch(() => ({ apps: [] }));
  }

  async launchApp(appId) {
    // Sunshine's app launch endpoint varies by version; both are tried.
    try {
      return await this._request(`/api/launch?uuid=${encodeURIComponent(appId)}`, { method: 'POST' });
    } catch {
      return this._request(`/api/apps/launch`, {
        method: 'POST',
        body: JSON.stringify({ uuid: appId }),
      });
    }
  }

  async closeApp() {
    try {
      return await this._request('/api/apps/close', { method: 'POST' });
    } catch {
      return this._request('/api/close', { method: 'POST' });
    }
  }

  // Apply stream config. Sunshine accepts config via a PATCH/POST to /api/config
  // depending on version. We send a permissive payload and ignore errors so a
  // version mismatch doesn't block game launch.
  async applyStreamConfig({ width, height, fps, bitrate }) {
    try {
      await this._request('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          fps: String(fps),
          min_log_level: '2',
          resolution: `${width}x${height}`,
          bitrate: String(bitrate),
        }),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // Browser stream URL the frontend embeds in the in-game view.
  // Sunshine has a built-in (work-in-progress) web client; a community fork
  // (moonlight-web) also exposes this URL. We return what we have and let the
  // browser handle WebRTC negotiation directly with Sunshine.
  browserStreamUrl(streamBaseUrl, appId) {
    const base = streamBaseUrl.replace(/\/+$/, '');
    return `${base}/?app=${encodeURIComponent(appId || '')}`;
  }
}
