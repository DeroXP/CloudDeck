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
        <span class="cd-game-platform cd-platform-${escapeAttr(game.platform || 'unknown')}" title="${badge.label}">${badge.letter}</span>
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

// Single-letter badge per platform with the brand's primary color. Just
// initials in colored circles — recognizable without copying trademarked
// logos. The actual color is in the CSS class .cd-platform-<platform>.
const PLATFORM_BADGES = {
  steam:     { letter: 'S', label: 'Steam' },
  xbox:      { letter: 'X', label: 'Xbox / Game Pass' },
  epic:      { letter: 'E', label: 'Epic Games' },
  battlenet: { letter: 'B', label: 'Battle.net' },
  ea:        { letter: 'E', label: 'EA App' },
  ubisoft:   { letter: 'U', label: 'Ubisoft Connect' },
  gog:       { letter: 'G', label: 'GOG Galaxy' },
};
function platformBadge(platform) {
  return PLATFORM_BADGES[platform] || { letter: '?', label: 'Unknown' };
}

function timeAgo(t) {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
