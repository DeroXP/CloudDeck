// Auto-reconnect overlay. Shows the freeze frame + spinner while we try to
// re-establish the WebSocket. Times out and returns to home after 30s.

export class ReconnectOverlay {
  constructor({ realtime }) {
    this.realtime = realtime;
    this.el = document.getElementById('reconnect');
    this.disconnectAt = 0;
    this.timeoutHandle = null;

    realtime.addEventListener('close', () => this.show());
    realtime.addEventListener('open', () => this.hide());
  }

  show() {
    this.el.classList.add('active');
    this.disconnectAt = Date.now();
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(() => this._fallback(), 30_000);
  }

  hide() {
    this.el.classList.remove('active');
    clearTimeout(this.timeoutHandle);
  }

  _fallback() {
    if (this.el.classList.contains('active')) {
      // Still disconnected — kick the user back to the home view.
      const stream = document.getElementById('stream');
      if (stream) stream.classList.remove('cd-stream-active');
      document.getElementById('xmb').classList.remove('cd-xmb-hidden');
      this.hide();
      window.dispatchEvent(new CustomEvent('reconnect-failed'));
    }
  }
}
