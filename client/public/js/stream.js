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

    this.overlayBtn.addEventListener('click', () => this.toggleOverlay());
    this.exitBtn?.addEventListener('click', () => this.exitToXMB());
    input.addEventListener('home', () => this.toggleOverlay());

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

  async startStream({ game, settings, streamUrl }) {
    this.currentGame = game;
    this.active = true;
    this.startedAt = Date.now();
    this.streamEl.classList.add('cd-stream-active');
    this.overlayBtn.classList.remove('cd-hidden');
    this.exitBtn?.classList.remove('cd-hidden');
    document.getElementById('xmb').classList.add('cd-xmb-hidden');

    // If we got an explicit URL (Sunshine browser client), embed it. Otherwise
    // we render a placeholder explaining the connection.
    if (streamUrl) {
      this.streamFrame.src = streamUrl;
    } else {
      this.streamFrame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(`
        <html><body style="background:#000;color:#aab3c8;font-family:system-ui;margin:0;display:grid;place-items:center;height:100vh;">
          <div style="text-align:center;">
            <h2 style="color:#e63946;">Stream not configured</h2>
            <p>Sunshine browser client URL not set. Run Moonlight or open Sunshine's web stream directly.</p>
            <p style="font-size:12px;color:#aab3c8;">Now playing: ${game?.name || 'Unknown'}</p>
          </div>
        </body></html>
      `);
    }
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
    this.overlay.classList.remove('cd-overlay-active');
    document.getElementById('xmb').classList.remove('cd-xmb-hidden');
    this.streamFrame.src = 'about:blank';
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
