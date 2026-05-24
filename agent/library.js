// Game library scanning.
//
// Steam:
//   Steam exposes a tiny local HTTP API on :27060 that includes /v1/installed
//   returning installed apps. If that's unavailable (older Steam, disabled in
//   settings) we fall back to parsing libraryfolders.vdf + appmanifest_*.acf
//   from the Steam install — the OG approach that's been stable for ~20 years.
//
// Xbox / Game Pass:
//   Microsoft Store / Xbox games install into a configurable directory
//   (typically C:\XboxGames\<GameName>\<Content>\...). We scan the directory
//   for top-level folders, then ask Microsoft's Display Catalog for proper
//   titles + box art keyed on the folder name. The catalog is queried by
//   product ID where possible, falling back to a slugged folder name.

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const STEAM_BOX_ART = id =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
const STEAM_HEADER = id =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;

export class Library {
  constructor() {
    this.cache = null;
    this.cacheAt = 0;
  }

  async fetch({ refresh = false } = {}) {
    if (!refresh && this.cache && Date.now() - this.cacheAt < 30_000) {
      return this.cache;
    }
    const [steam, xbox] = await Promise.all([
      this._steam().catch(err => {
        console.warn('[library] steam scan failed:', err.message);
        return [];
      }),
      this._xbox().catch(err => {
        console.warn('[library] xbox scan failed:', err.message);
        return [];
      }),
    ]);
    const games = [...steam, ...xbox].sort((a, b) => a.name.localeCompare(b.name));
    this.cache = { games, scannedAt: Date.now() };
    this.cacheAt = Date.now();
    return this.cache;
  }

  async _steam() {
    // Preferred path: local Steam HTTP API
    try {
      const res = await fetch(`${config.steam.apiUrl}/v1/installed`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        const installed = data.installed || data.apps || [];
        return installed.map(app => this._mapSteam(app));
      }
    } catch {
      // fall through to filesystem scan
    }

    // Fallback: parse Steam libraryfolders.vdf + appmanifest_*.acf
    return this._steamFromAcf();
  }

  async _steamFromAcf() {
    // Find Steam install root from STEAM_USER_DATA_DIR (../../steamapps)
    const steamRoot = path.dirname(path.dirname(config.steam.userDataDir));
    const libraryVdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    const libraries = await this._parseLibraryFolders(libraryVdf).catch(() => [path.join(steamRoot, 'steamapps')]);

    const games = [];
    for (const lib of libraries) {
      const dir = path.join(lib, 'steamapps');
      let entries;
      try { entries = await fs.readdir(dir); }
      catch { continue; }
      for (const entry of entries) {
        if (!entry.startsWith('appmanifest_') || !entry.endsWith('.acf')) continue;
        try {
          const raw = await fs.readFile(path.join(dir, entry), 'utf8');
          const appid = /"appid"\s+"(\d+)"/.exec(raw)?.[1];
          const name = /"name"\s+"([^"]+)"/.exec(raw)?.[1];
          if (appid && name) {
            games.push(this._mapSteam({ appid, name }));
          }
        } catch { /* skip */ }
      }
    }
    return games;
  }

  async _parseLibraryFolders(vdfPath) {
    const raw = await fs.readFile(vdfPath, 'utf8');
    const matches = [...raw.matchAll(/"path"\s+"([^"]+)"/g)];
    return matches.map(m => m[1].replace(/\\\\/g, '\\'));
  }

  _mapSteam({ appid, name }) {
    return {
      id: `steam:${appid}`,
      gameId: appid,
      name,
      platform: 'steam',
      art: STEAM_BOX_ART(appid),
      header: STEAM_HEADER(appid),
      launchUrl: `steam://rungameid/${appid}`,
    };
  }

  async _xbox() {
    let entries;
    try {
      entries = await fs.readdir(config.xboxGamesDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const games = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      // Folder names tend to be human-readable for Game Pass games
      // (e.g., "Halo Infinite", "Forza Horizon 5"). For unknown titles we
      // best-effort search the MS Store catalog.
      const meta = await this._lookupXboxMeta(folderName);
      games.push({
        id: `xbox:${slugify(folderName)}`,
        gameId: meta?.productId || slugify(folderName),
        name: meta?.title || folderName,
        platform: 'xbox',
        art: meta?.art || null,
        // Launch URI — Xbox/Game Pass titles support shell:appsfolder & ms-xbox:// launches
        launchUrl: meta?.launchUri || `shell:appsfolder\\${folderName}`,
        folder: path.join(config.xboxGamesDir, folderName),
      });
    }
    return games;
  }

  async _lookupXboxMeta(folderName) {
    // The MS Store Display Catalog API is publicly readable. We do a soft
    // lookup; failures are non-fatal — the UI falls back to the folder name
    // and the art placeholder.
    try {
      const q = encodeURIComponent(folderName);
      const url = `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&query=${q}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const data = await res.json();
      const hit = data.Products?.[0];
      if (!hit) return null;
      const productId = hit.ProductId;
      const title = hit.LocalizedProperties?.[0]?.ProductTitle;
      const images = hit.LocalizedProperties?.[0]?.Images || [];
      // Pick a tall poster if available, fall back to widest
      const poster = images.find(i => i.ImagePurpose === 'Poster')
        || images.find(i => i.ImagePurpose === 'BoxArt')
        || images[0];
      return {
        productId,
        title,
        art: poster?.Uri ? (poster.Uri.startsWith('//') ? `https:${poster.Uri}` : poster.Uri) : null,
        launchUri: `ms-windows-store://pdp/?productid=${productId}`,
      };
    } catch {
      return null;
    }
  }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
