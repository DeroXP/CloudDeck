// Detect whether a game is already running on the PC when a session starts.
// We match running processes against a known executable set derived from the
// Steam library scan + the Xbox folder names.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class Resume {
  constructor({ library }) {
    this.library = library;
  }

  async detectRunningGame() {
    const cache = await this.library.fetch();
    const games = cache.games || [];
    if (games.length === 0) return null;

    const procs = await this._listExeNames();
    const procSet = new Set(procs.map(p => p.toLowerCase()));

    // Xbox: folder name maps directly to expected exe
    for (const game of games.filter(g => g.platform === 'xbox')) {
      const last = (game.folder || '').split(/[/\\]/).pop();
      if (last && procSet.has(`${last.toLowerCase()}.exe`)) {
        return { game, source: 'xbox-folder-match' };
      }
    }

    // Steam: we use a fuzzy match — strip non-alpha from the game name and
    // see if any running exe shares a substring. Not perfect; catches the
    // common case (e.g., "EldenRing.exe", "csgo.exe").
    const steamGames = games.filter(g => g.platform === 'steam');
    for (const game of steamGames) {
      const stripped = game.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const exe of procSet) {
        const exeStripped = exe.replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');
        if (exeStripped.length >= 5 && stripped.includes(exeStripped)) {
          return { game, source: 'steam-name-match', exe };
        }
      }
    }

    return null;
  }

  async _listExeNames() {
    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-Process | Select-Object -ExpandProperty Name"',
      );
      return stdout.split(/\r?\n/).filter(Boolean).map(n => `${n}.exe`);
    } catch { return []; }
  }
}
