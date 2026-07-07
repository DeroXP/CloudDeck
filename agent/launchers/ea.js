// EA App (formerly Origin) scanner.
//
// EA games register Uninstall entries with Publisher containing "Electronic
// Arts". The clean launch path is origin://launchgame/<offer_id> via the
// Origin URL handler that the EA App also registers. Offer IDs are hard to
// derive cleanly, so we fall back to launching the registered executable
// directly when an InstallLocation + .exe is available.

import { uninstallEntries } from './registry.js';
import { ps } from './registry.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function eaInstalled() {
  // EA App default
  for (const p of [
    'C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EALaunchHelper.exe',
    'C:\\Program Files (x86)\\Origin\\Origin.exe',
  ]) {
    try { await fs.access(p); return true; } catch { /* next */ }
  }
  const reg = await ps(
    `(Get-ItemProperty 'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\Electronic Arts\\\\EA Desktop' -ErrorAction SilentlyContinue) -ne $null`
  );
  return reg === 'True';
}

export async function detect() {
  return eaInstalled();
}

export async function scan() {
  if (!(await eaInstalled())) return [];
  const entries = await uninstallEntries('Electronic Arts');
  const games = [];
  for (const e of entries) {
    // Skip the launchers themselves and runtime libraries.
    if (/^(EA|EA App|Origin|EA Desktop)$/i.test(e.DisplayName)) continue;
    if (/Redistributable|DirectX|\.NET/.test(e.DisplayName)) continue;

    // Prefer the registered DisplayIcon (usually points at the game exe).
    // DisplayIcon is often stored quoted with an icon-index suffix, e.g.
    // "C:\path\game.exe",0 — strip the surrounding quotes before the .exe
    // check so a quoted value isn't wrongly discarded.
    let exe = e.DisplayIcon?.split(',')[0]?.trim().replace(/^"|"$/g, '');
    if (exe && !exe.toLowerCase().endsWith('.exe')) exe = null;
    if (!exe && e.InstallLocation) {
      try {
        const files = await fs.readdir(e.InstallLocation);
        const found = files.find(f => f.toLowerCase().endsWith('.exe'));
        if (found) exe = path.join(e.InstallLocation, found);
      } catch { /* nope */ }
    }

    games.push({
      id: `ea:${slug(e.DisplayName)}`,
      gameId: slug(e.DisplayName),
      name: e.DisplayName,
      platform: 'ea',
      art: null,
      // We don't know the offer id, so we launch the exe directly. Works for
      // most EA titles since their exes know how to talk to the EA App on
      // their own (the launcher attaches when the game starts).
      launchUrl: exe || null,
      folder: e.InstallLocation || null,
      executable: exe,
    });
  }
  return games.filter(g => g.launchUrl);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
