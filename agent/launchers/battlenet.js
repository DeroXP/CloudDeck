// Battle.net launcher scanner.
//
// Battle.net's product.db is a binary protobuf and parsing it is a yak-shave,
// so we go the simpler route: enumerate registry Uninstall entries whose
// Publisher is "Blizzard Entertainment" and map DisplayName → known
// battlenet:// URI codes for clean launching. Games without a known code
// still get an entry but fall back to launching the registered exe.

import { uninstallEntries } from './registry.js';
import { ps } from './registry.js';
import fs from 'node:fs/promises';

// Hard-coded map of Blizzard titles → the battlenet:// product codes the
// launcher uses. Bottom-line: only ~12 first-party Blizzard games exist,
// so a manual table is realistic to maintain.
const BNET_CODES = {
  'world of warcraft': 'WoW',
  'world of warcraft classic': 'WoWC',
  'diablo ii: resurrected': 'OSI',
  'diablo iii': 'D3',
  'diablo iv': 'Fen',
  'starcraft': 'S1',
  'starcraft ii': 'S2',
  'hearthstone': 'WTCG',
  'heroes of the storm': 'Hero',
  'overwatch': 'Pro',
  'overwatch 2': 'Pro',
  'warcraft iii: reforged': 'W3',
  'call of duty: black ops 6': 'auks',
  'call of duty: modern warfare ii': 'spot',
  'call of duty: modern warfare iii': 'spot',
  'call of duty': 'spot',
};

function codeFor(displayName) {
  const key = displayName.toLowerCase().trim();
  return BNET_CODES[key] || null;
}

async function battlenetInstalled() {
  try {
    await fs.access('C:\\Program Files (x86)\\Battle.net\\Battle.net.exe');
    return true;
  } catch { /* try other paths */ }
  const exe = await ps(
    `(Get-ItemProperty 'HKLM:\\\\SOFTWARE\\\\WOW6432Node\\\\Blizzard Entertainment\\\\Battle.net' -Name InstallPath -ErrorAction SilentlyContinue).InstallPath`
  );
  return !!exe;
}

export async function detect() {
  return battlenetInstalled();
}

export async function scan() {
  if (!(await battlenetInstalled())) return [];
  const entries = await uninstallEntries('Blizzard Entertainment');
  return entries
    // The Battle.net app itself appears as an entry — skip it.
    .filter(e => !/^Battle\.net$/i.test(e.DisplayName))
    .map(e => {
      const code = codeFor(e.DisplayName);
      const launchUrl = code
        ? `battlenet://${code}`
        : e.UninstallString ? null : null; // We have no clean launch; UI just lists.
      return {
        id: `bnet:${slug(e.DisplayName)}`,
        gameId: slug(e.DisplayName),
        name: e.DisplayName,
        platform: 'battlenet',
        art: null,
        launchUrl,
        folder: e.InstallLocation || null,
      };
    })
    .filter(g => g.launchUrl);   // drop games we can't launch (rare; usually has a code)
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
