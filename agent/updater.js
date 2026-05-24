// Self-update check against the GitHub releases API. On startup and then on a
// timer we fetch the latest release tag and compare against our embedded
// version. We do NOT auto-install in this module — we notify Railway, the
// admin gets a toast in the UI, and the install proceeds on user confirmation
// via `agent-update-now` from the browser. Mandatory updates flagged in the
// release metadata can bypass the prompt.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Updater {
  constructor({ onUpdateAvailable, currentVersion }) {
    this.onUpdateAvailable = onUpdateAvailable || (() => {});
    this.currentVersion = currentVersion;
    this.checkTimer = null;
  }

  start() {
    if (!config.github.repo) return;
    this.check().catch(err => console.warn('[updater] initial check failed:', err.message));
    this.checkTimer = setInterval(
      () => this.check().catch(err => console.warn('[updater] check failed:', err.message)),
      config.github.checkIntervalHours * 60 * 60 * 1000,
    );
    this.checkTimer.unref?.();
  }

  stop() { clearInterval(this.checkTimer); }

  async check() {
    const url = `https://api.github.com/repos/${config.github.repo}/releases/latest`;
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release = await res.json();
    const latest = (release.tag_name || '').replace(/^v/, '');
    if (!latest) return null;
    if (!isNewer(latest, this.currentVersion)) return null;

    const mandatory = config.github.allowMandatory &&
      /\[mandatory\]/i.test(release.body || '');

    const info = {
      version: latest,
      url: release.html_url,
      mandatory,
      publishedAt: release.published_at,
      notes: release.body,
      asset: release.assets?.find(a => /agent.*\.zip$/i.test(a.name)) || null,
    };
    this.onUpdateAvailable(info);
    return info;
  }

  async download(updateInfo) {
    if (!updateInfo.asset) throw new Error('No agent asset in release');
    await fs.mkdir(config.paths.updates, { recursive: true });
    const dest = path.join(config.paths.updates, updateInfo.asset.name);
    const res = await fetch(updateInfo.asset.browser_download_url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(dest, buf);
    return { path: dest, sha256: createHash('sha256').update(buf).digest('hex') };
  }

  // Apply step is delegated to an external script so the running agent can
  // exit cleanly before the new bits replace the old ones. The script is
  // simple: extract the zip over the agent directory, then restart the
  // Windows service.
  async applyAndRestart(downloadPath) {
    const script = path.join(__dirname, 'scripts', 'apply-update.ps1');
    const { spawn } = await import('node:child_process');
    spawn('powershell', ['-NoProfile', '-File', script, '-Zip', downloadPath, '-Target', __dirname], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    setTimeout(() => process.exit(0), 500);
  }
}

function isNewer(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return false;
}
