import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pool, migrate, seedOwner, audit } from './database.js';
import { allowedViews, createSession, destroySession, optionalSession, requireAuth, requireRole } from './auth.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDirectory = path.join(root, 'DEMO');
const demoMode = process.env.DEMO_MODE === 'true';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://www.habbo.es'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const expected = process.env.APP_ORIGIN;
  const origin = req.get('origin');
  if (expected && origin && origin !== expected) return res.status(403).json({ error: 'INVALID_ORIGIN', message: 'Origen no permitido.' });
  return next();
});

app.use('/api/auth', rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));

app.get('/api/health', async (_req, res) => {
  if (demoMode) return res.json({ status: 'demo', database: 'disabled', demoMode: true });
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', demoMode });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

app.use('/api', optionalSession);

app.post('/api/auth/challenge', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const purpose = req.body?.purpose === 'login' ? 'login' : 'register';
  if (!/^[A-Za-z0-9._:!\-]{2,32}$/.test(username)) return res.status(400).json({ error: 'INVALID_USERNAME', message: 'El nombre de Habbo no es válido.' });
  const id = crypto.randomUUID();
  const code = `SHEIN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await pool.execute('DELETE FROM auth_challenges WHERE expires_at < NOW() OR (username = ? AND verified_at IS NULL)', [username]);
  await pool.execute(
    `INSERT INTO auth_challenges (id, username, code, purpose, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [id, username, code, purpose]
  );
  res.status(201).json({ challengeId: id, code, expiresIn: 600, simulated: demoMode });
});

app.post('/api/auth/verify', async (req, res) => {
  const challengeId = String(req.body?.challengeId || '');
  const [rows] = await pool.execute('SELECT * FROM auth_challenges WHERE id = ? AND expires_at > NOW() AND verified_at IS NULL LIMIT 1', [challengeId]);
  const challenge = rows[0];
  if (!challenge || challenge.attempts >= 5) return res.status(400).json({ error: 'CHALLENGE_EXPIRED', message: 'El código venció. Solicita uno nuevo.' });
  await pool.execute('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', [challengeId]);

  const demoAllowed = demoMode || (process.env.ALLOW_DEMO_VERIFICATION === 'true' && process.env.NODE_ENV !== 'production');
  let profile;
  if (!demoAllowed) {
    try {
      const response = await fetch(`https://www.habbo.es/api/public/users?name=${encodeURIComponent(challenge.username)}`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) profile = await response.json();
    } catch { /* A temporary Habbo failure becomes a retryable response below. */ }
  }

  if (!demoAllowed && (!profile || !String(profile.motto || '').includes(challenge.code))) {
    return res.status(422).json({ error: 'MOTTO_NOT_FOUND', message: 'Aún no vemos el código en tu misión pública. Guárdalo en Habbo y vuelve a comprobar.' });
  }

  const owner = (process.env.BOOTSTRAP_OWNER || '').toLocaleLowerCase() === challenge.username.toLocaleLowerCase();
  const initialRole = demoMode || owner ? 'owner' : (challenge.purpose === 'register' ? 'pending' : 'member');
  const initialStatus = demoMode || owner ? 'active' : (challenge.purpose === 'register' ? 'pending' : 'active');
  await pool.execute(
    `INSERT INTO users (habbo_id, username, role, status, last_activity_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE habbo_id = COALESCE(VALUES(habbo_id), habbo_id),
       role = IF(?, 'owner', role), status = IF(?, 'active', status), last_activity_at = NOW()`,
    [profile?.uniqueId || null, challenge.username, initialRole, initialStatus, demoMode, demoMode]
  );
  const [[user]] = await pool.execute('SELECT id, username, role, status, department FROM users WHERE username = ? LIMIT 1', [challenge.username]);
  await pool.execute('UPDATE auth_challenges SET verified_at = NOW() WHERE id = ?', [challengeId]);
  await createSession(res, user.id);
  await audit(user.id, challenge.purpose === 'login' ? 'auth.login' : 'auth.register', 'user', String(user.id));
  res.json({ user, allowedViews: allowedViews(user.role), demoMode });
});

app.get('/api/session', (req, res) => {
  if (!req.user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: req.user, allowedViews: allowedViews(req.user.role), demoMode });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
});

app.get('/api/dashboard', requireAuth, async (_req, res) => {
  const [[members]] = await pool.query("SELECT COUNT(*) total, SUM(status = 'active') active FROM users WHERE status <> 'blocked'");
  const [[pending]] = await pool.query("SELECT COUNT(*) total FROM users WHERE status = 'pending'");
  res.json({ members: Number(members.total), activeMembers: Number(members.active || 0), pendingRequests: Number(pending.total) });
});

app.get('/api/members', requireAuth, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limit || '10', 10)));
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * limit;
  const where = search ? 'WHERE username LIKE ?' : '';
  const params = search ? [`%${search}%`] : [];
  const [[count]] = await pool.execute(`SELECT COUNT(*) total FROM users ${where}`, params);
  const [items] = await pool.execute(
    `SELECT id, username, role, status, department, last_activity_at lastActivityAt
     FROM users ${where} ORDER BY FIELD(role, 'owner','admin','supervisor','member','pending'), username LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ items, page, limit, total: Number(count.total), pages: Math.max(1, Math.ceil(Number(count.total) / limit)) });
});

app.get('/api/requests', requireAuth, requireRole('owner','admin'), async (_req, res) => {
  const [items] = await pool.query(
    `SELECT id, username, created_at createdAt FROM users
     WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50`
  );
  res.json({ items });
});

app.patch('/api/requests/:id', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const action = req.body?.action;
  if (!['approve','reject'].includes(action)) return res.status(400).json({ error: 'INVALID_ACTION', message: 'Acción inválida.' });
  if (action === 'approve') {
    await pool.execute("UPDATE users SET role = 'member', status = 'active' WHERE id = ? AND status = 'pending'", [req.params.id]);
  } else {
    await pool.execute("UPDATE users SET status = 'blocked' WHERE id = ? AND status = 'pending'", [req.params.id]);
  }
  await audit(req.user.id, `request.${action}`, 'user', req.params.id);
  res.json({ updated: true });
});

app.patch('/api/members/:id', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const permittedRoles = ['admin','supervisor','member','pending'];
  const permittedStatuses = ['active','away','inactive','pending','blocked'];
  const role = permittedRoles.includes(req.body?.role) ? req.body.role : null;
  const status = permittedStatuses.includes(req.body?.status) ? req.body.status : null;
  if (!role && !status) return res.status(400).json({ error: 'INVALID_UPDATE', message: 'No hay cambios válidos.' });
  await pool.execute('UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ? AND role <> \'owner\'', [role, status, req.params.id]);
  await audit(req.user.id, 'member.update', 'user', req.params.id, { role, status });
  res.json({ updated: true });
});

app.get('/api/settings', requireAuth, async (_req, res) => {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM agency_settings');
  res.json(Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])));
});

app.put('/api/settings', requireAuth, requireRole('owner'), async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return res.status(400).json({ error: 'INVALID_SETTINGS', message: 'Configuración inválida.' });
  const entries = Object.entries(settings).slice(0, 30);
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(key)) continue;
    await pool.execute(
      `INSERT INTO agency_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [key, JSON.stringify(value), req.user.id]
    );
  }
  await audit(req.user.id, 'settings.update', 'agency', null, { keys: entries.map(([key]) => key) });
  res.json({ saved: true });
});

app.use(express.static(publicDirectory, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/', (_req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Ruta no encontrada.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' });
});

async function start() {
  if (!demoMode) {
    await migrate();
    await seedOwner();
  }
  app.listen(port, '0.0.0.0', () => console.log(`Agencia Shein disponible en el puerto ${port}`));
}

start().catch((error) => {
  console.error('No se pudo iniciar la aplicación:', error);
  process.exit(1);
});

export default app;
