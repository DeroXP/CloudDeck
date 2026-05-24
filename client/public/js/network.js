// Network quality indicator + ping widget. Subscribes to the realtime
// connection's ping events, classifies the combined picture into one of three
// bands, and updates the header chip.

const BANDS = [
  { id: 'green',  label: 'Competitive Ready', max: { ping: 40,  jitter: 5,   loss: 0.5 } },
  { id: 'yellow', label: 'Casual Only',       max: { ping: 80,  jitter: 20,  loss: 2.0 } },
  { id: 'red',    label: 'Poor Connection',   max: { ping: Infinity, jitter: Infinity, loss: 100 } },
];

export class NetworkIndicator {
  constructor({ realtime }) {
    this.realtime = realtime;
    this.dotEl = document.getElementById('net-dot');
    this.textEl = document.getElementById('net-text');
    this.pingEl = document.getElementById('ping-text');
    this.lastBand = null;
    this.realtime.addEventListener('ping', e => this._update(e.detail));
  }

  _update({ ping, jitter, loss = 0 }) {
    const band = BANDS.find(b => ping <= b.max.ping && jitter <= b.max.jitter && loss <= b.max.loss);
    this.dotEl.classList.remove('green', 'yellow', 'red', 'grey');
    this.dotEl.classList.add(band.id);
    this.textEl.textContent = band.label;
    this.pingEl.textContent = `${ping}ms`;
    if (band.id !== this.lastBand) {
      this.lastBand = band.id;
      this._maybeAdaptBitrate(band);
    }
  }

  _maybeAdaptBitrate(band) {
    // Hook left intentionally simple. When we go red mid-stream we can ask
    // the agent to step down Sunshine's bitrate. This is best-effort; the
    // window.dispatchEvent lets stream.js act on it.
    window.dispatchEvent(new CustomEvent('network-band', { detail: { band: band.id } }));
  }
}
