// CloudDeck Railway app entry point.
//
// Express + WebSocket signaling bridge. The HTTP side serves the XMB UI, handles
// auth, and exposes a small REST surface for things the browser needs (login,
// list users, settings, sessions, screenshot proxy, Pi wake). The WebSocket side
// is the realtime command channel between browser and PC agent — see ws-bridge.js.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store } from './store.js';
import { Users } from './users.js';
import { Auth, makeLoginRateLimiter } from './auth.js';
import { WSBridge } from './ws-bridge.js';
import { PiClient } from './pi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  agentToken: requireEnv('AGENT_TOKEN'),
  jwtSecret: requireEnv('JWT_SECRET'),
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  refreshExpiry: process.env.REFRESH_TOKEN_EXPIRY || '30d',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || '10', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15', 10),
  enable2fa: process.env.ENABLE_2FA === 'true',
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  piUrl: process.env.PI_URL || '',
  piToken: process.env.PI_SECRET_TOKEN || '',
  streamDefaults: {
    resolution: process.env.DEFAULT_RESOLUTION || '1080p',
    fps: parseInt(process.env.DEFAULT_FPS || '60', 10),
    bitrate: parseInt(process.env.DEFAULT_BITRATE || '20000', 10),
    audioBitrate: parseInt(process.env.DEFAULT_AUDIO_BITRATE || '256', 10),
    audioSurround: process.env.AUDIO_SURROUND === 'true',
  },
  afk: {
    timeoutMinutes: parseInt(process.env.AFK_TIMEOUT_MINUTES || '15', 10),
    countdownSeconds: parseInt(process.env.AFK_COUNTDOWN_SECONDS || '300', 10),
    deadzone: parseFloat(process.env.INPUT_DEADZONE_THRESHOLD || '0.15'),
  },
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// ---- Wire up core services ----
const store = new Store(config.dataDir);
await store.init();

const users = new Users(store);
const auth = new Auth({
  store,
  users,
  secret: config.jwtSecret,
  accessExpiry: config.jwtExpiry,
  refreshExpiry: config.refreshExpiry,
});
const pi = new PiClient({ url: config.piUrl, token: config.piToken });

// ---- Express app ----
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Static UI (public/ folder)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ---- Health ----
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    onboarded: store.getConfig().onboardingComplete === true,
    agentConnected: bridge.hasAgent(),
    piConfigured: pi.configured(),
  });
});

// ---- Public config (read by the UI; safe to expose) ----
app.get('/api/public-config', (_req, res) => {
  res.json({
    streamDefaults: config.streamDefaults,
    afk: config.afk,
    enable2fa: config.enable2fa,
    onboardingComplete: store.getConfig().onboardingComplete === true,
    hasAnyAdmin: users.hasAnyAdmin(),
  });
});

// ---- Auth: login ----
const loginLimiter = makeLoginRateLimiter({
  max: config.rateLimitMax,
  windowMinutes: config.rateLimitWindow,
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password, twoFactorCode } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = await users.verifyPassword(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.twoFactor) {
    if (!twoFactorCode) {
      return res.status(200).json({ twoFactorRequired: true });
    }
    const ok = auth.verifyTwoFactor(user.twoFactor.secret, twoFactorCode);
    if (!ok) return res.status(401).json({ error: 'Invalid 2FA code' });
  }
  users.recordLogin(user.id);
  const accessToken = auth.issueAccessToken(user);
  const refreshToken = auth.issueRefreshToken(user);
  res.cookie('cd_token', accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.cookie('cd_refresh', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// ---- Auth: refresh ----
app.post('/api/auth/refresh', (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.cd_refresh;
  if (!token) return res.status(401).json({ error: 'No refresh token' });
  const user = auth.consumeRefreshToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid refresh token' });
  const accessToken = auth.issueAccessToken(user);
  res.cookie('cd_token', accessToken, { httpOnly: true, sameSite: 'lax' });
  res.json({ accessToken });
});

// ---- Auth: logout ----
app.post('/api/auth/logout', auth.optionalAuth, (req, res) => {
  const refresh = req.cookies?.cd_refresh || req.body?.refreshToken;
  if (refresh) auth.revokeRefreshToken(refresh);
  res.clearCookie('cd_token');
  res.clearCookie('cd_refresh');
  res.json({ ok: true });
});

// ---- Auth: 2FA setup ----
app.post('/api/auth/2fa/setup', auth.requireAuth, async (req, res) => {
  const user = store.getUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { secret, otpauthUrl } = auth.generateTwoFactorSecret(user.username);
  const qrCode = await auth.generateTwoFactorQrCode(otpauthUrl);
  // Stash secret in a short-lived response — client confirms with a code before we persist
  res.json({ secret, otpauthUrl, qrCode });
});

app.post('/api/auth/2fa/confirm', auth.requireAuth, (req, res) => {
  const { secret, code } = req.body || {};
  if (!auth.verifyTwoFactor(secret, code)) {
    return res.status(400).json({ error: 'Invalid code' });
  }
  users.setTwoFactor(req.user.sub, secret);
  res.json({ ok: true });
});

app.post('/api/auth/2fa/disable', auth.requireAuth, (req, res) => {
  users.clearTwoFactor(req.user.sub);
  res.json({ ok: true });
});

// ---- Onboarding ----
app.post('/api/onboarding/create-admin', async (req, res) => {
  if (users.hasAnyAdmin()) {
    return res.status(403).json({ error: 'Admin already exists' });
  }
  try {
    const { username, password } = req.body || {};
    const user = await users.create({ username, password, role: 'admin' });
    const accessToken = auth.issueAccessToken(store.getUserById(user.id));
    const refreshToken = auth.issueRefreshToken(store.getUserById(user.id));
    res.cookie('cd_token', accessToken, { httpOnly: true, sameSite: 'lax' });
    res.cookie('cd_refresh', refreshToken, { httpOnly: true, sameSite: 'lax' });
    res.json({ user, accessToken });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/onboarding/test-pi', auth.requireAdmin, async (_req, res) => {
  const result = await pi.ping();
  res.json(result);
});

app.post('/api/onboarding/complete', auth.requireAdmin, (_req, res) => {
  store.setConfig({ onboardingComplete: true, onboardingCompletedAt: Date.now() });
  res.json({ ok: true });
});

// ---- Users (admin only) ----
app.get('/api/users', auth.requireAdmin, (_req, res) => {
  res.json({ users: users.list() });
});

app.post('/api/users', auth.requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    const user = await users.create({ username, password, role, createdBy: req.user.sub });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:id', auth.requireAdmin, (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  users.delete(req.params.id);
  res.json({ ok: true });
});

// ---- "Who am I" ----
app.get('/api/me', auth.requireAuth, (req, res) => {
  const user = store.getUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: users._sanitize(user) });
});

// ---- Sessions / last played ----
app.get('/api/sessions', auth.requireAuth, (req, res) => {
  res.json({ sessions: store.getRecentSessions(req.user.sub, 50) });
});

app.get('/api/last-played', auth.requireAuth, (req, res) => {
  res.json({ games: store.getLastPlayed(req.user.sub, 3) });
});

// ---- Device settings ----
app.get('/api/settings/device/:deviceId', auth.requireAuth, (req, res) => {
  const settings = store.getDeviceSettings(req.user.sub, req.params.deviceId);
  res.json({ settings: settings || null, defaults: config.streamDefaults });
});

app.put('/api/settings/device/:deviceId', auth.requireAuth, (req, res) => {
  store.setDeviceSettings(req.user.sub, req.params.deviceId, req.body || {});
  res.json({ ok: true });
});

// ---- Sleep schedule ----
app.get('/api/settings/sleep-schedule', auth.requireAuth, (req, res) => {
  res.json({ schedule: store.getSleepSchedule(req.user.sub) });
});

app.put('/api/settings/sleep-schedule', auth.requireAdmin, (req, res) => {
  store.setSleepSchedule(req.user.sub, req.body || {});
  res.json({ ok: true });
});

// ---- Wake PC ----
app.post('/api/wake', auth.requireAdmin, async (_req, res) => {
  if (!pi.configured()) {
    return res.status(400).json({ error: 'Pi forwarder is not configured' });
  }
  try {
    const result = await pi.wake();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- Screenshot proxy (agent exposes a local file URL; we proxy through here) ----
app.get('/api/screenshots/:id', auth.requireAuth, async (req, res) => {
  try {
    const result = await bridge.sendToAgent('screenshot-fetch', { id: req.params.id });
    if (!result?.dataUrl) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }
    const match = /^data:(.+?);base64,(.+)$/.exec(result.dataUrl);
    if (!match) return res.status(500).json({ error: 'Bad screenshot payload' });
    const [, mime, b64] = match;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(b64, 'base64'));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/screenshots', auth.requireAuth, async (_req, res) => {
  try {
    const result = await bridge.sendToAgent('screenshot-list', {});
    res.json(result || { screenshots: [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- Library (proxy to agent) ----
app.get('/api/library', auth.requireAuth, async (_req, res) => {
  try {
    const result = await bridge.sendToAgent('library-fetch', {});
    res.json(result || { games: [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- Record a session (called by browser when a game session ends) ----
app.post('/api/sessions', auth.requireAuth, (req, res) => {
  const { gameId, gameName, platform, durationSeconds, deviceId, avgPing } = req.body || {};
  if (!gameId || !gameName) return res.status(400).json({ error: 'Missing fields' });
  store.addSession({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    userId: req.user.sub,
    gameId,
    gameName,
    platform,
    durationSeconds,
    deviceId,
    avgPing,
    endedAt: Date.now(),
  });
  store.recordPlay(req.user.sub, { gameId, name: gameName, platform, art: req.body?.art });
  res.json({ ok: true });
});

// ---- Onboarding & SPA routing fallback ----
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/onboarding', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- HTTP + WebSocket server ----
const server = http.createServer(app);
const bridge = new WSBridge({
  server,
  auth,
  store,
  agentToken: config.agentToken,
  logger: console,
});

server.listen(config.port, () => {
  console.log(`[CloudDeck] Listening on :${config.port}`);
  console.log(`[CloudDeck] Public URL: ${config.publicUrl}`);
  console.log(`[CloudDeck] Pi forwarder: ${pi.configured() ? config.piUrl : 'not configured'}`);
  console.log(`[CloudDeck] Onboarded: ${store.getConfig().onboardingComplete === true}`);
});

// ---- Graceful shutdown ----
async function shutdown() {
  console.log('[CloudDeck] Shutting down…');
  bridge.shutdown();
  server.close(() => { /* drain */ });
  await store.flushAll();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
