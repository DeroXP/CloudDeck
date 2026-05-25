// Riot Client scanner.
//
// Riot games install under C:\Riot Games\<Game Name>\ and are launched via
// RiotClientServices.exe with --launch-product=<code> --launch-patchline=live.
// Folder names are stable across installs, so we map them directly to the
// internal product codes Riot uses. Anything in C:\Riot Games\ that isn't
// "Riot Client" and isn't in our map is still listed as a generic entry
// pointing at the bare client (lets the user pick from inside).

import fs from 'node:fs/promises';
import path from 'node:path';

const RIOT_DIR = 'C:\\Riot Games';
const CLIENT_EXE = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe';

// Folder name → Riot's internal product code. TFT shares LoL's product code
// (it's a game mode, not a separate install) so users wanting TFT just open
// LoL and select it from the mode picker.
const PRODUCT_CODES = {
  'League of Legends':       'league_of_legends',
  'VALORANT':                'valorant',
  'Legends of Runeterra':    'bacon',   // Riot's internal codename for LoR
  '2XKO':                    '2xko',
};

async function clientInstalled() {
  try { await fs.access(CLIENT_EXE); return true; }
  catch { return false; }
}

export async function detect() {
  return clientInstalled();
}

export async function scan() {
  if (!(await clientInstalled())) return [];
  let entries;
  try { entries = await fs.readdir(RIOT_DIR, { withFileTypes: true }); }
  catch { return []; }

  const games = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'Riot Client') continue;     // the launcher itself
    if (entry.name === 'Metadata') continue;        // Riot housekeeping
    const code = PRODUCT_CODES[entry.name];
    if (!code) continue;                             // skip unknown folders
    games.push({
      id: `riot:${slug(entry.name)}`,
      gameId: code,
      name: entry.name,
      platform: 'riot',
      art: null,
      // Riot's launcher takes positional command-line args, not a URL
      // scheme — agent/launcher.js was extended to spawn with `launchArgs`
      // alongside an exe path in `launchUrl`.
      launchUrl: CLIENT_EXE,
      launchArgs: [`--launch-product=${code}`, '--launch-patchline=live'],
      folder: path.join(RIOT_DIR, entry.name),
    });
  }
  return games;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
