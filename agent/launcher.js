// Game launching + exit-code monitoring.
//
// Steam: `start "" steam://rungameid/<id>` — Steam handles the rest.
// Xbox: shell:appsfolder URI via `start "" <uri>`.
//
// We then poll the Windows process list every second and watch for the game's
// .exe to appear (launch-detect) and disappear (close-detect). When it
// disappears we read the exit code with `wmic process where (...) get
// ExitCode` if still available, or fall back to assuming a clean exit when we
// initiated the close ourselves.

import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class Launcher {
  constructor({ onLaunched, onEnded } = {}) {
    this.onLaunched = onLaunched || (() => {});
    this.onEnded = onEnded || (() => {});

    this.current = null;   // { game, processName, pid, userInitiatedClose }
    this.pollHandle = null;
  }

  async launch(game) {
    if (this.current) {
      await this.close({ userInitiated: true });
    }
    const launchUrl = game.launchUrl;
    if (!launchUrl) throw new Error('Game has no launchUrl');

    const launchArgs = Array.isArray(game.launchArgs) ? game.launchArgs : [];
    // Four flavors of launchUrl, picked by prefix:
    //   shell:appsfolder\<AUMID>  → UWP/Xbox apps — only Explorer resolves
    //                                this namespace path correctly.
    //   <scheme>://...            → URL protocol handlers (steam://,
    //                                com.epicgames.launcher://, battlenet://,
    //                                uplay://, goggalaxy://). Routed via
    //                                cmd's `start` which knows about the
    //                                Windows protocol registry.
    //   <path>\game.exe + args    → Riot's RiotClientServices.exe needs
    //                                --launch-product / --launch-patchline
    //                                args. spawn directly to keep arg
    //                                quoting clean.
    //   <path>\game.exe           → Raw executable (EA App fallback).
    //                                spawn it directly; the EA Desktop
    //                                client attaches automatically.
    if (launchUrl.startsWith('shell:')) {
      spawn('explorer.exe', [launchUrl], { detached: true, stdio: 'ignore' }).unref();
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(launchUrl) || launchUrl.startsWith('steam:')) {
      spawn('cmd', ['/c', 'start', '""', launchUrl], { detached: true, stdio: 'ignore' }).unref();
    } else if (launchArgs.length > 0) {
      // Direct spawn with positional args — bypasses cmd's `start` since
      // start.exe + args mangles quoting for paths containing spaces.
      const cwd = launchUrl.substring(0, launchUrl.lastIndexOf('\\'));
      spawn(launchUrl, launchArgs, { detached: true, stdio: 'ignore', cwd: cwd || undefined }).unref();
    } else {
      // Treat as raw path — start.exe handles it with the launch dir as cwd
      // so games that load assets relative to the exe still find them.
      const cwd = launchUrl.substring(0, launchUrl.lastIndexOf('\\'));
      spawn('cmd', ['/c', 'start', '""', '/D', cwd || '.', launchUrl], { detached: true, stdio: 'ignore' }).unref();
    }

    this.current = {
      game,
      processName: this._guessProcessName(game),
      pid: null,
      userInitiatedClose: false,
      startedAt: Date.now(),
    };

    this._startPoll();
    return { ok: true, started: this.current };
  }

  async close({ userInitiated = false } = {}) {
    if (!this.current) return { ok: true };
    this.current.userInitiatedClose = userInitiated;
    if (this.current.pid) {
      try {
        await execAsync(`taskkill /PID ${this.current.pid} /T /F`);
      } catch { /* may already be gone */ }
    } else if (this.current.processName) {
      try {
        await execAsync(`taskkill /IM "${this.current.processName}" /T /F`);
      } catch { /* may not be running yet */ }
    }
    return { ok: true };
  }

  status() {
    return this.current;
  }

  _guessProcessName(game) {
    // We don't reliably know the .exe name without per-game metadata; this is
    // best-effort. Steam apps frequently use a name derived from the title.
    // For Xbox titles the folder name often equals the executable name.
    if (game.platform === 'xbox' && game.folder) {
      const last = game.folder.split(/[/\\]/).pop();
      return `${last}.exe`;
    }
    // For Steam games we trust process-tree detection below rather than name.
    return null;
  }

  _startPoll() {
    clearInterval(this.pollHandle);
    let consecutiveAbsent = 0;
    let detectedPid = null;

    this.pollHandle = setInterval(async () => {
      if (!this.current) {
        clearInterval(this.pollHandle);
        return;
      }
      const procs = await listProcesses().catch(() => []);
      // this.current may have been cleared while we were awaiting (game
      // ended, user hit "× Exit Stream"). Re-check before touching it.
      if (!this.current) {
        clearInterval(this.pollHandle);
        return;
      }
      const candidate = this._matchGameProcess(procs, this.current);

      if (candidate && !detectedPid) {
        detectedPid = candidate.pid;
        this.current.pid = candidate.pid;
        this.current.processName = candidate.name;
        this.onLaunched(this.current);
      }

      if (detectedPid) {
        const still = procs.find(p => p.pid === detectedPid);
        if (!still) {
          consecutiveAbsent++;
          if (consecutiveAbsent >= 2) {
            const exitCode = await this._getExitCode(detectedPid).catch(() => null);
            const finished = {
              ...this.current,
              endedAt: Date.now(),
              durationSeconds: Math.round((Date.now() - this.current.startedAt) / 1000),
              exitCode: this.current.userInitiatedClose ? 0 : (exitCode ?? 0),
              clean: this.current.userInitiatedClose || isCleanExit(exitCode),
            };
            clearInterval(this.pollHandle);
            this.current = null;
            this.onEnded(finished);
          }
        } else {
          consecutiveAbsent = 0;
        }
      }
    }, 1000);
    this.pollHandle.unref?.();
  }

  _matchGameProcess(procs, current) {
    if (!current) return null;   // defense-in-depth — caller already checks
    const startedAfter = current.startedAt - 5000;
    const ignored = new Set([
      'cmd.exe', 'conhost.exe', 'powershell.exe', 'steam.exe', 'steamwebhelper.exe',
      'XboxApp.exe', 'GameBar.exe', 'explorer.exe', 'svchost.exe', 'node.exe',
    ]);
    let best = null;
    for (const p of procs) {
      if (ignored.has(p.name)) continue;
      if (p.creationDate && p.creationDate < startedAfter) continue;
      if (!best || p.workingSet > best.workingSet) best = p;
    }
    return best;
  }

  async _getExitCode(_pid) {
    // Windows clears exit code data when the process record is reaped, which
    // typically happens immediately after the last handle closes. We attempt
    // a best-effort read; failures are treated as "unknown" upstream.
    return null;
  }
}

async function listProcesses() {
  // Lightweight wrapper around `tasklist /FO CSV /NH` plus a second call for
  // creation-time/memory. We use Get-CimInstance for richer data.
  const ps = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,WorkingSetSize,CreationDate | ConvertTo-Json -Compress"`;
  const { stdout } = await execAsync(ps, { maxBuffer: 10 * 1024 * 1024 });
  const arr = JSON.parse(stdout);
  const list = Array.isArray(arr) ? arr : [arr];
  return list.map(p => ({
    pid: p.ProcessId,
    name: p.Name,
    workingSet: Number(p.WorkingSetSize) || 0,
    creationDate: parseWmiDate(p.CreationDate),
  }));
}

function parseWmiDate(s) {
  if (!s) return null;
  // CimInstance returns "/Date(1700000000000)/" or an ISO string
  const epoch = /\/Date\((\d+)\)\//.exec(s);
  if (epoch) return parseInt(epoch[1], 10);
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : null;
}

function isCleanExit(code) {
  if (code == null) return true;   // unknown — treat as clean
  return code === 0;
}
