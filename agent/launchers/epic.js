// Epic Games Launcher scanner.
//
// EGL stores per-game manifests as .item files (JSON) at
//   C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\
//
// Each file has DisplayName, LaunchExecutable, InstallLocation, AppName,
// and a CatalogNamespace + CatalogItemId pair that identifies the product
// for the store URL. Launch URI is com.epicgames.launcher://apps/<AppName>
// (with ?action=launch&silent=true so the launcher window doesn't pop up).

import fs from 'node:fs/promises';
import path from 'node:path';
import { ps } from './registry.js';

const DEFAULT_MANIFEST_DIR = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';

async function manifestDir() {
  // The user can customize where EGL puts manifests; canonical source is
  // HKLM\SOFTWARE\WOW6432Node\Epic Games\EpicGamesLauncher\AppDataPath.
  const reg = await ps(
    `(Get-ItemProperty 'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\Epic Games\\\\EpicGamesLauncher' -Name AppDataPath -ErrorAction SilentlyContinue).AppDataPath`
  );
  const p = reg && reg.length > 0 ? path.join(reg, 'Manifests') : DEFAULT_MANIFEST_DIR;
  try {
    await fs.access(p);
    return p;
  } catch {
    // Fall back to the canonical path in case the registry key is missing.
    try { await fs.access(DEFAULT_MANIFEST_DIR); return DEFAULT_MANIFEST_DIR; }
    catch { return null; }
  }
}

export async function detect() {
  return (await manifestDir()) !== null;
}

export async function scan() {
  const dir = await manifestDir();
  if (!dir) return [];

  let entries;
  try { entries = await fs.readdir(dir); }
  catch { return []; }

  const games = [];
  for (const entry of entries) {
    if (!entry.endsWith('.item')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), 'utf8');
      const m = JSON.parse(raw);
      if (!m.DisplayName || !m.AppName) continue;
      // Skip DLC manifests — they carry a MainGameAppName that points at the
      // base game; the base game has its own manifest.
      if (m.MainGameAppName && m.MainGameAppName !== m.AppName) continue;
      // Skip the launcher itself + redistributables.
      if (/^Epic Games Launcher$/i.test(m.DisplayName)) continue;
      if (/Prerequisites|Redistributable/i.test(m.DisplayName)) continue;

      games.push({
        id: `epic:${m.AppName}`,
        gameId: m.AppName,
        name: m.DisplayName,
        platform: 'epic',
        art: null,
        launchUrl: `com.epicgames.launcher://apps/${encodeURIComponent(m.AppName)}?action=launch&silent=true`,
        folder: m.InstallLocation,
        executable: m.LaunchExecutable,
      });
    } catch { /* skip unreadable manifest */ }
  }
  return games;
}
