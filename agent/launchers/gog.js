// GOG Galaxy scanner.
//
// HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<gogAppId> is the canonical
// install registry; each subkey carries gameName, path (install dir), exe,
// startMenu, etc. Launching via goggalaxy://openGameView/<id> opens Galaxy
// to the game page and lets the user hit play there. We also expose the
// direct exe path as a fallback so the agent can spawn it without Galaxy.

import { psJson, ps } from './registry.js';

async function gogInstalled() {
  // Galaxy registers its own install path.
  const out = await ps(
    `(Get-ItemProperty 'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\GOG.com\\\\GalaxyClient' -Name clientExecutable -ErrorAction SilentlyContinue).clientExecutable`
  );
  return !!out;
}

export async function detect() {
  return gogInstalled();
}

export async function scan() {
  if (!(await gogInstalled())) return [];
  const rows = await psJson(
    `Get-ChildItem 'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\GOG.com\\\\Games' -ErrorAction SilentlyContinue ` +
    `| ForEach-Object { $p = Get-ItemProperty $_.PSPath; [PSCustomObject]@{ Id = $_.PSChildName; Name = $p.gameName; Path = $p.path; Exe = $p.exe; Image = $p.startMenuImage } } ` +
    `| ConvertTo-Json -Compress`,
  );
  if (!rows) return [];

  return rows.filter(r => r.Id && r.Name).map(r => ({
    id: `gog:${r.Id}`,
    gameId: String(r.Id),
    name: r.Name,
    platform: 'gog',
    art: null,
    // Galaxy protocol — opens the Galaxy UI to this game's page. Direct
    // exe spawn is the executable property when present; the agent's
    // launcher picks based on the launchUrl scheme.
    launchUrl: `goggalaxy://openGameView/${r.Id}`,
    folder: r.Path || null,
    executable: r.Exe || null,
  }));
}
