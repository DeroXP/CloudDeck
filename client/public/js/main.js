// CloudDeck frontend orchestrator. Wires every module together and runs the
// app-level state machine: boot → idle (PC offline) → online (XMB) → stream.

import { api, Realtime } from './api.js';
import { input } from './input.js';
import { focus } from './focus.js';
import { XMB } from './xmb.js';
import { LibraryModule } from './library.js';
import { DashboardModule } from './dashboard.js';
import { ScreenshotsModule } from './screenshots.js';
import { SettingsModule } from './settings.js';
import { StreamModule } from './stream.js';
import { AFKMonitor } from './afk.js';
import { NetworkIndicator } from './network.js';
import { ReconnectOverlay } from './reconnect.js';
import { MobileGamepad } from './mobile.js';
import { toast } from './toast.js';

// ---- Bootstrap ----
const cfg = await api.config();
if (!cfg?.hasAnyAdmin) { location.href = '/onboarding'; }

const me = await api.me();
if (!me) { location.href = '/login'; }

// Stable per-device ID, used for device-specific settings
let deviceId = localStorage.getItem('cd_device_id');
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem('cd_device_id', deviceId);
}

// ---- Hide boot screen after the fade ----
setTimeout(() => document.getElementById('boot').classList.add('cd-boot-hidden'), 1600);

// ---- Realtime ----
const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/client`;
// Get an access token; we set it as a cookie on login, but the WS handshake
// needs it as a query param. The cookie is httpOnly; instead, do a refresh
// to get a fresh access token returned to JS-land.
async function getAccessToken() {
  const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (r.ok) {
    const d = await r.json();
    return d.accessToken;
  }
  location.href = '/login';
  return null;
}
const accessToken = await getAccessToken();
const realtime = new Realtime({ url: wsUrl, deviceId });
realtime.connect(accessToken);

// ---- Wire core UI modules ----
const xmb = new XMB();
const library = new LibraryModule({
  realtime,
  onLaunch: g => launchGame(g),
});
const dashboard = new DashboardModule({ realtime });
const screenshots = new ScreenshotsModule({ realtime });
const settings = new SettingsModule({
  realtime,
  me,
  deviceId,
  onReload: () => location.reload(),
  toast,
});
const stream = new StreamModule({ realtime, deviceId });
const network = new NetworkIndicator({ realtime });
const reconnect = new ReconnectOverlay({ realtime });
const mobile = new MobileGamepad({ realtime });

const afk = new AFKMonitor({
  timeoutMs: (cfg.afk?.timeoutMinutes || 15) * 60 * 1000,
  countdownSec: cfg.afk?.countdownSeconds || 300,
  deadzone: cfg.afk?.deadzone || 0.15,
});

xmb.registerCategory('games', library.render);
xmb.registerCategory('dashboard', dashboard.render);
xmb.registerCategory('screenshots', screenshots.render);
xmb.registerCategory('settings', settings.render);

// ---- Power button + PC status ----
const powerBtn = document.getElementById('power-btn');
focus.register('header', powerBtn);
let pcOnline = false;
const piConfigured = cfg.piConfigured === true;
realtime.addEventListener('msg:pc-status', e => setPcStatus(e.detail.online));

function setPcStatus(online) {
  pcOnline = online;
  powerBtn.classList.remove('online', 'offline', 'connecting', 'cd-power-disabled');
  powerBtn.classList.add(online ? 'online' : 'offline');
  // No Pi + PC offline → there's no useful action to take here. Sleep needs
  // the agent (which needs the PC on) and wake needs the Pi. So we dim the
  // button and explain in the items pane.
  if (!online && !piConfigured) {
    powerBtn.classList.add('cd-power-disabled');
    powerBtn.title = 'Wake-on-LAN not configured — power the PC on manually';
  } else {
    powerBtn.title = online ? 'Sleep PC' : 'Wake PC';
  }
  if (online) {
    library.load();
    screenshots.load();
    checkResumeGame();
  } else {
    const msg = piConfigured
      ? 'PC offline. Press power to wake.'
      : 'PC offline. Power it on manually — the agent will connect automatically. (Add a Pi to enable remote wake.)';
    document.getElementById('items').innerHTML =
      `<div style="text-align:center; color: var(--cd-fg-dim); padding: 60px; max-width: 480px; margin: 0 auto; line-height: 1.6;">${msg}</div>`;
  }
}

powerBtn.addEventListener('click', async () => {
  if (pcOnline) {
    if (me.role !== 'admin') return toast('Only admins can sleep the PC', 'warn');
    if (!confirm('Sleep the PC?')) return;
    try {
      await realtime.sendCommand('sleep-pc', {});
      toast('Sleeping PC…', 'ok');
    } catch (err) { toast(err.message, 'warn'); }
    return;
  }
  if (!piConfigured) {
    // The disabled class blocks pointer events; this guards keyboard/controller paths.
    return toast('Wake-on-LAN not configured — power the PC on manually', 'info');
  }
  if (me.role !== 'admin') return toast('Only admins can wake the PC', 'warn');
  powerBtn.classList.replace('offline', 'connecting');
  try {
    const r = await api.wake();
    if (r?.ok) toast('Wake signal sent. Waiting for PC…', 'ok');
    else toast(r?.error || 'Wake failed', 'warn');
  } catch (err) {
    toast(err.message, 'warn');
  }
});

// ---- Game launch ----
// New workflow: CloudDeck just kicks the game off on the PC. The user views
// the stream in a separate viewer app (Moonlight). We deliberately do NOT
// enter the in-browser stream view anymore — the iframe was a stuck-state
// magnet on mobile and we can't actually pipe a Sunshine stream into it
// without a heavy WebRTC bridge (see project history).
async function launchGame(game) {
  toast(`Launching ${game.name}…`, 'ok');
  const dev = await api.deviceSettings(deviceId);
  const streamCfg = dev.settings || dev.defaults || {};
  try {
    await realtime.sendCommand('launch-game', {
      gameId: game.id,
      streamConfig: streamCfg,
    });
    dashboard.setActiveGame(game.name, Date.now());
    toast(`${game.name} launched — open Moonlight to view`, 'ok', 6000);
  } catch (err) {
    toast(`Launch failed: ${err.message}`, 'warn');
  }
}

stream.addEventListener('ended', e => {
  afk.disable();
  mobile.disable();
  dashboard.setActiveGame(null);
  if (!e.detail.clean) {
    toast(`Game crashed (exit ${e.detail.exitCode})`, 'crash', 8000);
  }
});

stream.addEventListener('crash', e => {
  toast(`Crash: ${e.detail.name}`, 'crash', 8000);
});

afk.addEventListener('fire', async () => {
  toast('AFK — sleeping PC…', 'warn');
  try {
    await realtime.sendCommand('close-game', {});
    await realtime.sendCommand('sleep-pc', {});
  } catch { /* may be already disconnected */ }
  await stream.stopStream();
});

// Check whether a game is already running when we connect — just notify the
// user via a toast, don't pop them into stream view (we no longer have one).
async function checkResumeGame() {
  try {
    const res = await realtime.sendCommand('check-resume-game', {});
    if (res?.detected?.game) {
      toast(`${res.detected.game.name} is already running — open Moonlight`, 'ok', 6000);
      dashboard.setActiveGame(res.detected.game.name, Date.now());
    }
  } catch { /* PC might not be ready */ }
}

// ---- Agent notifications → toasts ----
realtime.addEventListener('msg:notification', e => {
  toast(e.detail?.text || 'Notification', 'info', 5000);
});
realtime.addEventListener('msg:update-available', e => {
  const info = e.detail;
  if (info?.mandatory) {
    toast(`Agent update ${info.version} required — will install next session end`, 'warn', 10_000);
  } else {
    toast(`Agent update ${info.version} available — Settings to install`, 'info', 8000);
  }
});
realtime.addEventListener('msg:scheduled-sleep-prompt', () => {
  if (confirm('Scheduled sleep time reached. Sleep now?')) {
    realtime.sendCommand('sleep-pc', {}).catch(() => {});
  } else {
    realtime.sendCommand('defer-sleep', {}).catch(() => {});
  }
});

// Initial state from /api/health
const h = await api.health();
setPcStatus(h?.agentConnected === true);

// ---- Auto-detect device settings on first connect ----
(async () => {
  const dev = await api.deviceSettings(deviceId);
  if (!dev.settings) {
    const detected = {
      resolution: `${screen.width}x${screen.height}`,
      fps: screen.refreshRate || 60,
      ...dev.defaults,
    };
    await api.saveDeviceSettings(deviceId, detected);
  }
})();
