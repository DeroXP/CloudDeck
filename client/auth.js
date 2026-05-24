// JWT issuance/verification, refresh tokens, TOTP 2FA, rate-limited login.

import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

export class Auth {
  constructor({ store, users, secret, accessExpiry, refreshExpiry }) {
    this.store = store;
    this.users = users;
    this.secret = secret;
    this.accessExpiry = accessExpiry || '24h';
    this.refreshExpiry = refreshExpiry || '30d';

    authenticator.options = { window: 1 };
  }

  // ---- Access tokens ----
  issueAccessToken(user) {
    return jwt.sign(
      { sub: user.id, role: user.role, username: user.username },
      this.secret,
      { expiresIn: this.accessExpiry, issuer: 'clouddeck' },
    );
  }

  verifyAccessToken(token) {
    try {
      return jwt.verify(token, this.secret, { issuer: 'clouddeck' });
    } catch {
      return null;
    }
  }

  // ---- Refresh tokens ----
  issueRefreshToken(user) {
    const token = randomBytes(48).toString('hex');
    const ttlMs = this._parseDuration(this.refreshExpiry);
    this.store.addRefreshToken({
      token,
      userId: user.id,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    });
    return token;
  }

  consumeRefreshToken(token) {
    this.store.purgeExpiredRefreshTokens();
    const record = this.store.findRefreshToken(token);
    if (!record) return null;
    if (record.expiresAt < Date.now()) {
      this.store.revokeRefreshToken(token);
      return null;
    }
    return this.store.getUserById(record.userId);
  }

  revokeRefreshToken(token) {
    this.store.revokeRefreshToken(token);
  }

  // ---- TOTP 2FA ----
  generateTwoFactorSecret(username) {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(username, 'CloudDeck', secret);
    return { secret, otpauthUrl };
  }

  async generateTwoFactorQrCode(otpauthUrl) {
    return QRCode.toDataURL(otpauthUrl);
  }

  verifyTwoFactor(secret, token) {
    if (!secret || !token) return false;
    return authenticator.verify({ secret, token: String(token).replace(/\s/g, '') });
  }

  // ---- Express middleware: require a valid access token ----
  requireAuth = (req, res, next) => {
    const token = this._extractToken(req);
    if (!token) return res.status(401).json({ error: 'No token' });
    const payload = this.verifyAccessToken(token);
    if (!payload) return res.status(401).json({ error: 'Invalid token' });
    req.user = payload;
    next();
  };

  // Optional auth — populates req.user if present, never rejects
  optionalAuth = (req, _res, next) => {
    const token = this._extractToken(req);
    if (token) req.user = this.verifyAccessToken(token);
    next();
  };

  requireAdmin = (req, res, next) => {
    this.requireAuth(req, res, () => {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin required' });
      }
      next();
    });
  };

  _extractToken(req) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return req.cookies?.cd_token || null;
  }

  _parseDuration(spec) {
    // very small subset: "30d", "24h", "15m", "30s", or numeric ms
    if (typeof spec === 'number') return spec;
    const match = /^(\d+)([dhms])$/.exec(spec);
    if (!match) return 24 * 60 * 60 * 1000;
    const n = parseInt(match[1], 10);
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
    return n * unit;
  }
}

export function makeLoginRateLimiter({ max, windowMinutes }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => req.ip,
    message: { error: 'Too many login attempts. Try again later.' },
  });
}
