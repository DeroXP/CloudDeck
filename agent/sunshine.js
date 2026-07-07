// Thin client around the Sunshine HTTP API. Sunshine ships a config-web at
// :47990 (HTTPS, self-signed by default) and the stream itself runs on :47989
// for the browser client. We hit the config API to:
//   - list / launch / close "apps" (Sunshine's concept for launchable items)
//   - drive virtual display creation/teardown
//   - apply stream resolution/FPS/bitrate before a session starts
//
// The default Sunshine cert is self-signed. We tolerate that ONLY for this
// one client, using a node:https Agent with rejectUnauthorized:false scoped
// to these requests — NOT the process-global NODE_TLS_REJECT_UNAUTHORIZED,
// which would silently disable certificate verification for every other
// outbound HTTPS call the agent makes (Steam, Wikipedia, MS Store, GitHub
// updater) and open them to MITM. Using node:https keeps this dependency-free.

import https from 'node:https';
import http from 'node:http';

const LOOPBACK = /^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

export class SunshineClient {
  constructor({ url, username, password }) {
    this.url = url.replace(/\/+$/, '');
    this.auth = username ? `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` : null;
    // Skip cert verification only when Sunshine is on this machine (loopback).
    // A non-loopback HTTPS Sunshine URL keeps full TLS verification.
    this.httpsAgent = new https.Agent({ rejectUnauthorized: !LOOPBACK.test(this.url) });
  }

  _request(path, init = {}) {
    const target = new URL(this.url + path);
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    if (this.auth) headers.Authorization = this.auth;

    return new Promise((resolve, reject) => {
      const req = lib.request(
        target,
        {
          method: init.method || 'GET',
          headers,
          agent: isHttps ? this.httpsAgent : undefined,
          timeout: 5000,
        },
        res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`Sunshine ${path} → ${res.statusCode}`));
            }
            const ct = res.headers['content-type'] || '';
            if (ct.includes('application/json')) {
              try { resolve(JSON.parse(body)); }
              catch { resolve(body); }
            } else {
              resolve(body);
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(`Sunshine ${path} timed out`)));
      if (init.body) req.write(init.body);
      req.end();
    });
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
