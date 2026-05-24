// Ubisoft Connect (formerly Uplay) scanner.
//
// HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs lists every installed
// game. Each subkey is the Ubisoft game ID and has an InstallDir property.
// Display name doesn't live in that key, so we cross-reference the
// Uninstall registry by InstallLocation match. Launch URI is uplay://launch/
// <gameId>/0 (the trailing /0 picks the default platform).

import { psJson, uninstallEntries } from './registry.js';
import { ps } from './registry.js';

async function ubisoftInstalled() {
  const reg = await ps(
    `(Get-ItemProperty 'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\Ubisoft\\\\Launcher' -Name InstallDir -ErrorAction SilentlyContinue).InstallDir`
  );
  return !!reg;
}

export async function detect() {
  return ubisoftInstalled();
}

export async function scan() {
  if (!(await ubisoftInstalled())) return [];
  const installs = await psJson(
    `Get-ChildItem 'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\Ubisoft\\\\Launcher\\\\Installs' -ErrorAction SilentlyContinue ` +
    `| ForEach-Object { $p = Get-ItemProperty $_.PSPath; [PSCustomObject]@{ GameId = $_.PSChildName; InstallDir = $p.InstallDir } } ` +
    `| ConvertTo-Json -Compress`,
  );
  if (!installs) return [];

  // Try to enrich with display names from Uninstall entries.
  const uninstalls = await uninstallEntries('Ubisoft');
  const byLocation = new Map();
  for (const u of uninstalls) {
    if (u.InstallLocation) byLocation.set(normPath(u.InstallLocation), u.DisplayName);
  }

  return installs.filter(i => i.GameId && i.InstallDir).map(i => {
    const name = byLocation.get(normPath(i.InstallDir)) || basename(i.InstallDir) || `Ubisoft Game ${i.GameId}`;
    return {
      id: `uplay:${i.GameId}`,
      gameId: String(i.GameId),
      name,
      platform: 'ubisoft',
      art: null,
      launchUrl: `uplay://launch/${i.GameId}/0`,
      folder: i.InstallDir,
    };
  });
}

function normPath(p) { return String(p).replace(/\\+$/, '').toLowerCase(); }
function basename(p) { return String(p).replace(/\\+$/, '').split(/[\\/]/).pop(); }
