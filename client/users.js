// User and role management. Two roles: 'admin' and 'guest'.

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

export class Users {
  constructor(store) {
    this.store = store;
  }

  list() {
    return this.store.getUsers().map(u => this._sanitize(u));
  }

  async create({ username, password, role = 'guest', createdBy = null }) {
    if (!username || username.length < 3) {
      throw new Error('Username must be at least 3 characters');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    if (this.store.getUserByUsername(username)) {
      throw new Error('Username already exists');
    }
    if (role !== 'admin' && role !== 'guest') {
      throw new Error('Invalid role');
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = {
      id: randomUUID(),
      username,
      passwordHash,
      role,
      twoFactor: null,    // { secret, enabledAt } once configured
      createdAt: Date.now(),
      createdBy,
      lastLoginAt: null,
    };
    this.store.upsertUser(user);
    return this._sanitize(user);
  }

  async verifyPassword(username, password) {
    const user = this.store.getUserByUsername(username);
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  async changePassword(userId, newPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const user = this.store.getUserById(userId);
    if (!user) throw new Error('User not found');
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    this.store.upsertUser(user);
  }

  setTwoFactor(userId, secret) {
    const user = this.store.getUserById(userId);
    if (!user) throw new Error('User not found');
    user.twoFactor = { secret, enabledAt: Date.now() };
    this.store.upsertUser(user);
  }

  clearTwoFactor(userId) {
    const user = this.store.getUserById(userId);
    if (!user) return;
    user.twoFactor = null;
    this.store.upsertUser(user);
  }

  recordLogin(userId) {
    const user = this.store.getUserById(userId);
    if (!user) return;
    user.lastLoginAt = Date.now();
    this.store.upsertUser(user);
  }

  delete(userId) {
    this.store.deleteUser(userId);
  }

  hasAnyAdmin() {
    return this.store.getUsers().some(u => u.role === 'admin');
  }

  _sanitize(user) {
    if (!user) return null;
    const { passwordHash, twoFactor, ...safe } = user;
    return {
      ...safe,
      twoFactorEnabled: !!twoFactor,
    };
  }
}
