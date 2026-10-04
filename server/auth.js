import crypto from 'node:crypto';
import { pool } from './database.js';

const cookieName = 'shein_session';
const roles = {
  owner: ['*'],
  admin: ['overview','account','ranks','departments','promotions','timers','payroll','attendance','ranking','members','requests','payments','memberships','operations','missions','discipline','content','audit','tools','bot'],
  supervisor: ['overview','account','ranks','departments','promotions','timers','payroll','attendance','ranking','members','payments','memberships','operations','missions'],
  member: ['overview','account','ranks','departments','timers','attendance','ranking'],
  pending: ['account']
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((value) => value.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function allowedViews(role) {
  return roles[role] || roles.pending;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  try {
    const keyBuffer = Buffer.from(keyHex, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    if (keyBuffer.length !== derivedKey.length) return false;
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

const memorySessions = new Map();

export async function createSession(res, userId, mockUser = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = Math.max(1, Math.min(180, Number(process.env.SESSION_DAYS || 60)));
  const tokenHash = hash(token);
  const expiresAt = Date.now() + days * 86400000;

  if (mockUser || process.env.DEMO_MODE === 'true') {
    memorySessions.set(tokenHash, {
      userId,
      expiresAt,
      user: mockUser || {
        id: userId || 1,
        username: 'Gusgus95MX',
        role: 'owner',
        status: 'active',
        department: 'Dirección General',
        current_mission: 'SHN · Dueño · GUS',
        rank_name: 'Dueño',
        hasPassword: true
      }
    });
  } else {
    try {
      await pool.execute('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))', [userId, tokenHash, days]);
    } catch {
      memorySessions.set(tokenHash, {
        userId,
        expiresAt,
        user: { id: userId, username: 'Gusgus95MX', role: 'owner', status: 'active', department: 'Dirección General', hasPassword: true }
      });
    }
  }

  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: days * 86400000,
    path: '/'
  });
}

export function isOwner(username) {
  if (!username) return false;
  const clean = String(username).trim().toLowerCase();
  if (clean === 'gusgus95mx') return true;
  const raw = `${process.env.BOOTSTRAP_OWNER || ''}`.toLowerCase();
  const owners = raw.split(',').map((s) => s.trim()).filter((s) => s && s !== 'keekit08');
  return owners.includes(clean);
}

export async function optionalSession(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token) return next();
    const tokenHash = hash(token);

    const memSession = memorySessions.get(tokenHash);
    if (memSession && memSession.expiresAt > Date.now()) {
      if (memSession.user && isOwner(memSession.user.username)) {
        memSession.user.role = 'owner';
        memSession.user.rank_name = 'Dueño';
        memSession.user.current_mission = 'SHN · Dueño · GUS';
        memSession.user.department = 'Dirección General';
      }
      req.user = memSession.user;
      return next();
    }

    if (process.env.DEMO_MODE === 'true') return next();

    const [rows] = await pool.execute(
      `SELECT u.id, u.username, u.role, u.status, u.department, u.current_mission, u.rank_id,
              u.membership_id, u.membership_expires_at,
              r.name AS rank_name, r.badge_code, r.badge_url,
              m.name AS membership_name, m.reduction_percent,
              (u.password_hash IS NOT NULL) AS hasPassword
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN ranks r ON r.id = u.rank_id
       LEFT JOIN memberships_catalog m ON m.id = u.membership_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    if (rows[0]) {
      if (isOwner(rows[0].username)) {
        rows[0].role = 'owner';
        rows[0].rank_name = 'Dueño';
        rows[0].current_mission = 'SHN · Dueño · GUS';
        rows[0].department = 'Dirección General';
        pool.execute(
          "UPDATE users SET role = 'owner', status = 'active', rank_id = (SELECT id FROM ranks WHERE name = 'Dueño' LIMIT 1), current_mission = 'SHN · Dueño · GUS', department = 'Dirección General' WHERE id = ?",
          [rows[0].id]
        ).catch(() => {});
      }
      req.user = rows[0];
      pool.execute('UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = ?', [tokenHash]).catch(() => {});
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
  if (req.user.status === 'blocked') return res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: 'Esta cuenta está bloqueada.' });
  return next();
}

export function requireRole(...permitted) {
  return (req, res, next) => permitted.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'FORBIDDEN', message: 'No tienes permisos para realizar esta acción.' });
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[cookieName];
  if (token) {
    const tokenHash = hash(token);
    memorySessions.delete(tokenHash);
    try { await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]); } catch {}
  }
  res.clearCookie(cookieName, { path: '/', sameSite: 'strict' });
}
