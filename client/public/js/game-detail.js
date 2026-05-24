// Game detail modal. Slides in from the right when a game card is clicked.
// Shows hero art, store description, screenshot gallery (Steam Storefront API,
// public, no key needed), aggregated play stats from session history, and
// big Play/Stop buttons.
//
// The big PLAY button calls back into the launch flow we already have in
// main.js — this module never launches games itself, it just collects intent.

import { api } from './api.js';
import { focus } from './focus.js';
import { input } from './input.js';

const STEAM_HEADER = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
const STEAM_CAPSULE = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`;
// Steam Storefront isn't CORS-open, so we go through our own server-side
// proxy (/api/steam-meta/:appid) which forwards + caches the response.
const STEAM_STOREFRONT = id => `/api/steam-meta/${encodeURIComponent(id)}`;

// Microsoft Store displaycatalog proxy for Xbox titles. Also CORS-restricted
// when hit directly from the browser, so we route through the server.
const XBOX_CATALOG = id => `/api/xbox-meta/${encodeURIComponent(id)}`;

export class GameDetailModule extends EventTarget {
  constructor({ realtime }) {
    super();
    this.realtime = realtime;
    this.currentGame = null;
    this.activeGameId = null;     // game currently running on the PC (if any)

    this.el = document.getElementById('game-detail');
    this.bodyEl = document.getElementById('game-detail-body');
    this.closeBtn = document.getElementById('game-detail-close');

    this.closeBtn.addEventListener('click', () => this.close());

    // ESC / B closes the detail
    input.addEventListener('back', () => {
      if (this.isOpen()) this.close();
    });

    // Track which game (if any) is currently running on the PC so we can
    // swap Play ↔ Stop on the detail screen.
    this.realtime.addEventListener('msg:game-launched', e => {
      this.activeGameId = e.detail?.gameId || null;
      this._updatePlayStop();
    });
    this.realtime.addEventListener('msg:game-ended', () => {
      this.activeGameId = null;
      this._updatePlayStop();
    });
  }

  isOpen() {
    return this.el.classList.contains('cd-detail-active');
  }

  async open(game) {
    this.currentGame = game;
    this.el.classList.add('cd-detail-active');
    document.getElementById('xmb').classList.add('cd-xmb-hidden');

    // Render the skeleton immediately so the modal doesn't feel sluggish
    // while we wait for Steam Storefront + stats fetches.
    this._renderSkeleton(game);

    // Fire fetches in parallel; render as each lands.
    const [stats, meta] = await Promise.all([
      api.gameStats(game.gameId || game.id).catch(() => null),
      this._fetchMeta(game).catch(() => null),
    ]);
    this._renderFull(game, meta, stats);
  }

  // Dispatch to the right metadata fetcher based on platform.
  async _fetchMeta(game) {
    if (game.platform === 'steam')  return this._fetchSteamMeta(game);
    if (game.platform === 'xbox')   return this._fetchXboxMeta(game);
    return null;
  }

  close() {
    this.el.classList.remove('cd-detail-active');
    document.getElementById('xmb').classList.remove('cd-xmb-hidden');
    this.currentGame = null;
    focus.setActiveGroup('items-games');
    this.dispatchEvent(new Event('closed'));
  }

  async _fetchSteamMeta(game) {
    if (!game.gameId) return null;
    const res = await fetch(STEAM_STOREFRONT(game.gameId), {
      signal: AbortSignal.timeout(8000),
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const payload = data?.[game.gameId];
    if (!payload?.success) return null;
    const d = payload.data;
    return {
      description: stripHtml(d.short_description || ''),
      hero: d.header_image || STEAM_HEADER(game.gameId),
      capsule: STEAM_CAPSULE(game.gameId),
      screenshots: (d.screenshots || []).slice(0, 12).map(s => s.path_full),
      genres: (d.genres || []).map(g => g.description),
    };
  }

  // MS Store catalog lookup. game.gameId for Xbox is the ProductId
  // (e.g. "9P0BJSGTBJTG"). The catalog response uses the same Images
  // array as the library scanner — we just filter for Screenshot purpose
  // here instead of Poster.
  async _fetchXboxMeta(game) {
    if (!game.gameId) return null;
    // ProductIds are 12 alphanumeric chars; skip the synthetic slug ids
    // that the agent falls back to when no MS Store hit was found.
    if (!/^[A-Za-z0-9]{12}$/.test(game.gameId)) return null;
    const res = await fetch(XBOX_CATALOG(game.gameId), {
      signal: AbortSignal.timeout(8000),
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const product = data?.Products?.[0];
    if (!product) return null;
    const loc = product.LocalizedProperties?.[0] || {};
    const images = loc.Images || [];
    const fixUri = u => u?.startsWith('//') ? `https:${u}` : u;
    const hero = images.find(i => i.ImagePurpose === 'SuperHeroArt')
      || images.find(i => i.ImagePurpose === 'Hero')
      || images.find(i => i.ImagePurpose === 'FeaturePromotionalSquareArt')
      || images.find(i => i.ImagePurpose === 'Poster')
      || images.find(i => i.ImagePurpose === 'BoxArt');
    const screenshots = images
      .filter(i => i.ImagePurpose === 'Screenshot')
      .slice(0, 12)
      .map(i => fixUri(i.Uri));
    return {
      description: stripHtml(loc.ProductDescription || loc.ShortDescription || ''),
      hero: fixUri(hero?.Uri) || null,
      screenshots,
      genres: (product.Properties?.Categories || []).slice(0, 6),
    };
  }

  _renderSkeleton(game) {
    const hero = game.art || (game.platform === 'steam' ? STEAM_HEADER(game.gameId) : '');
    this.bodyEl.innerHTML = `
      <div class="cd-detail-hero" style="${hero ? `background-image:url(${escapeAttr(hero)})` : ''}">
        <div class="cd-detail-hero-shade"></div>
        <div class="cd-detail-hero-content">
          <div class="cd-detail-platform">${(game.platform || '').toUpperCase()}</div>
          <h1 class="cd-detail-title">${escapeHtml(game.name)}</h1>
        </div>
      </div>
      <div class="cd-detail-body">
        <div class="cd-detail-actions">
          <button id="game-play-btn" class="cd-detail-play">▶  Play</button>
          <button id="game-stop-btn" class="cd-detail-stop cd-hidden">■  Stop</button>
        </div>
        <div class="cd-detail-stats">
          <div class="cd-detail-stat">
            <div class="cd-detail-stat-label">Time Played</div>
            <div class="cd-detail-stat-value" data-k="time">—</div>
          </div>
          <div class="cd-detail-stat">
            <div class="cd-detail-stat-label">Sessions</div>
            <div class="cd-detail-stat-value" data-k="count">—</div>
          </div>
          <div class="cd-detail-stat">
            <div class="cd-detail-stat-label">Last Played</div>
            <div class="cd-detail-stat-value" data-k="last">—</div>
          </div>
        </div>
        <div class="cd-detail-section">
          <h3>About</h3>
          <p class="cd-detail-desc" data-k="desc"><em style="opacity:0.5">Loading…</em></p>
        </div>
        <div class="cd-detail-section" data-k="gallery-wrap" style="display:none">
          <h3>Gallery</h3>
          <div class="cd-detail-gallery" data-k="gallery"></div>
        </div>
        <div class="cd-detail-section" data-k="genres-wrap" style="display:none">
          <h3>Tags</h3>
          <div class="cd-detail-tags" data-k="genres"></div>
        </div>
      </div>
    `;

    const playBtn = this.bodyEl.querySelector('#game-play-btn');
    const stopBtn = this.bodyEl.querySelector('#game-stop-btn');
    playBtn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('play', { detail: { game } }));
    });
    stopBtn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('stop', { detail: { game } }));
    });

    focus.unregisterGroup('game-detail');
    this.bodyEl.querySelectorAll('button').forEach(btn => focus.register('game-detail', btn));
    focus.setActiveGroup('game-detail');
    focus.setFocus('game-detail', playBtn);
    this._updatePlayStop();
  }

  _renderFull(game, meta, stats) {
    // Stats
    const set = (k, v) => {
      const el = this.bodyEl.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = v;
    };
    if (stats) {
      const hours = stats.totalSeconds / 3600;
      set('time', hours >= 1 ? `${hours.toFixed(1)} hrs` : stats.totalSeconds > 0 ? `${Math.round(stats.totalSeconds / 60)} min` : '0');
      set('count', stats.playCount);
      set('last', stats.lastPlayed ? relativeTime(stats.lastPlayed) : 'Never');
    }

    // Description
    if (meta?.description) {
      set('desc', meta.description);
    } else {
      set('desc', 'No description available.');
    }

    // Gallery
    if (meta?.screenshots?.length) {
      const wrap = this.bodyEl.querySelector('[data-k="gallery-wrap"]');
      const gallery = this.bodyEl.querySelector('[data-k="gallery"]');
      wrap.style.display = '';
      gallery.innerHTML = meta.screenshots.map(url =>
        `<div class="cd-detail-shot" style="background-image:url(${escapeAttr(url)})" data-url="${escapeAttr(url)}"></div>`
      ).join('');
      gallery.querySelectorAll('.cd-detail-shot').forEach(s => {
        s.addEventListener('click', () => openLightbox(s.dataset.url));
      });
    }

    // Genre tags
    if (meta?.genres?.length) {
      const wrap = this.bodyEl.querySelector('[data-k="genres-wrap"]');
      const tags = this.bodyEl.querySelector('[data-k="genres"]');
      wrap.style.display = '';
      tags.innerHTML = meta.genres.map(g => `<span class="cd-detail-tag">${escapeHtml(g)}</span>`).join('');
    }

    // Larger hero if Steam gave us a better one
    if (meta?.hero) {
      const hero = this.bodyEl.querySelector('.cd-detail-hero');
      if (hero) hero.style.backgroundImage = `url(${meta.hero})`;
    }
  }

  _updatePlayStop() {
    const playBtn = this.bodyEl.querySelector('#game-play-btn');
    const stopBtn = this.bodyEl.querySelector('#game-stop-btn');
    if (!playBtn || !stopBtn) return;
    const isThisGameRunning = this.currentGame
      && this.activeGameId
      && (this.activeGameId === this.currentGame.id || this.activeGameId === this.currentGame.gameId);
    playBtn.classList.toggle('cd-hidden', !!isThisGameRunning);
    stopBtn.classList.toggle('cd-hidden', !isThisGameRunning);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
function openLightbox(url) {
  const lb = document.createElement('div');
  lb.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.95);display:grid;place-items:center;cursor:zoom-out;';
  lb.innerHTML = `<img src="${url}" style="max-width:96vw;max-height:92vh;border-radius:8px;" />`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}
