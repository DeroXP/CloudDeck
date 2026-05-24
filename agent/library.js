// Game library scanning.
//
// Steam:
//   Steam exposes a tiny local HTTP API on :27060 that includes /v1/installed
//   returning installed apps. That endpoint is disabled by default in
//   recent Steam clients, so the real workhorse is the .acf fallback:
//   read the Steam install path from the registry, walk libraryfolders.vdf
//   to find every Steam library on every drive, then parse each
//   appmanifest_*.acf for the appid + name.
//
// Xbox / Game Pass:
//   Microsoft Store / Xbox games install into a configurable directory
//   (typically C:\XboxGames\<GameName>\<Content>\...). Every folder under
//   there contains a MicrosoftGame.config — both real games AND DLC stubs.
//   We discriminate by inspecting the config: DLC packages declare
//   <TargetDeviceFamilyForDLC> and <MainPackageDependency>, while real
//   games have an <ExecutableList> with at least one <Executable>. We use
//   the config's DefaultDisplayName for the title and fall back to the MS
//   Store catalog for art.

import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

// Per-launcher scanners — each exports detect() + scan(). They check for
// their own launcher being installed and return [] if not, so adding new
// ones doesn't affect users who don't have them.
import * as epic from './launchers/epic.js';
import * as battlenet from './launchers/battlenet.js';
import * as ea from './launchers/ea.js';
import * as ubisoft from './launchers/ubisoft.js';
import * as gog from './launchers/gog.js';

const EXTRA_LAUNCHERS = [
  { name: 'epic',      mod: epic },
  { name: 'battlenet', mod: battlenet },
  { name: 'ea',        mod: ea },
  { name: 'ubisoft',   mod: ubisoft },
  { name: 'gog',       mod: gog },
];

const execAsync = promisify(exec);

const STEAM_BOX_ART = id =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
const STEAM_HEADER = id =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;

export class Library {
  constructor() {
    this.cache = null;
    this.cacheAt = 0;
    this._cachedSteamRoot = undefined; // undefined = not looked up, null = looked and not found
  }

  async fetch({ refresh = false } = {}) {
    if (!refresh && this.cache && Date.now() - this.cacheAt < 30_000) {
      return this.cache;
    }
    // Steam + Xbox have their own scanners (legacy methods on this class).
    // Every other launcher lives in agent/launchers/ and gets walked here in
    // parallel. detect() runs first so we only do the work if the launcher
    // exists; this keeps the scan fast for users who only have a couple
    // launchers installed.
    const platformScans = await Promise.all([
      this._steam().catch(err => { console.warn('[library] steam:', err.message); return []; }),
      this._xbox().catch(err => { console.warn('[library] xbox:', err.message); return []; }),
      ...EXTRA_LAUNCHERS.map(async ({ name, mod }) => {
        try {
          if (!(await mod.detect())) return [];
          const games = await mod.scan();
          if (games.length > 0) console.log(`[library] ${name}: ${games.length} games`);
          return games;
        } catch (err) {
          console.warn(`[library] ${name} scan failed:`, err.message);
          return [];
        }
      }),
    ]);
    const [steam, xbox, ...extras] = platformScans;
    const flat = [...steam, ...xbox, ...extras.flat()];

    // Dedupe by id (in case the same game appears in multiple registries)
    const seen = new Set();
    const games = flat
      .filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; })
      .sort((a, b) => a.name.localeCompare(b.name));

    const breakdown = {};
    for (const g of games) breakdown[g.platform] = (breakdown[g.platform] || 0) + 1;
    console.log(`[library] total: ${games.length} games — ${Object.entries(breakdown).map(([p, n]) => `${p} ${n}`).join(', ')}`);

    this.cache = { games, scannedAt: Date.now() };
    this.cacheAt = Date.now();
    return this.cache;
  }

  // ---- Steam ----

  async _steam() {
    // Preferred path: local Steam HTTP API (disabled by default in current Steam,
    // but still nice to support for users who turn it on).
    try {
      const res = await fetch(`${config.steam.apiUrl}/v1/installed`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        const installed = data.installed || data.apps || [];
        if (installed.length > 0) return installed.map(app => this._mapSteam(app));
      }
    } catch {
      // fall through to filesystem scan
    }
    return this._steamFromAcf();
  }

  async _steamFromAcf() {
    const steamRoot = await this._resolveSteamRoot();
    if (!steamRoot) {
      console.warn('[library] Steam install not found (registry + common paths failed)');
      return [];
    }

    const libraryVdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    let libraries = await this._parseLibraryFolders(libraryVdf).catch(err => {
      console.warn(`[library] could not parse ${libraryVdf}: ${err.message} — falling back to single root`);
      return [steamRoot];
    });
    if (!libraries || libraries.length === 0) libraries = [steamRoot];

    const games = [];
    for (const lib of libraries) {
      const dir = path.join(lib, 'steamapps');
      let entries;
      try { entries = await fs.readdir(dir); }
      catch (err) {
        console.warn(`[library] skipping unreadable library ${dir}: ${err.message}`);
        continue;
      }
      for (const entry of entries) {
        if (!entry.startsWith('appmanifest_') || !entry.endsWith('.acf')) continue;
        try {
          const raw = await fs.readFile(path.join(dir, entry), 'utf8');
          const appid = /"appid"\s+"(\d+)"/.exec(raw)?.[1];
          const name = /"name"\s+"([^"]+)"/.exec(raw)?.[1];
          if (appid && name && !isSteamSystemApp(appid, name)) {
            games.push(this._mapSteam({ appid, name }));
          }
        } catch { /* skip unreadable manifest */ }
      }
    }
    return games;
  }

  async _resolveSteamRoot() {
    if (this._cachedSteamRoot !== undefined) return this._cachedSteamRoot;

    // 1. Windows registry (the source of truth)
    const fromRegistry = await this._readSteamRegistry();
    if (fromRegistry) {
      this._cachedSteamRoot = fromRegistry;
      console.log(`[library] Steam root (registry): ${fromRegistry}`);
      return fromRegistry;
    }

    // 2. Common install paths
    const candidates = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'E:\\Steam',
      // Allow STEAM_USER_DATA_DIR env var to act as an override; userdata is
      // always at <steamRoot>\userdata so one parent up is the root.
      path.dirname(config.steam.userDataDir),
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(path.join(candidate, 'steam.exe'));
        this._cachedSteamRoot = candidate;
        console.log(`[library] Steam root (filesystem): ${candidate}`);
        return candidate;
      } catch { /* try next */ }
    }

    this._cachedSteamRoot = null;
    return null;
  }

  async _readSteamRegistry() {
    const tryKey = async (cmd) => {
      try {
        const { stdout } = await execAsync(cmd, { timeout: 3000 });
        const p = stdout.trim().replace(/\//g, '\\');
        return p.length > 0 ? p : null;
      } catch { return null; }
    };
    return (
      await tryKey(`powershell -NoProfile -Command "(Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam' -Name InstallPath -ErrorAction SilentlyContinue).InstallPath"`)
      || await tryKey(`powershell -NoProfile -Command "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Valve\\Steam' -Name InstallPath -ErrorAction SilentlyContinue).InstallPath"`)
      || await tryKey(`powershell -NoProfile -Command "(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -Name SteamPath -ErrorAction SilentlyContinue).SteamPath"`)
    );
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

  // ---- Xbox / Game Pass ----

  async _xbox() {
    let entries;
    try {
      entries = await fs.readdir(config.xboxGamesDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    // Load the installed-apps map once. shell:appsfolder\<AUMID> is the only
    // reliable way to launch UWP/Xbox apps — the AUMID can't be derived from
    // the appx Identity alone (it needs the publisher-hash suffix and the
    // app-id, neither of which lives in MicrosoftGame.config).
    const aumidMap = await this._loadAumidMap();

    const games = [];
    let dlcSkipped = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(config.xboxGamesDir, entry.name);
      const game = await this._readXboxGame(folder, entry.name, aumidMap);
      if (game) games.push(game);
      else dlcSkipped++;
    }
    if (dlcSkipped > 0) {
      console.log(`[library] Xbox: filtered ${dlcSkipped} non-game folders (DLC / stubs)`);
    }
    return games;
  }

  // Walk Get-StartApps to learn every installed UWP/Xbox app's real AUMID.
  // The map is keyed on a normalized form of the display name so we can fuzzy-
  // match against the DefaultDisplayName from MicrosoftGame.config.
  async _loadAumidMap() {
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "Get-StartApps | Where-Object { $_.AppID -match '!' } | Select-Object Name, AppID | ConvertTo-Json -Compress"`,
        { timeout: 5000 },
      );
      const raw = JSON.parse(stdout);
      const list = Array.isArray(raw) ? raw : [raw];
      const map = new Map();
      for (const app of list) {
        const key = normalizeAppName(app.Name);
        if (key) map.set(key, app.AppID);
      }
      return map;
    } catch (err) {
      console.warn('[library] Get-StartApps failed (Xbox launches will fall back):', err.message);
      return new Map();
    }
  }

  // Returns a game record, or null if the folder is a DLC pack / stub.
  async _readXboxGame(folder, folderName, aumidMap) {
    const configPath = path.join(folder, 'Content', 'MicrosoftGame.config');
    let xml;
    try { xml = await fs.readFile(configPath, 'utf8'); }
    catch { return null; }   // no config → not a known Xbox/Game Pass install

    // DLC discriminators — both elements only appear in DLC manifests.
    if (/<TargetDeviceFamilyForDLC\b/i.test(xml)) return null;
    if (/<MainPackageDependency\b/i.test(xml)) return null;

    // Require an <Executable> entry — real games declare at least one.
    const exeMatch = /<Executable[^>]+Name="([^"]+\.exe)"/i.exec(xml);
    if (!exeMatch) return null;
    const exeName = exeMatch[1];

    // Pull display name + identity from the config (more reliable than folder name).
    const displayName =
      /DefaultDisplayName="([^"]+)"/i.exec(xml)?.[1]
      || /<DefaultDisplayName>([^<]+)<\/DefaultDisplayName>/i.exec(xml)?.[1]
      || folderName;
    const identityName = /<Identity[^>]+Name="([^"]+)"/i.exec(xml)?.[1] || folderName;

    // Best-effort art lookup; never block on it.
    const meta = await this._lookupXboxMeta(displayName).catch(() => null);

    // Find the real AUMID by matching the display name against Get-StartApps.
    // Fall back to the identity name (likely won't launch) so we still get a
    // game record in the grid — at least the user sees it.
    const cleanName = (meta?.title || displayName).replace(/[®™©]/g, '').trim();
    const aumid =
      aumidMap.get(normalizeAppName(cleanName))
      || aumidMap.get(normalizeAppName(displayName))
      || aumidMap.get(normalizeAppName(folderName));
    const launchUrl = `shell:appsfolder\\${aumid || identityName}`;

    return {
      id: `xbox:${slugify(identityName)}`,
      gameId: meta?.productId || slugify(identityName),
      name: cleanName,
      platform: 'xbox',
      art: meta?.art || null,
      launchUrl,
      aumid: aumid || null,
      folder,
      executable: exeName,
    };
  }

  async _lookupXboxMeta(displayName) {
    // The MS Store Display Catalog API is publicly readable. We do a soft
    // lookup; failures are non-fatal — the UI falls back to the folder name
    // and the art placeholder.
    try {
      const q = encodeURIComponent(displayName);
      const url = `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&query=${q}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const data = await res.json();
      const hit = data.Products?.[0];
      if (!hit) return null;
      const productId = hit.ProductId;
      const title = hit.LocalizedProperties?.[0]?.ProductTitle;
      const images = hit.LocalizedProperties?.[0]?.Images || [];
      const poster = images.find(i => i.ImagePurpose === 'Poster')
        || images.find(i => i.ImagePurpose === 'BoxArt')
        || images[0];
      return {
        productId,
        title,
        art: poster?.Uri ? (poster.Uri.startsWith('//') ? `https:${poster.Uri}` : poster.Uri) : null,
        // Deliberately NO launchUri here — the MS Store product-detail-page
        // URI (ms-windows-store://pdp/?productid=...) just opens the Store,
        // it doesn't launch the game. Real launch URIs come from Get-StartApps.
      };
    } catch {
      return null;
    }
  }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Aggressively normalize a display name so we can match across:
//   - DefaultDisplayName in MicrosoftGame.config ("Call of Duty®")
//   - Get-StartApps Name ("Call of Dutyr" — ® mangled to 'r' on some systems)
//   - MS Store catalog title ("Call of Duty")
//   - Folder name ("Call of Duty")
function normalizeAppName(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Filter out Steam's bundled tools/runtimes/redistributables that show up as
// "installed apps" but aren't games. Returns true if the entry should be
// SKIPPED from the library grid. (Earlier version had this inverted —
// SteamVR and Steamworks Common Redistributables were leaking through.)
const STEAM_SYSTEM_APPIDS = new Set([
  '228980',   // Steamworks Common Redistributables
  '231350',   // Steamworks SDK Redist
  '250820',   // SteamVR (runtime, not a game — VR titles auto-launch it)
  // Steam Linux Runtimes
  '1070560', '1391110', '1628350',
  // Proton versions — every one of these gets installed as a "library" entry
  '858280', '961940', '1054830', '1113280', '1245040',
  '1420170', '1493710', '1887720', '2230260', '2348590',
  '480',      // Spacewar, Steam's dev/test app
]);

function isSteamSystemApp(appid, name) {
  if (STEAM_SYSTEM_APPIDS.has(appid)) return true;
  if (/^Proton\b/i.test(name)) return true;
  if (/^Steam Linux Runtime/i.test(name)) return true;
  if (/^Steamworks\b/i.test(name)) return true;
  return false;
}
