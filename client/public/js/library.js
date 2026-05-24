// Games library renderer + last-played shortcuts.

import { api } from './api.js';
import { focus } from './focus.js';

export class LibraryModule {
  constructor({ realtime, onLaunch, onSelect }) {
    this.realtime = realtime;
    this.onLaunch = onLaunch;     // direct launch (used by shortcut tiles)
    this.onSelect = onSelect;     // open detail modal (used by grid cards)
    this.games = [];
    this.lastPlayed = [];
    // Live updates from agent
    this.realtime.addEventListener('msg:library', e => {
      this.games = e.detail?.games || [];
    });
  }

  async load() {
    const [lib, lp] = await Promise.all([api.library(), api.lastPlayed()]);
    this.games = lib?.games || [];
    this.lastPlayed = lp?.games || [];
    this._renderShortcuts();
  }

  _renderShortcuts() {
    const container = document.getElementById('shortcuts');
    if (!container) return;
    container.innerHTML = '';
    focus.unregisterGroup('shortcuts');

    if (this.lastPlayed.length === 0) return;
    for (const g of this.lastPlayed) {
      const el = document.createElement('div');
      el.className = 'cd-shortcut';
      if (g.art) el.style.backgroundImage = `url(${g.art})`;
      el.innerHTML = `
        <div class="cd-shortcut-name">${escapeHtml(g.name || g.gameId)}</div>
        <div class="cd-shortcut-time">${timeAgo(g.playedAt)}</div>
      `;
      el.addEventListener('click', () => this.onLaunch(g));
      focus.register('shortcuts', el);
      container.appendChild(el);
    }
  }

  // Renderer registered with XMB for the 'games' category
  render = async (root) => {
    focus.unregisterGroup('items-games');
    if (this.games.length === 0) {
      try {
        const lib = await api.library();
        this.games = lib?.games || [];
      } catch { /* empty library */ }
    }

    const grid = document.createElement('div');
    grid.className = 'cd-games';
    root.appendChild(grid);

    if (this.games.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--cd-fg-dim); padding:40px;">No games found. Make sure Steam is installed and the agent is connected.</div>';
      return;
    }

    for (const game of this.games) {
      const card = document.createElement('div');
      card.className = 'cd-game';
      const badge = platformBadge(game.platform);
      card.innerHTML = `
        <span class="cd-game-platform cd-platform-${escapeAttr(game.platform || 'unknown')}" title="${badge.label}" aria-label="${badge.label}">
          <span class="cd-platform-icon"></span>
        </span>
        ${game.art
          ? `<img alt="" loading="lazy" src="${escapeAttr(game.art)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid'" />
             <div class="cd-game-fallback" style="display:none"><span>${escapeHtml(game.name)}</span></div>`
          : `<div class="cd-game-fallback"><span>${escapeHtml(game.name)}</span></div>`
        }
        <div class="cd-game-meta">
          <strong>${escapeHtml(game.name)}</strong>
        </div>
      `;
      // Grid cards open the detail modal; from there the user hits Play.
      // This is the user-requested behavior: "I don't want the game to just
      // open and play — show details, gallery, achievements, play/stop."
      card.addEventListener('click', () => (this.onSelect || this.onLaunch)(game));
      focus.register('items-games', card);
      grid.appendChild(card);
    }
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Platform metadata for the badge in the top-right of each game card. Only
// the human-readable label lives here now; the visual (colored circle +
// masked brand SVG) is driven entirely from the CSS class
// .cd-platform-<platform>.
const PLATFORM_LABELS = {
  steam: 'Steam',
  xbox: 'Xbox / Game Pass',
  epic: 'Epic Games',
  battlenet: 'Battle.net',
  ea: 'EA App',
  ubisoft: 'Ubisoft Connect',
  gog: 'GOG Galaxy',
};
function platformBadge(platform) {
  return { label: PLATFORM_LABELS[platform] || 'Unknown' };
}

function timeAgo(t) {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
