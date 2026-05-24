// Pi WoL forwarder client. Posts to the Pi's Flask endpoint with a shared secret.

export class PiClient {
  constructor({ url, token }) {
    this.url = url;
    this.token = token;
  }

  configured() {
    return !!(this.url && this.token);
  }

  async wake() {
    if (!this.configured()) {
      throw new Error('Pi is not configured (PI_URL or PI_SECRET_TOKEN missing)');
    }
    const endpoint = new URL('/wake', this.url).toString();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ at: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Pi responded ${res.status}: ${text}`);
    }
    return res.json().catch(() => ({ ok: true }));
  }

  async ping() {
    if (!this.configured()) return { reachable: false, reason: 'not-configured' };
    try {
      const endpoint = new URL('/health', this.url).toString();
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(3000),
      });
      return { reachable: res.ok, status: res.status };
    } catch (err) {
      return { reachable: false, reason: err.message };
    }
  }
}
