// One-shot installer that swaps the Windows-service registration for a
// Task Scheduler entry at user logon.
//
// Why: a Windows service runs in Session 0, which means processes it spawns
// can't show GUI windows to the logged-in user — Steam, Riot Client, etc.
// silently fail to surface anything on the desktop. Task Scheduler at
// logon runs in the user's interactive session and inherits the desktop,
// so spawned games appear normally.
//
// Run elevated (UAC) — needs admin to remove the existing service. The
// scheduled task itself is registered for the current user, which doesn't
// require admin.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { winService } from '../optional-deps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentDir = path.dirname(__dirname);
const vbsPath = path.join(__dirname, 'launcher.vbs');
const TASK_NAME = 'CloudDeck Agent';

// ---- 1. Try to uninstall the existing Windows service ----
async function removeService() {
  if (!winService) {
    console.log('[install-startup] node-windows not installed; skipping service uninstall');
    return;
  }
  const { Service } = winService;
  const svc = new Service({
    name: 'CloudDeck Agent',
    script: path.join(agentDir, 'index.js'),
  });
  if (!svc.exists) {
    console.log('[install-startup] No existing service found, continuing');
    return;
  }
  await new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    svc.on('uninstall',       () => { console.log('[install-startup] Service uninstalled'); finish(); });
    svc.on('alreadyuninstalled', finish);
    svc.on('error', err => { console.warn('[install-startup] Service uninstall error:', err.message); finish(); });
    svc.uninstall();
    setTimeout(finish, 15000); // failsafe
  });
}

// ---- 2. Register the Scheduled Task ----
function registerTask() {
  const trCommand = `wscript.exe "${vbsPath}" "${agentDir}"`;
  // /sc onlogon = trigger at logon of any user (we filter via /ru to current
  // user implicitly). /rl LIMITED = standard token, not elevated — the agent
  // doesn't need admin for itself, only the install does. /f = overwrite if
  // already exists.
  const args = [
    '/create',
    '/tn', TASK_NAME,
    '/tr', trCommand,
    '/sc', 'onlogon',
    '/rl', 'LIMITED',
    '/f',
  ];
  const r = spawnSync('schtasks', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('schtasks /create failed');
  console.log('[install-startup] Scheduled task registered');
}

// ---- 3. Run it now so the agent comes up immediately ----
function runTask() {
  const r = spawnSync('schtasks', ['/run', '/tn', TASK_NAME], { stdio: 'inherit' });
  if (r.status !== 0) console.warn('[install-startup] schtasks /run returned non-zero (will start on next logon anyway)');
  else console.log('[install-startup] Agent started');
}

(async () => {
  try {
    await removeService();
    registerTask();
    runTask();
    console.log('\n[install-startup] Done. Agent will auto-start at every user logon.');
  } catch (err) {
    console.error('[install-startup] Failed:', err.message);
    process.exit(1);
  }
})();
