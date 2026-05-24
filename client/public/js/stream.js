// In-game stream module. Embeds the Sunshine WebRTC browser client in an
// iframe pointing at the user's PC, manages the in-stream overlay (tab
// button + library overlay), and listens for game-ended events to roll the
// freeze-frame transition.

import { focus } from './focus.js';
import { input } from './input.js';

export class StreamModule extends EventTarget {
  constructor({ realtime, deviceId }) {
    super();
    this.realtime = realtime;
    this.deviceId = deviceId;
    this.active = false;
    this.currentGame = null;
    this.streamFrame = document.getElementById('stream-frame');
    this.streamEl = document.getElementById('stream');
    this.overlayBtn = document.getElementById('overlay-btn');
    this.overlay = document.getElementById('overlay');
    this.freeze = document.getElementById('freeze');

    this.exitBtn = document.getElementById('exit-stream-btn');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');

    this.overlayBtn.addEventListener('click', () => this.toggleOverlay());
    this.exitBtn?.addEventListener('click', () => this.exitToXMB());
    this.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    input.addEventListener('home', () => this.toggleOverlay());

    // Keep the button label in sync with browser fullscreen state, including
    // when the user exits with the Esc key.
    document.addEventListener('fullscreenchange', () => this._updateFullscreenBtn());

    // Esc / B button while a stream is active: close the overlay first if it's
    // open, otherwise tear the whole session down. This is the escape hatch
    // for "I clicked launch but nothing's actually streaming."
    input.addEventListener('back', () => {
      if (!this.active) return;
      if (this.overlay.classList.contains('cd-overlay-active')) {
        this.toggleOverlay();
      } else {
        this.exitToXMB();
      }
    });

    this.realtime.addEventListener('msg:game-launched', e => this._onGameLaunched(e.detail));
    this.realtime.addEventListener('msg:game-ended', e => this._onGameEnded(e.detail));
    this.realtime.addEventListener('msg:crash', e => this._onCrash(e.detail));
  }

  // Hard exit: ask the agent to close any tracked game + restore the
  // physical display + unmute speakers, then tear the local stream UI down.
  // Safe to call even if no game ever actually launched.
  async exitToXMB() {
    try { await this.realtime.sendCommand('stop-session', {}); } catch { /* agent may be offline */ }
    await this.stopStream();
    this.currentGame = null;
    this.startedAt = null;
    this.dispatchEvent(new Event('exited'));
  }

  async startStream({ game, settings, streamUrl, backend }) {
    this.currentGame = game;
    this.active = true;
    this.startedAt = Date.now();
    this.streamEl.classList.add('cd-stream-active');
    this.overlayBtn.classList.remove('cd-hidden');
    this.exitBtn?.classList.remove('cd-hidden');
    this.fullscreenBtn?.classList.remove('cd-hidden');
    document.getElementById('xmb').classList.add('cd-xmb-hidden');

    if (streamUrl) {
      this.streamFrame.src = streamUrl;
    } else {
      this.streamFrame.src = this._placeholderUrl(game, backend);
    }

    // Best-effort fullscreen — needs to be on the same task as the user gesture
    // that triggered launch, or Safari/Firefox will block it. Failing is fine;
    // the manual button is the fallback.
    try { await this.streamEl.requestFullscreen?.({ navigationUI: 'hide' }); }
    catch { /* user can hit the fullscreen button manually */ }
    this._updateFullscreenBtn();
  }

  _placeholderUrl(game, backend) {
    const name = (game?.name || 'Unknown').replace(/[<>"']/g, '');
    const body =
      backend === 'parsec' ? this._parsecPlaceholderBody(name) :
      backend === 'moonlight' ? this._moonlightPlaceholderBody(name) :
      this._sunshinePlaceholderBody(name);
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{background:#0a0e1a;color:#f4f6fb;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:24px;min-height:100vh;display:flex;align-items:center;justify-content:center;box-sizing:border-box;line-height:1.5}
.box{max-width:520px;background:rgba(20,24,40,0.7);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:28px;backdrop-filter:blur(10px)}
h1{margin:0 0 4px;color:#e63946;font-size:18px;letter-spacing:3px;text-transform:uppercase}
h2{margin:0 0 18px;font-size:13px;color:#aab3c8;letter-spacing:2px;text-transform:uppercase;font-weight:400}
p{font-size:14px;color:#cdd5e6;margin:8px 0}
ol{font-size:14px;color:#cdd5e6;padding-left:20px}
li{margin:6px 0}
code{background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;font-size:12px}
.btn{display:inline-block;margin-top:12px;padding:12px 22px;background:#e63946;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;letter-spacing:1px}
.btn:hover{background:#c92a37}
.now{margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.07);font-size:12px;color:#aab3c8}
a{color:#4c95ff}
</style></head><body><div class="box">${body}</div></body></html>`);
  }

  _parsecPlaceholderBody(name) {
    // Parsec doesn't expose a public custom URL scheme on iOS/Android that
    // we can deep-link into reliably, so we don't pretend with a button.
    // Plain instructions + App Store / Play Store links instead.
    return `
<h1>Launched on PC</h1><h2>Open Parsec to view</h2>
<p><strong>${name}</strong> is now running on your gaming PC. Open the <strong>Parsec</strong> app on this device, sign in with the same account you used on your PC, and tap your PC in the host list to start streaming.</p>
<p style="font-size:13px">Don't have Parsec installed yet?</p>
<p style="display:flex;gap:10px;flex-wrap:wrap">
  <a class="btn" href="https://apps.apple.com/app/parsec/id1330954781" target="_blank" style="padding:10px 18px;font-size:13px">iOS App Store</a>
  <a class="btn" href="https://play.google.com/store/apps/details?id=tv.parsec.client" target="_blank" style="padding:10px 18px;font-size:13px">Google Play</a>
  <a class="btn" href="https://parsec.app/downloads" target="_blank" style="padding:10px 18px;font-size:13px;background:transparent;border:1px solid #4c95ff;color:#4c95ff">Other platforms</a>
</p>
<div class="now">Now playing: <strong>${name}</strong></div>`;
  }

  _moonlightPlaceholderBody(name) {
    // iOS / iPadOS path. Parsec doesn't have an iOS app at all, so for
    // Apple devices Moonlight + Sunshine is the only free option.
    return `
<h1>Launched on PC</h1><h2>Open Moonlight to view</h2>
<p><strong>${name}</strong> is now running on your gaming PC. Open <strong>Moonlight</strong> on this device — your PC should auto-discover on the local network. Tap it, then pick the running game to start streaming.</p>
<p style="font-size:13px">Don't have Moonlight installed yet?</p>
<p style="display:flex;gap:10px;flex-wrap:wrap">
  <a class="btn" href="https://apps.apple.com/us/app/moonlight-game-streaming/id1000551566" target="_blank" style="padding:10px 18px;font-size:13px">iOS App Store</a>
  <a class="btn" href="https://play.google.com/store/apps/details?id=com.limelight" target="_blank" style="padding:10px 18px;font-size:13px">Google Play</a>
  <a class="btn" href="https://moonlight-stream.org/" target="_blank" style="padding:10px 18px;font-size:13px;background:transparent;border:1px solid #4c95ff;color:#4c95ff">Other platforms</a>
</p>
<p style="font-size:12px;color:#aab3c8">First-time pairing: Moonlight will show you a 4-digit PIN. CloudDeck's host (clouddeck) is already configured in Sunshine — paste the PIN in Sunshine's web UI at <code>https://&lt;your-pc-ip&gt;:47990</code> (or ask CloudDeck to send it for you).</p>
<div class="now">Now playing: <strong>${name}</strong></div>`;
  }

  _sunshinePlaceholderBody(name) {
    return `
<h1>Launched on PC</h1><h2>No in-browser viewer configured</h2>
<p>Sunshine is hosting the stream on your PC, but Sunshine doesn't ship a browser client — the easiest way to view it is the <strong>Moonlight</strong> app.</p>
<ol>
  <li>Install <a href="https://moonlight-stream.org/" target="_blank">Moonlight</a> on the device you want to play from.</li>
  <li>Open Moonlight on the same network as your PC and tap the PC tile.</li>
  <li>Pair using the PIN that Sunshine prompts for at <code>https://&lt;your-pc&gt;:47990</code>.</li>
  <li>Pick the running game and start streaming.</li>
</ol>
<div class="now">Now playing: <strong>${name}</strong></div>`;
  }

  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      this.streamEl.requestFullscreen?.({ navigationUI: 'hide' })
        .catch(err => console.warn('[stream] fullscreen request rejected:', err.message));
    }
  }

  _updateFullscreenBtn() {
    if (!this.fullscreenBtn) return;
    this.fullscreenBtn.textContent = document.fullscreenElement ? '⤡ Exit Fullscreen' : '⤢ Fullscreen';
  }

  async stopStream({ frame = null, glitch = false } = {}) {
    this.active = false;
    if (frame) {
      this.freeze.style.backgroundImage = `url(${frame})`;
      this.freeze.classList.remove('cd-hidden');
      if (glitch) this.freeze.classList.add('cd-glitch');
      setTimeout(() => {
        this.freeze.classList.remove('cd-glitch');
        this.freeze.style.filter = 'blur(20px)';
        setTimeout(() => {
          this.freeze.classList.add('cd-hidden');
          this.freeze.style.filter = '';
        }, 500);
      }, 600);
    }
    this.streamEl.classList.remove('cd-stream-active');
    this.overlayBtn.classList.add('cd-hidden');
    this.exitBtn?.classList.add('cd-hidden');
    this.fullscreenBtn?.classList.add('cd-hidden');
    this.overlay.classList.remove('cd-overlay-active');
    document.getElementById('xmb').classList.remove('cd-xmb-hidden');
    this.streamFrame.src = 'about:blank';
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  toggleOverlay() {
    if (!this.active) return;
    this.overlay.classList.toggle('cd-overlay-active');
    if (this.overlay.classList.contains('cd-overlay-active')) {
      focus.setActiveGroup('overlay-games');
    }
  }

  _onGameLaunched(detail) {
    this.dispatchEvent(new CustomEvent('launched', { detail }));
  }

  async _onGameEnded(detail) {
    const game = this.currentGame;
    const duration = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : detail.durationSeconds;
    this.dispatchEvent(new CustomEvent('ended', { detail: { ...detail, durationSeconds: duration } }));
    await this.stopStream({ frame: null, glitch: !detail.clean });

    // Record session (best effort)
    if (game) {
      try {
        const { api } = await import('./api.js');
        await api.recordSession({
          gameId: game.id,
          gameName: game.name,
          platform: game.platform,
          durationSeconds: duration,
          deviceId: this.deviceId,
          art: game.art,
          avgPing: this.realtime.pingMs,
        });
      } catch { /* ok */ }
    }
    this.currentGame = null;
    this.startedAt = null;
  }

  _onCrash(detail) {
    this.dispatchEvent(new CustomEvent('crash', { detail }));
  }
}
