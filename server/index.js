try { process.loadEnvFile(); } catch {}

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pool, migrate, seedOwner, audit, recalculatePayrollPeriod } from './database.js';
import { allowedViews, createSession, destroySession, optionalSession, requireAuth, requireRole, hashPassword, verifyPassword } from './auth.js';

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

const memoryChallenges = new Map();

app.post('/api/auth/challenge', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const purpose = req.body?.purpose === 'login' ? 'login' : 'register';
  if (!/^[A-Za-z0-9._:!\-]{2,32}$/.test(username)) return res.status(400).json({ error: 'INVALID_USERNAME', message: 'El nombre de Habbo no es válido.' });
  const id = crypto.randomUUID();
  const code = `SHEIN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  if (demoMode) {
    memoryChallenges.set(id, { username, code, purpose, expiresAt: Date.now() + 600000 });
    return res.status(201).json({ challengeId: id, code, expiresIn: 600, simulated: demoMode });
  }

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

  if (demoMode) {
    const challenge = memoryChallenges.get(challengeId);
    if (!challenge || challenge.expiresAt < Date.now()) return res.status(400).json({ error: 'CHALLENGE_EXPIRED', message: 'El código venció. Solicita uno nuevo.' });
    const bootstrapOwners = (process.env.BOOTSTRAP_OWNER || 'Gusgus95MX,keekit08').split(',').map((name) => name.trim().toLocaleLowerCase()).filter(Boolean);
    const owner = bootstrapOwners.includes(challenge.username.toLocaleLowerCase());
    const initialRole = demoMode || owner ? 'owner' : (challenge.purpose === 'register' ? 'pending' : 'member');
    const mockUser = {
      id: owner ? (challenge.username.toLowerCase() === 'keekit08' ? 2 : 1) : 99,
      username: challenge.username,
      role: initialRole,
      status: 'active',
      department: owner ? 'Dirección General' : 'Operaciones',
      current_mission: owner ? 'SHN · Dueño · KEK · GUS' : 'SHN · AGT · Iniciado J [KEK]',
      rank_name: owner ? 'Dueño' : 'Agente',
      hasPassword: true
    };
    await createSession(res, mockUser.id, mockUser);
    return res.json({ user: mockUser, allowedViews: allowedViews(mockUser.role), demoMode, hasPassword: true });
  }

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

  const bootstrapOwners = (process.env.BOOTSTRAP_OWNER || '').split(',').map((name) => name.trim().toLocaleLowerCase()).filter(Boolean);
  const owner = bootstrapOwners.includes(challenge.username.toLocaleLowerCase());
  const initialRole = demoMode || owner ? 'owner' : (challenge.purpose === 'register' ? 'pending' : 'member');
  const initialStatus = demoMode || owner ? 'active' : (challenge.purpose === 'register' ? 'pending' : 'active');
  await pool.execute(
    `INSERT INTO users (habbo_id, username, role, status, last_activity_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE habbo_id = COALESCE(VALUES(habbo_id), habbo_id),
       role = IF(?, 'owner', role), status = IF(?, 'active', status), last_activity_at = NOW()`,
    [profile?.uniqueId || null, challenge.username, initialRole, initialStatus, demoMode, demoMode]
  );
  const [[user]] = await pool.execute('SELECT id, username, role, status, department, (password_hash IS NOT NULL) AS hasPassword FROM users WHERE username = ? LIMIT 1', [challenge.username]);
  await pool.execute('UPDATE auth_challenges SET verified_at = NOW() WHERE id = ?', [challengeId]);
  await createSession(res, user.id);
  await audit(user.id, challenge.purpose === 'login' ? 'auth.login' : 'auth.register', 'user', String(user.id));
  res.json({ user, allowedViews: allowedViews(user.role), demoMode, hasPassword: Boolean(user.hasPassword) });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Escribe tu usuario y contraseña.' });
  }

  if (demoMode) {
    const bootstrapOwners = (process.env.BOOTSTRAP_OWNER || 'Gusgus95MX,keekit08').split(',').map((name) => name.trim().toLocaleLowerCase()).filter(Boolean);
    const isOwner = bootstrapOwners.includes(username.toLowerCase());
    const mockUser = {
      id: isOwner ? (username.toLowerCase() === 'keekit08' ? 2 : 1) : 99,
      username,
      role: isOwner ? 'owner' : 'member',
      status: 'active',
      department: isOwner ? 'Dirección General' : 'Base',
      current_mission: isOwner ? 'SHN · Dueño · KEK · GUS' : 'SHN · Operativo',
      rank_name: isOwner ? 'Dueño' : 'Operativo',
      hasPassword: true
    };
    await createSession(res, mockUser.id, mockUser);
    return res.json({
      user: mockUser,
      allowedViews: allowedViews(mockUser.role),
      demoMode,
      hasPassword: true
    });
  }

  const [[user]] = await pool.execute(
    'SELECT id, username, password_hash, role, status, department FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  if (!user || !user.password_hash) {
    return res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: user && !user.password_hash
        ? 'Aún no tienes una contraseña configurada en la agencia. Entra validando tu misión para crear una.'
        : 'Usuario o contraseña incorrectos.',
      hasPassword: Boolean(user?.password_hash)
    });
  }
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Usuario o contraseña incorrectos.', hasPassword: true });
  }
  if (user.status === 'blocked') {
    return res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: 'Esta cuenta está bloqueada.' });
  }
  await pool.execute('UPDATE users SET last_activity_at = NOW() WHERE id = ?', [user.id]);
  await createSession(res, user.id);
  await audit(user.id, 'auth.login_password', 'user', String(user.id));
  res.json({
    user: { id: user.id, username: user.username, role: user.role, status: user.status, department: user.department },
    allowedViews: allowedViews(user.role),
    demoMode,
    hasPassword: true
  });
});

app.post('/api/auth/set-password', async (req, res) => {
  const password = String(req.body?.password || '');
  const challengeId = String(req.body?.challengeId || '');
  if (password.length < 4) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', message: 'La contraseña debe tener al menos 4 caracteres.' });
  }
  let userId = req.user?.id;
  if (!userId && challengeId) {
    const [[challenge]] = await pool.execute(
      'SELECT username FROM auth_challenges WHERE id = ? AND verified_at IS NOT NULL LIMIT 1',
      [challengeId]
    );
    if (challenge) {
      const [[user]] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [challenge.username]);
      if (user) userId = user.id;
    }
  }
  if (!userId) {
    return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Debes verificar tu sesión o misión primero.' });
  }
  const passwordHash = hashPassword(password);
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
  await audit(userId, 'auth.set_password', 'user', String(userId));
  res.json({ saved: true, message: 'Contraseña guardada correctamente.' });
});

app.get('/api/session', (req, res) => {
  if (!req.user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: req.user, allowedViews: allowedViews(req.user.role), demoMode, hasPassword: Boolean(req.user.hasPassword) });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
});

app.get('/api/dashboard', requireAuth, async (_req, res) => {
  const [[members]] = await pool.query("SELECT COUNT(*) total, SUM(status = 'active') active FROM users WHERE status <> 'blocked'");
  const [[pending]] = await pool.query("SELECT COUNT(*) total FROM users WHERE status = 'pending'");

  // Active draft payroll info
  const [[draftPayroll]] = await pool.query("SELECT total_evaluated, total_credits FROM payroll_periods WHERE status = 'draft' ORDER BY id DESC LIMIT 1").catch(() => [[{ total_evaluated: 0, total_credits: 0 }]]);

  // Weekly attendance aggregated
  const [weeklyRows] = await pool.query(`
    SELECT DATE_FORMAT(marked_at, '%w') AS day_num, COUNT(DISTINCT user_id) AS present_count
    FROM attendance_records
    WHERE marked_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND status = 'present'
    GROUP BY day_num
  `).catch(() => [[]]);

  const currentDayNum = new Date().getDay();
  const weekDays = [
    { label: 'Lun', day: 1, basePct: 55 },
    { label: 'Mar', day: 2, basePct: 73 },
    { label: 'Mié', day: 3, basePct: 62 },
    { label: 'Jue', day: 4, basePct: 88 },
    { label: 'Vie', day: 5, basePct: 79 },
    { label: 'Hoy', day: currentDayNum, basePct: 94, isToday: true }
  ];

  const totalActive = Number(members?.active || 1);
  const weeklyAttendance = weekDays.map((wd) => {
    const match = weeklyRows.find(r => Number(r.day_num) === wd.day);
    let pct = wd.basePct;
    if (match) {
      pct = Math.min(100, Math.round((Number(match.present_count) / Math.max(1, totalActive)) * 100));
    }
    return {
      day: wd.label,
      percent: pct,
      isToday: Boolean(wd.isToday)
    };
  });

  // Recent activity stream from audit_log
  const [recentRows] = await pool.query(`
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
           COALESCE(u.username, 'Sistema') AS actor_username
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT 6
  `).catch(() => [[]]);

  const recentActivity = recentRows.map((r) => {
    let meta = {};
    if (typeof r.metadata === 'string') {
      try { meta = JSON.parse(r.metadata); } catch {}
    } else if (r.metadata && typeof r.metadata === 'object') {
      meta = r.metadata;
    }

    let text = `${r.actor_username} realizó ${r.action}`;
    let dotClass = 'coral';

    if (r.action.startsWith('promotion')) {
      dotClass = 'coral';
      text = `<b>${r.actor_username}</b> convalidó el ascenso de ${meta.target_username || 'un integrante'}`;
    } else if (r.action.startsWith('attendance.open')) {
      dotClass = 'coral';
      text = `<b>${r.actor_username}</b> registró un pase de lista (${meta.shift_name || 'Turno noche'})`;
    } else if (r.action.startsWith('attendance')) {
      dotClass = 'green';
      text = `<b>${meta.target_username || r.actor_username}</b> confirmó asistencia en base`;
    } else if (r.action.startsWith('membership')) {
      dotClass = 'yellow';
      text = `<b>${r.actor_username}</b> activó membresía ${meta.membership || ''} para ${meta.target_username || ''}`;
    } else if (r.action.startsWith('request.approve')) {
      dotClass = 'yellow';
      text = `<b>${r.actor_username}</b> aprobó una solicitud de ingreso`;
    } else if (r.action.startsWith('payroll')) {
      dotClass = 'violet';
      text = `<b>${r.actor_username}</b> procesó la nómina (${meta.members || 176} miembros)`;
    } else if (r.action.startsWith('settings')) {
      dotClass = 'violet';
      text = `<b>${r.actor_username}</b> actualizó la configuración de la agencia`;
    } else if (r.action.startsWith('discipline')) {
      dotClass = 'coral';
      text = `<b>${r.actor_username}</b> registró sanción para ${meta.targetUsername || 'un usuario'}`;
    } else if (meta.detail) {
      text = meta.detail;
    }

    return {
      id: r.id,
      action: r.action,
      dotClass,
      html: text,
      created_at: r.created_at
    };
  });

  res.json({
    members: Number(members.total),
    activeMembers: Number(members.active || 0),
    pendingRequests: Number(pending.total),
    todayPayrollPending: Number(draftPayroll?.total_evaluated || 184),
    todayPayrollCredits: Number(draftPayroll?.total_credits || 1840),
    averageAttendancePercent: 86,
    weeklyAttendance,
    recentActivity
  });
});

app.get('/api/ranks', async (_req, res) => {
  const [items] = await pool.query('SELECT * FROM ranks ORDER BY order_num ASC');
  res.json({ items });
});

app.put('/api/ranks/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const {
    pay_salary, pay_bonus,
    req_salary_attendance, req_salary_promotions, req_salary_time_hours, req_salary_signings,
    req_bonus_attendance, req_bonus_promotions, req_bonus_time_hours, req_bonus_signings,
    promotes_up_to, promotion_time_wait, transfer_price, transfer_available, sales_commission_percent,
    badge_code
  } = req.body || {};

  const badgeUrl = badge_code ? `https://www.habbo.es/habbo-imaging/badge/${badge_code}.gif` : undefined;

  await pool.execute(
    `UPDATE ranks SET
      pay_salary = COALESCE(?, pay_salary),
      pay_bonus = COALESCE(?, pay_bonus),
      req_salary_attendance = COALESCE(?, req_salary_attendance),
      req_salary_promotions = COALESCE(?, req_salary_promotions),
      req_salary_time_hours = COALESCE(?, req_salary_time_hours),
      req_salary_signings = COALESCE(?, req_salary_signings),
      req_bonus_attendance = COALESCE(?, req_bonus_attendance),
      req_bonus_promotions = COALESCE(?, req_bonus_promotions),
      req_bonus_time_hours = COALESCE(?, req_bonus_time_hours),
      req_bonus_signings = COALESCE(?, req_bonus_signings),
      promotes_up_to = COALESCE(?, promotes_up_to),
      promotion_time_wait = COALESCE(?, promotion_time_wait),
      transfer_price = COALESCE(?, transfer_price),
      transfer_available = COALESCE(?, transfer_available),
      sales_commission_percent = COALESCE(?, sales_commission_percent),
      badge_code = COALESCE(?, badge_code),
      badge_url = COALESCE(?, badge_url)
     WHERE id = ?`,
    [
      pay_salary, pay_bonus,
      req_salary_attendance, req_salary_promotions, req_salary_time_hours, req_salary_signings,
      req_bonus_attendance, req_bonus_promotions, req_bonus_time_hours, req_bonus_signings,
      promotes_up_to, promotion_time_wait, transfer_price, transfer_available, sales_commission_percent,
      badge_code, badgeUrl, req.params.id
    ]
  );
  await audit(req.user.id, 'rank.update', 'rank', req.params.id);
  res.json({ updated: true });
});

app.get('/api/missions', async (req, res) => {
  const rankId = req.query.rankId ? Number(req.query.rankId) : null;
  const where = rankId ? 'WHERE m.rank_id = ?' : '';
  const params = rankId ? [rankId] : [];
  const [items] = await pool.execute(
    `SELECT m.id, m.rank_id, m.order_num, m.name, m.price, m.sale_available,
            r.name AS rank_name, r.order_num AS rank_order, r.badge_url
     FROM missions_catalog m
     JOIN ranks r ON r.id = m.rank_id
     ${where}
     ORDER BY r.order_num ASC, m.order_num ASC`,
    params
  );
  res.json({ items });
});

app.get('/api/members', requireAuth, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limit || '10', 10)));
  const search = String(req.query.search || '').trim();
  const rankFilter = req.query.rank ? String(req.query.rank).trim() : '';
  const offset = (page - 1) * limit;

  const whereClauses = [];
  const params = [];
  if (search) {
    whereClauses.push('(u.username LIKE ? OR u.current_mission LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (rankFilter) {
    whereClauses.push('(r.name = ? OR u.role = ?)');
    params.push(rankFilter, rankFilter);
  }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const [[count]] = await pool.execute(
    `SELECT COUNT(*) total FROM users u
     LEFT JOIN ranks r ON r.id = u.rank_id
     LEFT JOIN memberships_catalog m ON m.id = u.membership_id
     ${where}`,
    params
  );
  const [items] = await pool.execute(
    `SELECT u.id, u.username, u.role, u.status, u.department, u.current_mission, u.rank_id,
            u.membership_id, u.membership_expires_at,
            r.name AS rank_name, r.badge_code, r.badge_url,
            m.name AS membership_name, m.badge_code AS membership_badge_code, m.badge_url AS membership_badge_url,
            u.last_activity_at lastActivityAt
     FROM users u
     LEFT JOIN ranks r ON r.id = u.rank_id
     LEFT JOIN memberships_catalog m ON m.id = u.membership_id
     ${where}
     ORDER BY COALESCE(r.order_num, 0) DESC, FIELD(u.role, 'owner','admin','supervisor','member','pending'), u.username
     LIMIT ? OFFSET ?`,
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
    const [[agenteRank]] = await pool.execute("SELECT id FROM ranks WHERE name = 'Agente' LIMIT 1");
    await pool.execute(
      "UPDATE users SET role = 'member', status = 'active', rank_id = COALESCE(rank_id, ?), current_mission = COALESCE(current_mission, 'SHN · AGT · Iniciado J') WHERE id = ? AND status = 'pending'",
      [agenteRank?.id || null, req.params.id]
    );
  } else {
    await pool.execute("UPDATE users SET status = 'blocked' WHERE id = ? AND status = 'pending'", [req.params.id]);
  }
  await audit(req.user.id, `request.${action}`, 'user', req.params.id);
  res.json({ updated: true });
});

app.patch('/api/members/:id', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const permittedRoles = ['owner','admin','supervisor','member','pending'];
  const permittedStatuses = ['active','away','inactive','pending','blocked'];
  const role = permittedRoles.includes(req.body?.role) ? req.body.role : null;
  const status = permittedStatuses.includes(req.body?.status) ? req.body.status : null;
  const rankId = req.body?.rank_id ? Number(req.body.rank_id) : null;
  const department = typeof req.body?.department === 'string' ? req.body.department.trim() : null;
  const currentMission = typeof req.body?.current_mission === 'string' ? req.body.current_mission.trim() : null;

  // Protect owner from being demoted by non-owners
  const [[targetUser]] = await pool.execute('SELECT role FROM users WHERE id = ?', [req.params.id]);
  if (!targetUser) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Usuario no encontrado.' });
  if (targetUser.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No puedes modificar a un dueño.' });
  }

  await pool.execute(
    `UPDATE users SET
      role = COALESCE(?, role),
      status = COALESCE(?, status),
      rank_id = COALESCE(?, rank_id),
      department = COALESCE(?, department),
      current_mission = COALESCE(?, current_mission)
     WHERE id = ?`,
    [role, status, rankId, department, currentMission, req.params.id]
  );
  await audit(req.user.id, 'member.update', 'user', req.params.id, { role, status, rankId, department, currentMission });
  res.json({ updated: true });
});

app.post('/api/members/:id/reset-password', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const newPassword = String(req.body?.newPassword || '').trim() || 'shein' + Math.floor(1000 + Math.random() * 9000);
  const passwordHash = hashPassword(newPassword);
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.params.id]);
  await audit(req.user.id, 'member.reset_password', 'user', req.params.id);
  res.json({ success: true, temporaryPassword: newPassword, message: `Contraseña restablecida a: ${newPassword}` });
});

// --- TIMERS ---
app.get('/api/timers', requireAuth, async (req, res) => {
  const tab = req.query.tab || 'active';
  let where = '';
  if (tab === 'active') where = "WHERE t.status = 'active'";
  else if (tab === 'paused') where = "WHERE t.status = 'paused'";
  else if (tab === 'history') where = "WHERE t.status IN ('completed', 'cancelled')";
  else where = "WHERE t.status IN ('active', 'paused')";

  const [items] = await pool.query(`
    SELECT t.id, t.user_id, t.started_by, t.location, t.status, t.notes,
           t.started_at, t.paused_at, t.completed_at, t.accumulated_seconds, t.pause_count,
           u.username, u.department, r.name AS rank_name, r.badge_url,
           sb.username AS starter_username,
           CASE
             WHEN t.status = 'active' THEN t.accumulated_seconds + GREATEST(0, TIMESTAMPDIFF(SECOND, t.started_at, NOW()))
             ELSE t.accumulated_seconds
           END AS current_seconds
    FROM timers t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN ranks r ON r.id = u.rank_id
    JOIN users sb ON sb.id = t.started_by
    ${where}
    ORDER BY t.status = 'active' DESC, t.updated_at DESC
    LIMIT 50
  `);

  const activeTimer = items.find(i => i.status === 'active' && i.user_id === req.user.id) ||
                      items.find(i => i.status === 'active') || null;

  res.json({ items, activeTimer });
});

app.post('/api/timers', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const location = String(req.body?.location || 'Base').trim();
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;

  if (!username) {
    return res.status(400).json({ error: 'MISSING_USER', message: 'Indica el usuario para iniciar el timer.' });
  }

  const [[targetUser]] = await pool.execute('SELECT id, username, status FROM users WHERE username = ? LIMIT 1', [username]);
  if (!targetUser) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: `El usuario ${username} no existe en la agencia.` });
  }

  const [[existing]] = await pool.execute(
    "SELECT id, status FROM timers WHERE user_id = ? AND status IN ('active', 'paused') LIMIT 1",
    [targetUser.id]
  );
  if (existing) {
    return res.status(409).json({
      error: 'TIMER_ALREADY_ACTIVE',
      message: `${username} ya tiene un timer ${existing.status === 'active' ? 'activo' : 'pausado'} en base.`
    });
  }

  const [result] = await pool.execute(
    'INSERT INTO timers (user_id, started_by, location, status, started_at, notes) VALUES (?, ?, ?, "active", NOW(), ?)',
    [targetUser.id, req.user.id, location, notes]
  );

  await audit(req.user.id, 'timer.start', 'timer', String(result.insertId), { target: username, location });
  res.json({ success: true, timerId: result.insertId });
});

app.patch('/api/timers/:id', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const { action, seconds } = req.body || {};
  const timerId = req.params.id;

  const [[timer]] = await pool.execute(
    `SELECT t.*, u.username,
            CASE
              WHEN t.status = 'active' THEN t.accumulated_seconds + GREATEST(0, TIMESTAMPDIFF(SECOND, t.started_at, NOW()))
              ELSE t.accumulated_seconds
            END AS current_seconds
     FROM timers t
     JOIN users u ON u.id = t.user_id
     WHERE t.id = ? LIMIT 1`,
    [timerId]
  );

  if (!timer) {
    return res.status(404).json({ error: 'TIMER_NOT_FOUND', message: 'Timer no encontrado.' });
  }

  if (action === 'pause') {
    if (timer.status !== 'active') return res.status(400).json({ error: 'NOT_ACTIVE', message: 'El timer ya está pausado o inactivo.' });
    const newAccumulated = timer.current_seconds;
    await pool.execute(
      "UPDATE timers SET status = 'paused', paused_at = NOW(), accumulated_seconds = ?, pause_count = pause_count + 1 WHERE id = ?",
      [newAccumulated, timerId]
    );
    await audit(req.user.id, 'timer.pause', 'timer', timerId);
    return res.json({ success: true, status: 'paused', accumulated_seconds: newAccumulated });
  }

  if (action === 'resume') {
    if (timer.status !== 'paused') return res.status(400).json({ error: 'NOT_PAUSED', message: 'El timer no está pausado.' });
    await pool.execute(
      "UPDATE timers SET status = 'active', started_at = NOW(), paused_at = NULL WHERE id = ?",
      [timerId]
    );
    await audit(req.user.id, 'timer.resume', 'timer', timerId);
    return res.json({ success: true, status: 'active' });
  }

  if (action === 'confirm') {
    const finalSeconds = timer.current_seconds;
    await pool.execute(
      "UPDATE timers SET status = 'completed', completed_at = NOW(), accumulated_seconds = ? WHERE id = ?",
      [finalSeconds, timerId]
    );
    await pool.execute(
      "UPDATE users SET accumulated_time_seconds = accumulated_time_seconds + ? WHERE id = ?",
      [finalSeconds, timer.user_id]
    );
    await audit(req.user.id, 'timer.confirm', 'timer', timerId, { seconds: finalSeconds, user: timer.username });
    return res.json({ success: true, status: 'completed', total_seconds: finalSeconds });
  }

  if (action === 'cancel') {
    await pool.execute("UPDATE timers SET status = 'cancelled', completed_at = NOW() WHERE id = ?", [timerId]);
    await audit(req.user.id, 'timer.cancel', 'timer', timerId);
    return res.json({ success: true, status: 'cancelled' });
  }

  if (action === 'adjust' && typeof seconds === 'number') {
    await pool.execute("UPDATE timers SET accumulated_seconds = ? WHERE id = ?", [Math.max(0, seconds), timerId]);
    return res.json({ success: true, accumulated_seconds: Math.max(0, seconds) });
  }

  res.status(400).json({ error: 'INVALID_ACTION', message: 'Acción no reconocida.' });
});

// --- ATTENDANCE ---
app.get('/api/attendance/current', requireAuth, async (_req, res) => {
  const [[session]] = await pool.query(
    `SELECT s.id, s.shift_name, s.status, s.opened_at, s.notes, u.username AS creator_username
     FROM attendance_sessions s
     JOIN users u ON u.id = s.created_by
     WHERE s.status = 'open'
     ORDER BY s.opened_at DESC LIMIT 1`
  );

  if (!session) {
    return res.json({ active: false, session: null, members: [] });
  }

  const [members] = await pool.execute(
    `SELECT u.id, u.username, u.department, u.role, r.name AS rank_name, r.badge_url,
            COALESCE(ar.status, 'unmarked') AS attendance_status,
            ar.marked_at,
            mb.username AS marker_username
     FROM users u
     LEFT JOIN ranks r ON r.id = u.rank_id
     LEFT JOIN attendance_records ar ON ar.user_id = u.id AND ar.session_id = ?
     LEFT JOIN users mb ON mb.id = ar.marked_by
     WHERE u.status = 'active'
     ORDER BY COALESCE(r.order_num, 0) DESC, u.username ASC`,
    [session.id]
  );

  const totalMembers = members.length;
  const totalPresent = members.filter(m => m.attendance_status === 'present').length;
  const totalAbsent = members.filter(m => m.attendance_status === 'absent').length;
  const totalExcused = members.filter(m => m.attendance_status === 'excused').length;

  res.json({
    active: true,
    session,
    totalMembers,
    totalPresent,
    totalAbsent,
    totalExcused,
    members
  });
});

app.post('/api/attendance/start', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const shiftName = String(req.body?.shift_name || '').trim() || 'Turno noche · 22:00';
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;

  await pool.execute("UPDATE attendance_sessions SET status = 'closed', closed_at = NOW() WHERE status = 'open'");

  const [result] = await pool.execute(
    'INSERT INTO attendance_sessions (created_by, shift_name, status, notes) VALUES (?, ?, "open", ?)',
    [req.user.id, shiftName, notes]
  );

  await audit(req.user.id, 'attendance.start', 'session', String(result.insertId), { shiftName });
  res.json({ success: true, sessionId: result.insertId });
});

app.post('/api/attendance/mark', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const sessionId = Number(req.body?.session_id);
  const userId = Number(req.body?.user_id);
  const newStatus = ['present', 'absent', 'excused', 'unmarked'].includes(req.body?.status) ? req.body.status : 'present';

  if (!sessionId || !userId) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Sesión y usuario requeridos.' });
  }

  const [[prev]] = await pool.execute(
    'SELECT status FROM attendance_records WHERE session_id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId]
  );

  if (newStatus === 'unmarked') {
    if (prev) {
      if (prev.status === 'present') {
        await pool.execute('UPDATE users SET accumulated_attendances = GREATEST(0, accumulated_attendances - 1) WHERE id = ?', [userId]);
      }
      await pool.execute('DELETE FROM attendance_records WHERE session_id = ? AND user_id = ?', [sessionId, userId]);
    }
    return res.json({ success: true, status: 'unmarked' });
  }

  await pool.execute(
    `INSERT INTO attendance_records (session_id, user_id, status, marked_by, marked_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), marked_at = NOW()`,
    [sessionId, userId, newStatus, req.user.id]
  );

  if (newStatus === 'present' && (!prev || prev.status !== 'present')) {
    await pool.execute('UPDATE users SET accumulated_attendances = accumulated_attendances + 1 WHERE id = ?', [userId]);
  } else if (newStatus !== 'present' && prev && prev.status === 'present') {
    await pool.execute('UPDATE users SET accumulated_attendances = GREATEST(0, accumulated_attendances - 1) WHERE id = ?', [userId]);
  }

  res.json({ success: true, status: newStatus });
});

app.post('/api/attendance/close', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  await pool.execute("UPDATE attendance_sessions SET status = 'closed', closed_at = NOW() WHERE status = 'open'");
  await audit(req.user.id, 'attendance.close', 'session', null);
  res.json({ success: true });
});

app.get('/api/attendance/history', requireAuth, async (_req, res) => {
  const [sessions] = await pool.query(
    `SELECT s.id, s.shift_name, s.status, s.opened_at, s.closed_at, u.username AS creator_username,
            COUNT(DISTINCT ar.user_id) AS total_marked,
            SUM(ar.status = 'present') AS total_present
     FROM attendance_sessions s
     JOIN users u ON u.id = s.created_by
     LEFT JOIN attendance_records ar ON ar.session_id = s.id
     GROUP BY s.id
     ORDER BY s.opened_at DESC LIMIT 20`
  );
  res.json({ sessions });
});

// --- RANKING ---
app.get('/api/ranking', async (_req, res) => {
  const [topAttendance] = await pool.query(`
    SELECT u.id, u.username, u.accumulated_attendances AS value,
           r.name AS rank_name, r.badge_url
    FROM users u
    LEFT JOIN ranks r ON r.id = u.rank_id
    WHERE u.status <> 'blocked'
    ORDER BY u.accumulated_attendances DESC, u.last_activity_at DESC
    LIMIT 10
  `);

  const [topTime] = await pool.query(`
    SELECT u.id, u.username, u.accumulated_time_seconds AS raw_seconds,
           r.name AS rank_name, r.badge_url
    FROM users u
    LEFT JOIN ranks r ON r.id = u.rank_id
    WHERE u.status <> 'blocked'
    ORDER BY u.accumulated_time_seconds DESC, u.last_activity_at DESC
    LIMIT 10
  `);

  const [topPromotions] = await pool.query(`
    SELECT u.id, u.username, u.accumulated_promotions AS value,
           r.name AS rank_name, r.badge_url
    FROM users u
    LEFT JOIN ranks r ON r.id = u.rank_id
    WHERE u.status <> 'blocked'
    ORDER BY u.accumulated_promotions DESC, u.last_activity_at DESC
    LIMIT 10
  `);

  const formattedTime = topTime.map(item => {
    const hours = Math.floor(item.raw_seconds / 3600);
    const minutes = Math.floor((item.raw_seconds % 3600) / 60);
    return {
      ...item,
      value: `${hours}h ${String(minutes).padStart(2, '0')}m`
    };
  });

  res.json({
    attendance: topAttendance.map(a => ({ ...a, value: `${a.value} asistencias` })),
    time: formattedTime,
    promotions: topPromotions.map(p => ({ ...p, value: `${p.value} ascensos` }))
  });
});

// --- PAYROLL & PAYMENTS ---
app.get('/api/payroll/current', requireAuth, async (_req, res) => {
  let [[period]] = await pool.query(
    "SELECT * FROM payroll_periods WHERE status = 'draft' ORDER BY opened_at DESC LIMIT 1"
  );

  if (!period) {
    const todayCode = `${new Date().toISOString().slice(0, 10)}-noche`;
    const [createRes] = await pool.execute(
      "INSERT INTO payroll_periods (period_code, shift_name, status, opened_at, notes) VALUES (?, 'Turno noche · 22:00', 'draft', NOW(), 'Jornada España en curso') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [todayCode]
    );
    const periodId = createRes.insertId;
    await recalculatePayrollPeriod(periodId);
    [[period]] = await pool.query("SELECT * FROM payroll_periods WHERE id = ?", [periodId]);
  }

  const [items] = await pool.execute(
    `SELECT pi.id, pi.period_id, pi.user_id, pi.qualification, pi.level,
            pi.attendance_count, pi.time_seconds, pi.promotions_count, pi.signings_count,
            pi.discount_applied, pi.credits_to_pay, pi.payment_status,
            pi.override_by, pi.override_reason, pi.notes,
            u.username, u.department, u.role,
            r.name AS rank_name, r.order_num AS rank_order, r.badge_url,
            r.pay_salary, r.pay_bonus,
            r.req_salary_attendance, r.req_salary_promotions, r.req_salary_time_hours,
            r.req_bonus_attendance, r.req_bonus_promotions, r.req_bonus_time_hours,
            m.name AS membership_name, m.reduction_percent,
            ov.username AS override_username
     FROM payroll_items pi
     JOIN users u ON u.id = pi.user_id
     LEFT JOIN ranks r ON r.id = pi.rank_id
     LEFT JOIN memberships_catalog m ON m.id = pi.membership_id
     LEFT JOIN users ov ON ov.id = pi.override_by
     WHERE pi.period_id = ?
     ORDER BY COALESCE(r.order_num, 0) DESC, u.username ASC`,
    [period.id]
  );

  const formattedItems = items.map(item => {
    const timeHours = Math.floor(item.time_seconds / 3600);
    const timeMins = Math.floor((item.time_seconds % 3600) / 60);
    const timeFormatted = item.time_seconds > 0 ? `${timeHours}h ${String(timeMins).padStart(2, '0')}m` : '0';

    return {
      ...item,
      time_formatted: timeFormatted,
      attendance_formatted: `${item.attendance_count} asistencias`
    };
  });

  const totals = {
    evaluated: formattedItems.length,
    nominal: formattedItems.filter(i => i.qualification === 'nominal').length,
    bonus: formattedItems.filter(i => i.qualification === 'bonus').length,
    review: formattedItems.filter(i => i.qualification === 'review').length,
    totalCredits: formattedItems.reduce((acc, i) => acc + (Number(i.credits_to_pay) || 0), 0)
  };

  res.json({
    period,
    totals,
    items: formattedItems
  });
});

app.post('/api/payroll/calculate', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  let [[period]] = await pool.query(
    "SELECT id FROM payroll_periods WHERE status = 'draft' ORDER BY opened_at DESC LIMIT 1"
  );

  let periodId = period?.id;
  if (!periodId) {
    const todayCode = `${new Date().toISOString().slice(0, 10)}-noche`;
    const [createRes] = await pool.execute(
      "INSERT INTO payroll_periods (period_code, shift_name, status, opened_at, notes) VALUES (?, 'Turno noche · 22:00', 'draft', NOW(), 'Jornada España en curso') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [todayCode]
    );
    periodId = createRes.insertId;
  }

  await recalculatePayrollPeriod(periodId);
  await audit(req.user.id, 'payroll.calculate', 'period', String(periodId));

  res.json({ success: true, periodId });
});

app.patch('/api/payroll/items/:id', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const itemId = Number(req.params.id);
  const qualification = ['bonus', 'nominal', 'review'].includes(req.body?.qualification) ? req.body.qualification : null;
  const creditsToPay = typeof req.body?.credits_to_pay === 'number' ? Math.max(0, req.body.credits_to_pay) : null;
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;
  const reason = req.body?.reason ? String(req.body.reason).trim() : 'Ajuste manual de supervisor';

  const [[item]] = await pool.execute('SELECT * FROM payroll_items WHERE id = ? LIMIT 1', [itemId]);
  if (!item) return res.status(404).json({ error: 'NOT_FOUND', message: 'Item de nómina no encontrado.' });

  const newQual = qualification || item.qualification;
  const newCredits = creditsToPay !== null ? creditsToPay : item.credits_to_pay;
  const newLevel = newQual === 'bonus' ? 'high' : 'low';

  await pool.execute(
    `UPDATE payroll_items
     SET qualification = ?, level = ?, credits_to_pay = ?, override_by = ?, override_reason = ?, notes = COALESCE(?, notes)
     WHERE id = ?`,
    [newQual, newLevel, newCredits, req.user.id, reason, notes, itemId]
  );

  // Recalculate period totals
  await pool.execute(
    `UPDATE payroll_periods p SET
       total_nominal = (SELECT COUNT(*) FROM payroll_items WHERE period_id = p.id AND qualification = 'nominal'),
       total_bonus = (SELECT COUNT(*) FROM payroll_items WHERE period_id = p.id AND qualification = 'bonus'),
       total_review = (SELECT COUNT(*) FROM payroll_items WHERE period_id = p.id AND qualification = 'review'),
       total_credits = (SELECT COALESCE(SUM(credits_to_pay), 0) FROM payroll_items WHERE period_id = p.id)
     WHERE id = ?`,
    [item.period_id]
  );

  await audit(req.user.id, 'payroll.override', 'payroll_item', String(itemId), {
    prev: item.qualification,
    next: newQual,
    credits: newCredits,
    reason
  });

  res.json({ success: true, qualification: newQual, credits_to_pay: newCredits });
});

app.post('/api/payroll/close-and-pay', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const [[period]] = await pool.query(
    "SELECT id, total_credits, total_evaluated FROM payroll_periods WHERE status = 'draft' ORDER BY opened_at DESC LIMIT 1"
  );
  if (!period) return res.status(400).json({ error: 'NO_DRAFT', message: 'No hay ninguna nómina en borrador para procesar.' });

  await pool.execute(
    "UPDATE payroll_periods SET status = 'paid', closed_at = NOW(), paid_at = NOW(), processed_by = ? WHERE id = ?",
    [req.user.id, period.id]
  );

  await pool.execute(
    "UPDATE payroll_items SET payment_status = 'paid' WHERE period_id = ? AND payment_status = 'pending'",
    [period.id]
  );

  await audit(req.user.id, 'payroll.pay', 'period', String(period.id), {
    credits: period.total_credits,
    members: period.total_evaluated
  });

  res.json({ success: true, periodId: period.id, paidCredits: period.total_credits });
});

app.get('/api/payroll/history', requireAuth, async (_req, res) => {
  const [history] = await pool.query(
    `SELECT p.id, p.period_code, p.shift_name, p.status, p.opened_at, p.paid_at,
            p.total_evaluated, p.total_nominal, p.total_bonus, p.total_review, p.total_credits,
            p.notes, u.username AS processor_username
     FROM payroll_periods p
     LEFT JOIN users u ON u.id = p.processed_by
     WHERE p.status = 'paid'
     ORDER BY COALESCE(p.paid_at, p.opened_at) DESC
     LIMIT 30`
  );

  const [[currentDraft]] = await pool.query(
    "SELECT total_credits, total_evaluated, shift_name FROM payroll_periods WHERE status = 'draft' ORDER BY opened_at DESC LIMIT 1"
  );

  const nextPayment = {
    date: 'Hoy, 22:00',
    shift: currentDraft?.shift_name || 'España · Turno noche',
    estimatedCredits: currentDraft ? currentDraft.total_credits : 1840,
    estimatedMembers: currentDraft ? currentDraft.total_evaluated : 184
  };

  res.json({ history, nextPayment });
});

app.post('/api/payroll/manual-payment', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const shiftName = String(req.body?.shift_name || '').trim() || 'Noche · España';
  const totalMembers = Number(req.body?.total_members) || 0;
  const totalCredits = Number(req.body?.total_credits) || 0;
  const notes = req.body?.notes ? String(req.body.notes).trim() : 'Paga registrada manualmente';
  const code = `MANUAL-${Date.now()}`;

  const [result] = await pool.execute(
    `INSERT INTO payroll_periods (period_code, shift_name, status, opened_at, closed_at, paid_at, processed_by,
                                  total_evaluated, total_nominal, total_bonus, total_review, total_credits, notes)
     VALUES (?, ?, 'paid', NOW(), NOW(), NOW(), ?, ?, ?, 0, 0, ?, ?)`,
    [code, shiftName, req.user.id, totalMembers, totalMembers, totalCredits, notes]
  );

  await audit(req.user.id, 'payroll.manual_payment', 'period', String(result.insertId), {
    shiftName,
    totalMembers,
    totalCredits
  });

  res.json({ success: true, periodId: result.insertId });
});

// --- MEMBERSHIPS ---
app.get('/api/memberships', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT m.id, m.name, m.badge_code, m.badge_url, m.description, m.price,
            m.reduction_percent, m.sale_available,
            COUNT(u.id) AS active_members
     FROM memberships_catalog m
     LEFT JOIN users u ON u.membership_id = m.id AND u.status = 'active'
     GROUP BY m.id
     ORDER BY m.price ASC, m.id ASC`
  );
  res.json({ memberships: rows, items: rows });
});

app.post('/api/memberships', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const name = String(req.body?.name || '').trim().toUpperCase();
  const description = String(req.body?.description || '').trim();
  const price = Math.max(0, Number(req.body?.price) || 0);
  const reduction_percent = Math.min(100, Math.max(0, Number(req.body?.reduction_percent) || 0));
  const badge_code = req.body?.badge_code ? String(req.body.badge_code).trim() : null;
  const badge_url = badge_code ? `https://www.habbo.es/habbo-imaging/badge/${badge_code}.gif` : null;
  const sale_available = req.body?.sale_available !== false;

  if (!name || !description) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Nombre y descripción requeridos.' });
  }

  const [result] = await pool.execute(
    `INSERT INTO memberships_catalog (name, badge_code, badge_url, description, price, reduction_percent, sale_available)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description), price = VALUES(price),
       reduction_percent = VALUES(reduction_percent), sale_available = VALUES(sale_available)`,
    [name, badge_code, badge_url, description, price, reduction_percent, sale_available ? 1 : 0]
  );

  await audit(req.user.id, 'membership.create', 'membership', String(result.insertId), { name, price });
  res.json({ success: true, id: result.insertId });
});

app.patch('/api/memberships/:id', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const id = Number(req.params.id);
  const description = req.body?.description ? String(req.body.description).trim() : null;
  const price = typeof req.body?.price === 'number' ? Math.max(0, req.body.price) : null;
  const reduction_percent = typeof req.body?.reduction_percent === 'number' ? Math.min(100, Math.max(0, req.body.reduction_percent)) : null;
  const badge_code = typeof req.body?.badge_code === 'string' ? req.body.badge_code.trim() : null;
  const sale_available = typeof req.body?.sale_available === 'boolean' ? (req.body.sale_available ? 1 : 0) : null;

  const [[current]] = await pool.execute('SELECT * FROM memberships_catalog WHERE id = ? LIMIT 1', [id]);
  if (!current) return res.status(404).json({ error: 'NOT_FOUND', message: 'Membresía no encontrada.' });

  const badge_url = badge_code ? `https://www.habbo.es/habbo-imaging/badge/${badge_code}.gif` : current.badge_url;

  await pool.execute(
    `UPDATE memberships_catalog SET
       description = COALESCE(?, description),
       price = COALESCE(?, price),
       reduction_percent = COALESCE(?, reduction_percent),
       badge_code = COALESCE(?, badge_code),
       badge_url = COALESCE(?, badge_url),
       sale_available = COALESCE(?, sale_available)
     WHERE id = ?`,
    [description, price, reduction_percent, badge_code, badge_url, sale_available, id]
  );

  await audit(req.user.id, 'membership.update', 'membership', String(id), { name: current.name });
  res.json({ success: true });
});

app.post('/api/memberships/assign', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const membershipId = Number(req.body?.membership_id);
  const durationDays = Number(req.body?.duration_days) || 30;
  const recordSale = Boolean(req.body?.record_sale);

  const [[user]] = await pool.execute('SELECT id, username FROM users WHERE username = ? LIMIT 1', [username]);
  if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'El usuario no existe.' });

  const [[membership]] = await pool.execute('SELECT id, name, price FROM memberships_catalog WHERE id = ? LIMIT 1', [membershipId]);
  if (!membership) return res.status(404).json({ error: 'MEMBERSHIP_NOT_FOUND', message: 'Membresía no encontrada.' });

  await pool.execute(
    'UPDATE users SET membership_id = ?, membership_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?',
    [membership.id, durationDays, user.id]
  );

  if (recordSale) {
    await pool.execute(
      `INSERT INTO commercial_operations (type, user_id, client_username, concept, credits, final_credits, status, target_membership_id, seller_id, notes)
       VALUES ('sale_membership', ?, ?, ?, ?, ?, 'completed', ?, ?, 'Membresía activada por supervisor')`,
      [user.id, user.username, membership.name, membership.price, membership.price, membership.id, req.user.id]
    );
  }

  await audit(req.user.id, 'membership.assign', 'user', String(user.id), { membership: membership.name, days: durationDays });
  res.json({ success: true, username: user.username, membership: membership.name, expires_days: durationDays });
});

// --- PROMOTIONS & MISSIONS ENGINE ---
function evaluateWaitTime(lastPromotionAt, waitString) {
  if (!waitString || !lastPromotionAt) {
    return { met: true, label: waitString || 'Sin espera', remaining: 'Completo', secondsRemaining: 0, lastDate: lastPromotionAt || null };
  }
  const last = new Date(lastPromotionAt).getTime();
  const now = Date.now();
  const elapsed = Math.max(0, now - last);

  let requiredMs = 0;
  const lower = waitString.toLowerCase();
  if (lower.includes('minuto')) {
    const mins = parseInt(lower, 10) || 30;
    requiredMs = mins * 60 * 1000;
  } else if (lower.includes('hora')) {
    const hours = parseInt(lower, 10) || 4;
    requiredMs = hours * 3600 * 1000;
  } else if (lower.includes('día') || lower.includes('dia')) {
    const days = parseInt(lower, 10) || 1;
    requiredMs = days * 86400 * 1000;
  }

  if (elapsed >= requiredMs) {
    return { met: true, label: waitString, remaining: 'Cumplido', secondsRemaining: 0, lastDate: lastPromotionAt };
  } else {
    const remMs = requiredMs - elapsed;
    const remHours = Math.floor(remMs / 3600000);
    const remDays = Math.floor(remMs / 86400000);
    let remaining = '';
    if (remDays >= 1) {
      const leftHours = remHours % 24;
      remaining = `${remDays}d ${leftHours}h restantes`;
    } else if (remHours >= 1) {
      const remMins = Math.floor((remMs % 3600000) / 60000);
      remaining = `${remHours}h ${remMins}m restantes`;
    } else {
      remaining = `${Math.ceil(remMs / 60000)}m restantes`;
    }
    return { met: false, label: waitString, remaining, secondsRemaining: Math.ceil(remMs / 1000), lastDate: lastPromotionAt };
  }
}

app.get('/api/promotions/profile', requireAuth, async (req, res) => {
  const username = String(req.query.username || req.user.username).trim();
  const [[user]] = await pool.execute(
    `SELECT u.id, u.username, u.role, u.status, u.department, u.current_mission, u.rank_id,
            u.accumulated_promotions, u.accumulated_attendances, u.accumulated_time_seconds,
            u.last_promotion_at,
            r.name AS rank_name, r.order_num AS rank_order, r.badge_code, r.badge_url,
            r.promotes_up_to, r.promotion_time_wait,
            r.req_salary_promotions, r.req_salary_attendance, r.req_salary_time_hours,
            r.req_bonus_promotions, r.req_bonus_attendance, r.req_bonus_time_hours
     FROM users u
     LEFT JOIN ranks r ON r.id = u.rank_id
     WHERE u.username = ? LIMIT 1`,
    [username]
  );

  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Usuario no encontrado.' });
  }

  let nextMission = null;
  let nextRank = null;
  const currentMission = user.current_mission || '';

  const [allCatalogRows] = await pool.query(
    'SELECT m.*, r.order_num AS rank_order, r.name AS rank_name FROM missions_catalog m JOIN ranks r ON r.id = m.rank_id ORDER BY r.order_num ASC, m.order_num ASC'
  );

  const clean = (s) => (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().replace(/JEFE/g, 'JEF');
  const cleanedCurrent = clean(currentMission);

  let currentCatalogRow = allCatalogRows.find((m) => {
    const cleanName = clean(m.name);
    return cleanName && cleanedCurrent.includes(cleanName);
  });

  if (!currentCatalogRow && user.rank_id) {
    const rankRows = allCatalogRows.filter((m) => m.rank_id === user.rank_id);
    currentCatalogRow = rankRows.find((m) => {
      const parts = m.name.split('-');
      const levelPart = clean(parts[1] || m.name);
      return levelPart && cleanedCurrent.includes(levelPart);
    }) || rankRows[0];
  }

  // Career progression in current rank
  let progression = {
    rankName: user.rank_name || 'Sin rango',
    orderNum: currentCatalogRow?.order_num || 1,
    totalInRank: 10,
    percent: 10,
    nextMilestone: 'Próximo sub-rango'
  };

  if (currentCatalogRow) {
    const sameRankMissions = allCatalogRows.filter((m) => m.rank_id === currentCatalogRow.rank_id);
    const totalInRank = sameRankMissions.length || 10;
    const currentOrder = currentCatalogRow.order_num;
    const percent = Math.min(100, Math.round((currentOrder / totalInRank) * 100));
    progression = {
      rankName: currentCatalogRow.rank_name,
      orderNum: currentOrder,
      totalInRank,
      percent,
      nextMilestone: currentOrder < totalInRank ? sameRankMissions[currentOrder]?.name : 'Ascenso a rango superior'
    };
  }

  const promoterTag = req.user.username ? req.user.username.slice(0, 3).toUpperCase() : 'SHN';

  if (currentCatalogRow) {
    const nextInRank = allCatalogRows.find(
      (m) => m.rank_id === currentCatalogRow.rank_id && m.order_num === currentCatalogRow.order_num + 1
    );

    if (nextInRank) {
      const formattedName = nextInRank.name.replace(/\s*-\s*/, ' · ');
      nextMission = `SHN · ${formattedName} [${promoterTag}]`;
      nextRank = { id: nextInRank.rank_id, name: nextInRank.rank_name };
    } else {
      const nextRankRow = allCatalogRows.find(
        (m) => m.rank_order === currentCatalogRow.rank_order + 1 && m.order_num === 1
      );
      if (nextRankRow) {
        const formattedName = nextRankRow.name.replace(/\s*-\s*/, ' · ');
        nextMission = `SHN · ${formattedName} [${promoterTag}]`;
        nextRank = { id: nextRankRow.rank_id, name: nextRankRow.rank_name };
      }
    }
  } else if (user.rank_id) {
    const firstMission = allCatalogRows.find((m) => m.rank_id === user.rank_id && m.order_num === 1);
    if (firstMission) {
      const formattedName = firstMission.name.replace(/\s*-\s*/, ' · ');
      nextMission = `SHN · ${formattedName} [${promoterTag}]`;
      nextRank = { id: firstMission.rank_id, name: firstMission.rank_name };
    }
  }

  if (!nextMission) {
    nextMission = `SHN · Siguiente nivel [${promoterTag}]`;
  }

  // Check last promotion date fallback to promotions_log
  let effectiveLastPromoAt = user.last_promotion_at;
  if (!effectiveLastPromoAt) {
    const [[lastPromoLog]] = await pool.execute(
      'SELECT created_at FROM promotions_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    if (lastPromoLog) effectiveLastPromoAt = lastPromoLog.created_at;
  }

  const waitTime = evaluateWaitTime(effectiveLastPromoAt, user.promotion_time_wait);
  const promoReq = user.req_salary_promotions || 1;
  const attReq = user.req_salary_attendance || 1;
  const timeReqHours = user.req_salary_time_hours || 0;
  const userHours = Math.floor(Number(user.accumulated_time_seconds || 0) / 3600);

  const requirements = {
    promotions: {
      current: user.accumulated_promotions || 0,
      required: promoReq,
      met: (user.accumulated_promotions || 0) >= promoReq
    },
    attendance: {
      current: user.accumulated_attendances || 0,
      required: attReq,
      met: (user.accumulated_attendances || 0) >= attReq
    },
    timeHours: {
      current: userHours,
      required: timeReqHours,
      met: userHours >= timeReqHours
    },
    waitTime
  };

  const isManagement = ['owner', 'admin'].includes(req.user.role);
  const canPromote = isManagement || (requirements.promotions.met && requirements.attendance.met && waitTime.met);

  res.json({
    user,
    nextMission,
    nextRank,
    requirements,
    progression,
    canPromote
  });
});

app.post('/api/promotions/apply', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const newMission = String(req.body?.new_mission || '').trim();
  const rankId = req.body?.rank_id ? Number(req.body.rank_id) : null;
  const notes = req.body?.notes ? String(req.body.notes).trim() : 'Ascenso verificado por supervisor';

  if (!username || !newMission) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Usuario y nueva misión requeridos.' });
  }

  const [[targetUser]] = await pool.execute('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  if (!targetUser) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Usuario no encontrado.' });
  }

  await pool.execute(
    'UPDATE users SET current_mission = ?, rank_id = COALESCE(?, rank_id), last_promotion_at = NOW() WHERE id = ?',
    [newMission, rankId, targetUser.id]
  );

  await pool.execute(
    'UPDATE users SET accumulated_promotions = accumulated_promotions + 1 WHERE id = ?',
    [req.user.id]
  );

  await pool.execute(
    `INSERT INTO promotions_log (user_id, promoter_id, old_mission, new_mission, old_rank_id, new_rank_id, type, credits_paid, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'earned', 0, ?)`,
    [targetUser.id, req.user.id, targetUser.current_mission, newMission, targetUser.rank_id, rankId || targetUser.rank_id, notes]
  );

  await audit(req.user.id, 'promotion.apply', 'user', String(targetUser.id), {
    old_mission: targetUser.current_mission,
    new_mission: newMission
  });

  res.json({ success: true, username: targetUser.username, new_mission: newMission });
});

app.get('/api/promotions/history', requireAuth, async (_req, res) => {
  const [items] = await pool.query(
    `SELECT p.id, p.old_mission, p.new_mission, p.type, p.credits_paid, p.notes, p.created_at,
            u.username AS client_username, u.department,
            prom.username AS promoter_username
     FROM promotions_log p
     JOIN users u ON u.id = p.user_id
     JOIN users prom ON prom.id = p.promoter_id
     ORDER BY p.created_at DESC
     LIMIT 30`
  );
  res.json({ items });
});

app.post('/api/missions/purchase', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const clientUsername = String(req.body?.client_username || '').trim();
  const missionId = req.body?.mission_id ? Number(req.body.mission_id) : null;
  const customMission = req.body?.custom_mission ? String(req.body.custom_mission).trim() : null;
  const discountPercent = Math.min(100, Math.max(0, Number(req.body?.discount_percent) || 0));
  const notes = req.body?.notes ? String(req.body.notes).trim() : 'Compra de rango/misión';

  if (!clientUsername || (!missionId && !customMission)) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Usuario y misión requeridos.' });
  }

  const [[targetUser]] = await pool.execute('SELECT * FROM users WHERE username = ? LIMIT 1', [clientUsername]);
  if (!targetUser) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'El usuario no existe en la agencia.' });
  }

  let missionName = customMission;
  let targetRankId = null;
  let basePrice = Number(req.body?.credits) || 0;

  if (missionId) {
    const [[missionRow]] = await pool.execute('SELECT * FROM missions_catalog WHERE id = ? LIMIT 1', [missionId]);
    if (missionRow) {
      missionName = missionRow.name;
      targetRankId = missionRow.rank_id;
      basePrice = missionRow.price;
    }
  }

  const finalCredits = Math.max(0, Math.round(basePrice * (1 - discountPercent / 100)));
  const cleanMissionName = missionName.replace(/\s*-\s*/, ' · ');
  const fullMissionString = cleanMissionName.startsWith('SHN') ? cleanMissionName : `SHN · ${cleanMissionName} [${req.user.username.slice(0, 3).toUpperCase()}]`;

  await pool.execute(
    'UPDATE users SET current_mission = ?, rank_id = COALESCE(?, rank_id), last_promotion_at = NOW() WHERE id = ?',
    [fullMissionString, targetRankId, targetUser.id]
  );

  await pool.execute(
    `INSERT INTO commercial_operations (
       type, user_id, client_username, concept, credits, discount_percent, final_credits,
       status, target_rank_id, seller_id, notes
     ) VALUES ('sale_mission', ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    [targetUser.id, targetUser.username, missionName, basePrice, discountPercent, finalCredits, targetRankId, req.user.id, notes]
  );

  await pool.execute(
    `INSERT INTO promotions_log (user_id, promoter_id, old_mission, new_mission, old_rank_id, new_rank_id, type, credits_paid, notes)
     VALUES (?, ?, ?, ?, ?, ?, 'purchased', ?, ?)`,
    [targetUser.id, req.user.id, targetUser.current_mission, fullMissionString, targetUser.rank_id, targetRankId, finalCredits, notes]
  );

  await audit(req.user.id, 'mission.purchase', 'commercial_operation', String(targetUser.id), {
    mission: missionName,
    credits: finalCredits
  });

  res.json({
    success: true,
    client_username: targetUser.username,
    new_mission: fullMissionString,
    credits: finalCredits
  });
});

// --- COMMERCIAL OPERATIONS ---
app.get('/api/operations', requireAuth, async (_req, res) => {
  const [[salesAgg]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'completed' AND type <> 'transfer' THEN final_credits ELSE 0 END), 0) AS month_sales_credits,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN final_credits ELSE 0 END), 0) AS pending_credits,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
       COALESCE(SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END), 0) AS transfers_count
     FROM commercial_operations
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  const [sales] = await pool.query(
    `SELECT o.id, o.type, o.client_username, o.concept, o.credits, o.discount_percent,
            o.final_credits, o.status, o.notes, o.created_at, u.username AS seller_username
     FROM commercial_operations o
     LEFT JOIN users u ON u.id = o.seller_id
     WHERE o.type <> 'transfer'
     ORDER BY o.created_at DESC
     LIMIT 30`
  );

  const [transfers] = await pool.query(
    `SELECT o.id, o.client_username, o.origin_agency, o.concept, o.credits, o.status,
            o.notes, o.created_at, u.username AS seller_username
     FROM commercial_operations o
     LEFT JOIN users u ON u.id = o.seller_id
     WHERE o.type = 'transfer'
     ORDER BY o.created_at DESC
     LIMIT 30`
  );

  res.json({
    summary: {
      monthSalesCredits: Number(salesAgg.month_sales_credits),
      pendingCredits: Number(salesAgg.pending_credits),
      pendingCount: Number(salesAgg.pending_count),
      transfersCount: Number(salesAgg.transfers_count)
    },
    sales,
    transfers
  });
});

app.post('/api/operations', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const type = ['sale_membership', 'sale_rank', 'sale_mission', 'transfer', 'other'].includes(req.body?.type) ? req.body.type : 'sale_membership';
  const clientUsername = String(req.body?.client_username || '').trim();
  const concept = String(req.body?.concept || '').trim();
  const credits = Math.max(0, Number(req.body?.credits) || 0);
  const discountPercent = Math.min(100, Math.max(0, Number(req.body?.discount_percent) || 0));
  const finalCredits = Math.max(0, Math.round(credits * (1 - discountPercent / 100)));
  const status = ['completed', 'pending', 'cancelled'].includes(req.body?.status) ? req.body.status : 'completed';
  const originAgency = req.body?.origin_agency ? String(req.body.origin_agency).trim() : null;
  const targetRankId = req.body?.target_rank_id ? Number(req.body.target_rank_id) : null;
  const targetMembershipId = req.body?.target_membership_id ? Number(req.body.target_membership_id) : null;
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;

  if (!clientUsername || !concept) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Usuario y concepto requeridos.' });
  }

  const [[user]] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [clientUsername]);

  const [result] = await pool.execute(
    `INSERT INTO commercial_operations (
       type, user_id, client_username, concept, credits, discount_percent, final_credits,
       status, origin_agency, target_rank_id, target_membership_id, seller_id, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      type, user?.id || null, clientUsername, concept, credits, discountPercent, finalCredits,
      status, originAgency, targetRankId, targetMembershipId, req.user.id, notes
    ]
  );

  if (user && status === 'completed') {
    if (targetMembershipId) {
      await pool.execute(
        'UPDATE users SET membership_id = ?, membership_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id = ?',
        [targetMembershipId, user.id]
      );
    }
    if (targetRankId) {
      await pool.execute('UPDATE users SET rank_id = ? WHERE id = ?', [targetRankId, user.id]);
    }
  }

  await audit(req.user.id, 'operation.create', 'commercial_operation', String(result.insertId), {
    type,
    client: clientUsername,
    concept,
    credits: finalCredits,
    status
  });

  res.json({ success: true, operationId: result.insertId, final_credits: finalCredits });
});

app.patch('/api/operations/:id/status', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const id = Number(req.params.id);
  const newStatus = ['completed', 'pending', 'cancelled'].includes(req.body?.status) ? req.body.status : 'completed';

  const [[op]] = await pool.execute('SELECT * FROM commercial_operations WHERE id = ? LIMIT 1', [id]);
  if (!op) return res.status(404).json({ error: 'NOT_FOUND', message: 'Operación no encontrada.' });

  await pool.execute('UPDATE commercial_operations SET status = ? WHERE id = ?', [newStatus, id]);

  if (newStatus === 'completed' && op.user_id) {
    if (op.target_membership_id) {
      await pool.execute(
        'UPDATE users SET membership_id = ?, membership_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id = ?',
        [op.target_membership_id, op.user_id]
      );
    }
    if (op.target_rank_id) {
      await pool.execute('UPDATE users SET rank_id = ? WHERE id = ?', [op.target_rank_id, op.user_id]);
    }
  }

  await audit(req.user.id, 'operation.update_status', 'commercial_operation', String(id), { status: newStatus });
  res.json({ success: true, status: newStatus });
});

// --- DISCIPLINE & MODERATION ---
app.get('/api/discipline', requireAuth, async (req, res) => {
  const filterType = req.query.type ? String(req.query.type).trim() : 'all';
  const search = req.query.q ? `%${String(req.query.q).trim()}%` : null;

  const [[counts]] = await pool.query(`
    SELECT
      COUNT(*) AS total_all,
      COALESCE(SUM(type = 'fine'), 0) AS total_fine,
      COALESCE(SUM(type = 'demotion'), 0) AS total_demotion,
      COALESCE(SUM(type = 'dismissal'), 0) AS total_dismissal,
      COALESCE(SUM(type = 'clone'), 0) AS total_clone
    FROM disciplinary_records
  `);

  let query = `
    SELECT d.id, d.type, d.target_username, d.target_user_id, d.reason, d.credits,
           d.status, d.evidence_url, d.notes, d.created_at,
           u.department, r.name AS current_rank_name,
           m.username AS moderator_username
    FROM disciplinary_records d
    LEFT JOIN users u ON u.id = d.target_user_id
    LEFT JOIN ranks r ON r.id = u.rank_id
    LEFT JOIN users m ON m.id = d.moderator_id
    WHERE 1=1
  `;
  const params = [];

  if (filterType !== 'all') {
    query += ' AND d.type = ?';
    params.push(filterType);
  }

  if (search) {
    query += ' AND (d.target_username LIKE ? OR d.reason LIKE ? OR d.notes LIKE ?)';
    params.push(search, search, search);
  }

  query += ' ORDER BY d.created_at DESC LIMIT 50';

  const [items] = await pool.execute(query, params);

  res.json({
    counts: {
      all: Number(counts?.total_all || 0),
      fine: Number(counts?.total_fine || 0),
      demotion: Number(counts?.total_demotion || 0),
      dismissal: Number(counts?.total_dismissal || 0),
      clone: Number(counts?.total_clone || 0)
    },
    items
  });
});

app.post('/api/discipline', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const type = String(req.body?.type || '').trim();
  const targetUsername = String(req.body?.target_username || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const credits = Math.max(0, Number(req.body?.credits) || 0);
  const status = String(req.body?.status || (type === 'clone' ? 'allowed' : (type === 'fine' ? 'pending' : 'applied'))).trim();
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;

  if (!['fine','demotion','dismissal','clone'].includes(type)) {
    return res.status(400).json({ error: 'INVALID_TYPE', message: 'Tipo de incidencia inválido.' });
  }
  if (!targetUsername || !reason) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Usuario y motivo requeridos.' });
  }

  const [[targetUser]] = await pool.execute('SELECT id, username, rank_id, current_mission, role FROM users WHERE username = ? LIMIT 1', [targetUsername]);

  if (targetUser && targetUser.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No puedes sancionar a un dueño.' });
  }

  if (targetUser) {
    if (type === 'dismissal') {
      await pool.execute("UPDATE users SET status = 'blocked', role = 'pending' WHERE id = ?", [targetUser.id]);
    } else if (type === 'demotion') {
      const [[currentRank]] = await pool.execute('SELECT order_num FROM ranks WHERE id = ? LIMIT 1', [targetUser.rank_id]);
      if (currentRank && currentRank.order_num > 1) {
        const [[lowerRank]] = await pool.execute('SELECT id, name FROM ranks WHERE order_num = ? LIMIT 1', [currentRank.order_num - 1]);
        if (lowerRank) {
          await pool.execute("UPDATE users SET rank_id = ?, current_mission = CONCAT('SHN · ', ?, ' · Iniciado J') WHERE id = ?", [lowerRank.id, lowerRank.name, targetUser.id]);
        }
      }
    }
  }

  const [result] = await pool.execute(
    `INSERT INTO disciplinary_records (type, target_username, target_user_id, reason, credits, status, moderator_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [type, targetUsername, targetUser?.id || null, reason, credits, status, req.user.id, notes]
  );

  await audit(req.user.id, `discipline.${type}`, 'disciplinary_record', String(result.insertId), {
    targetUsername,
    reason,
    credits,
    status
  });

  res.json({ success: true, id: result.insertId, targetUsername, type, status });
});

app.patch('/api/discipline/:id', requireAuth, requireRole('owner','admin','supervisor'), async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status ? String(req.body.status).trim() : null;
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

  const [[record]] = await pool.execute('SELECT * FROM disciplinary_records WHERE id = ? LIMIT 1', [id]);
  if (!record) return res.status(404).json({ error: 'NOT_FOUND', message: 'Registro disciplinario no encontrado.' });

  await pool.execute(
    `UPDATE disciplinary_records SET
       status = COALESCE(?, status),
       notes = COALESCE(?, notes)
     WHERE id = ?`,
    [status, notes, id]
  );

  await audit(req.user.id, 'discipline.update_status', 'disciplinary_record', String(id), { status, notes });
  res.json({ success: true, id, status: status || record.status });
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

// --- AUDIT LOG ---
app.get('/api/audit', requireAuth, requireRole('owner', 'admin', 'supervisor'), async (req, res) => {
  const category = req.query.category ? String(req.query.category).trim() : 'all';
  const from = req.query.from ? String(req.query.from).trim() : null;
  const to = req.query.to ? String(req.query.to).trim() : null;
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));

  let query = `
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
           COALESCE(u.username, 'Sistema') AS actor_username
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== 'all') {
    if (category === 'promotions' || category === 'Ascensos') query += " AND a.action LIKE 'promotion%'";
    else if (category === 'ranks' || category === 'Rangos') query += " AND (a.action LIKE 'rank%' OR a.action LIKE 'mission%')";
    else if (category === 'memberships' || category === 'Membresías') query += " AND a.action LIKE 'membership%'";
    else if (category === 'attendance' || category === 'Fichajes') query += " AND (a.action LIKE 'attendance%' OR a.action LIKE 'timer%')";
    else if (category === 'payroll' || category === 'Pagas') query += " AND a.action LIKE 'payroll%'";
    else if (category === 'discipline' || category === 'Disciplina') query += " AND a.action LIKE 'discipline%'";
  }

  if (from) {
    query += " AND a.created_at >= ?";
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    query += " AND a.created_at <= ?";
    params.push(`${to} 23:59:59`);
  }

  query += " ORDER BY a.created_at DESC LIMIT ?";
  params.push(limit);

  const [items] = await pool.execute(query, params);

  const formattedItems = items.map((i) => {
    let meta = {};
    if (typeof i.metadata === 'string') {
      try { meta = JSON.parse(i.metadata); } catch {}
    } else if (i.metadata && typeof i.metadata === 'object') {
      meta = i.metadata;
    }

    let categoryLabel = 'Sistema';
    let iconClass = 'coral-bg';
    let iconSymbol = '⚙';
    let actionLabel = i.action;
    let targetUser = meta.target_username || meta.targetUsername || (i.entity_type === 'user' && !isNaN(Number(i.entity_id)) ? `Usuario #${i.entity_id}` : (i.entity_id || '-'));
    let detail = meta.detail || meta.reason || meta.notes || '-';

    if (i.action.startsWith('promotion')) {
      categoryLabel = 'Ascensos';
      iconClass = 'coral-bg';
      iconSymbol = '↑';
      actionLabel = 'Ascenso';
      detail = meta.detail || `${meta.from_mission || ''} → ${meta.to_mission || ''}`;
    } else if (i.action.startsWith('membership')) {
      categoryLabel = 'Membresías';
      iconClass = 'yellow-bg';
      iconSymbol = '✦';
      actionLabel = 'Membresía';
      detail = meta.detail || `Membresía ${meta.membership || ''} gestionada`;
    } else if (i.action.startsWith('payroll')) {
      categoryLabel = 'Pagas';
      iconClass = 'lavender-bg';
      iconSymbol = '◇';
      actionLabel = 'Paga';
      targetUser = `${meta.members || 176} miembros`;
      detail = meta.detail || `${meta.credits || 0} créditos procesados`;
    } else if (i.action.startsWith('attendance')) {
      categoryLabel = 'Fichajes';
      iconClass = 'green-bg';
      iconSymbol = '✓';
      actionLabel = 'Fichaje';
      detail = meta.detail || 'Asistencia registrada en base';
    } else if (i.action.startsWith('discipline')) {
      categoryLabel = 'Disciplina';
      iconClass = 'coral-bg';
      iconSymbol = '!';
      actionLabel = 'Disciplina';
      detail = `${meta.reason || ''} (${meta.status || ''})`;
    } else if (i.action.startsWith('rank')) {
      categoryLabel = 'Rangos';
      iconClass = 'yellow-bg';
      iconSymbol = '◆';
      actionLabel = 'Rango';
    } else if (i.action === 'account.update_profile') {
      categoryLabel = 'Cuenta';
      actionLabel = 'Perfil actualizado';
      iconClass = 'lavender-bg';
      iconSymbol = '●';
      targetUser = i.actor_username;
      detail = `Cumpleaños: ${meta.birthday || '-'} · Estado: ${meta.custom_status || meta.customStatus || '-'}`;
    } else if (i.action === 'account.request_name_change') {
      categoryLabel = 'Cuenta';
      actionLabel = 'Cambio de nombre';
      iconClass = 'coral-bg';
      iconSymbol = '↗';
      targetUser = i.actor_username;
      detail = `Solicitó cambio a "${meta.desiredName || meta.desiredUsername || ''}"`;
    } else if (i.action === 'account.change_password') {
      categoryLabel = 'Seguridad';
      actionLabel = 'Contraseña cambiada';
      iconClass = 'green-bg';
      iconSymbol = '🔒';
      targetUser = i.actor_username;
      detail = 'Credenciales de acceso actualizadas';
    } else if (i.action === 'auth.login_password') {
      categoryLabel = 'Seguridad';
      actionLabel = 'Inicio de sesión';
      iconClass = 'green-bg';
      iconSymbol = '✓';
      targetUser = i.actor_username;
      detail = 'Acceso con contraseña verificado';
    } else if (i.action === 'content.update') {
      categoryLabel = 'Contenido';
      actionLabel = 'Contenido web';
      iconClass = 'coral-bg';
      iconSymbol = '▣';
      targetUser = 'Sitio público';
      detail = 'Banner y personal destacado actualizados';
    }

    return {
      id: i.id,
      rawAction: i.action,
      category: categoryLabel,
      actionLabel,
      iconClass,
      iconSymbol,
      targetUser,
      actorUsername: i.actor_username,
      detail,
      createdAt: i.created_at
    };
  });

  res.json({ items: formattedItems });
});

app.get('/api/audit/export', requireAuth, requireRole('owner', 'admin'), async (_req, res) => {
  const [items] = await pool.query(`
    SELECT a.id, a.action, a.metadata, a.created_at, COALESCE(u.username, 'Sistema') AS actor_username
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT 500
  `);

  const csvRows = ['"ID","Fecha","Accion","Encargado","Detalle"'];
  for (const item of items) {
    let meta = {};
    if (typeof item.metadata === 'string') {
      try { meta = JSON.parse(item.metadata); } catch {}
    } else if (item.metadata && typeof item.metadata === 'object') {
      meta = item.metadata;
    }
    const dateStr = new Date(item.created_at).toISOString().replace('T', ' ').slice(0, 19);
    const detailStr = (meta.detail || meta.reason || JSON.stringify(meta)).replaceAll('"', '""');
    csvRows.push(`"${item.id}","${dateStr}","${item.action}","${item.actor_username}","${detailStr}"`);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="shein_auditoria.csv"');
  res.send(csvRows.join('\r\n'));
});

// --- CONTENT & LANDING ---
app.get('/api/content', async (_req, res) => {
  const [[setting]] = await pool.query("SELECT setting_value FROM agency_settings WHERE setting_key = 'site_content' LIMIT 1").catch(() => [[]]);
  let content = null;
  if (setting?.setting_value) {
    try {
      content = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
    } catch {}
  }
  if (!content) {
    content = {
      banner: {
        title: 'Agencia Shein',
        subtitle: 'Disfruta de sorteos y premios semanales.',
        badge_text: 'BANNER ACTIVO',
        button_text: 'Únete hoy',
        button_url: 'registro.html',
        mark: 'S'
      },
      employees_of_month: [
        { username: 'keekit08', month: 'Septiembre', role: 'Dueño' },
        { username: 'Gusgus95MX', month: 'Septiembre', role: 'Dueño' },
        { username: 'pgg-Pedro', month: 'Septiembre', role: 'Director' }
      ]
    };
  }

  const [ranks] = await pool.query('SELECT order_num, name, badge_url FROM ranks WHERE order_num <= 10 ORDER BY order_num ASC');
  res.json({
    ...content,
    visible_ranks: ranks
  });
});

app.put('/api/content', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const { banner, employees_of_month } = req.body || {};
  if (!banner && !employees_of_month) {
    return res.status(400).json({ error: 'MISSING_DATA', message: 'Datos de contenido no proporcionados.' });
  }

  const [[currentSetting]] = await pool.query("SELECT setting_value FROM agency_settings WHERE setting_key = 'site_content' LIMIT 1").catch(() => [[]]);
  let content = {
    banner: {
      title: 'Agencia Shein',
      subtitle: 'Disfruta de sorteos y premios semanales.',
      badge_text: 'BANNER ACTIVO',
      button_text: 'Únete hoy',
      button_url: 'registro.html',
      mark: 'S'
    },
    employees_of_month: [
      { username: 'keekit08', month: 'Septiembre', role: 'Dueño' },
      { username: 'Gusgus95MX', month: 'Septiembre', role: 'Dueño' },
      { username: 'pgg-Pedro', month: 'Septiembre', role: 'Director' }
    ]
  };

  if (currentSetting?.setting_value) {
    try {
      const parsed = typeof currentSetting.setting_value === 'string' ? JSON.parse(currentSetting.setting_value) : currentSetting.setting_value;
      if (parsed) content = parsed;
    } catch {}
  }

  if (banner) content.banner = { ...content.banner, ...banner };
  if (Array.isArray(employees_of_month)) content.employees_of_month = employees_of_month;

  await pool.execute(
    `INSERT INTO agency_settings (setting_key, setting_value, updated_by) VALUES ('site_content', ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [JSON.stringify(content), req.user.id]
  );

  await audit(req.user.id, 'content.update', 'agency_content', null, content);
  res.json({ success: true, content });
});

// --- ACCOUNT & USER PREFERENCES ---
app.get('/api/account/profile', requireAuth, async (req, res) => {
  const [[user]] = await pool.execute(`
    SELECT u.id, u.username, u.role, u.status, u.department, u.current_mission,
           u.birthday, u.custom_status, u.membership_expires_at,
           u.accumulated_promotions, u.accumulated_attendances, u.accumulated_time_seconds,
           r.name AS rank_name, r.badge_url,
           m.name AS membership_name, m.reduction_percent
    FROM users u
    LEFT JOIN ranks r ON r.id = u.rank_id
    LEFT JOIN memberships_catalog m ON m.id = u.membership_id
    WHERE u.id = ?
    LIMIT 1
  `, [req.user.id]);

  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'Usuario no encontrado.' });

  const [promotions] = await pool.execute(`
    SELECT p.id, p.old_mission, p.new_mission, p.type, p.created_at,
           COALESCE(pr.username, 'Sistema') AS promoter_username
    FROM promotions_log p
    LEFT JOIN users pr ON pr.id = p.promoter_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
    LIMIT 10
  `, [req.user.id]);

  res.json({
    user,
    recentPromotions: promotions
  });
});

app.patch('/api/account/profile', requireAuth, async (req, res) => {
  const birthday = req.body?.birthday ? String(req.body.birthday).trim() : null;
  const customStatus = typeof req.body?.custom_status === 'string' ? req.body.custom_status.trim() : null;

  await pool.execute(
    `UPDATE users SET
       birthday = COALESCE(?, birthday),
       custom_status = COALESCE(?, custom_status)
     WHERE id = ?`,
    [birthday, customStatus, req.user.id]
  );

  await audit(req.user.id, 'account.update_profile', 'user', String(req.user.id), { birthday, customStatus });
  res.json({ success: true, message: 'Perfil actualizado con éxito ✓' });
});

app.post('/api/account/change-password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', message: 'La nueva contraseña debe tener al menos 4 caracteres.' });
  }

  const [[user]] = await pool.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
  if (user?.password_hash) {
    const valid = verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'INVALID_PASSWORD', message: 'La contraseña actual no es correcta.' });
    }
  }

  const newHash = hashPassword(newPassword);
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);
  await audit(req.user.id, 'account.change_password', 'user', String(req.user.id));
  res.json({ success: true, message: 'Contraseña actualizada correctamente ✓' });
});

app.post('/api/account/request-name-change', requireAuth, async (req, res) => {
  const desiredName = String(req.body?.desiredName || req.body?.desiredUsername || '').trim();
  if (!desiredName) {
    return res.status(400).json({ error: 'MISSING_NAME', message: 'Indica el nuevo nombre de usuario.' });
  }

  await audit(req.user.id, 'account.request_name_change', 'user', String(req.user.id), {
    currentUsername: req.user.username,
    desiredName
  });

  res.json({ success: true, message: `Solicitud de cambio a "${desiredName}" enviada a revisión ✓` });
});

// --- ADVANCED AGENCY IMPROVEMENTS & HABBO INTEGRATIONS ---

// 1. Live Habbo Spain Verification
app.get('/api/habbo/verify', requireAuth, async (req, res) => {
  const username = String(req.query.username || req.user.username).trim();
  if (!username) {
    return res.status(400).json({ error: 'MISSING_USERNAME', message: 'Indica el nombre de usuario de Habbo.' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const habboRes = await fetch(`https://www.habbo.es/api/public/users?name=${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'AgenciaShein/1.0 (HabboSpain)' },
      signal: controller.signal
    }).catch(() => null);
    clearTimeout(timeoutId);

    if (!habboRes) {
      return res.status(502).json({ error: 'HABBO_TIMEOUT', message: 'Tiempo de espera agotado al conectar con Habbo España.' });
    }

    if (habboRes.status === 404) {
      return res.json({
        found: false,
        username,
        message: `El usuario "${username}" no existe en Habbo Hotel España.`
      });
    }

    if (!habboRes.ok) {
      return res.status(502).json({ error: 'HABBO_API_ERROR', message: 'Servicio de Habbo no disponible temporalmente.' });
    }

    const habboUser = await habboRes.json();

    // Check groups for rank badge
    let groupBadges = [];
    if (habboUser.uniqueId) {
      try {
        const pCtrl = new AbortController();
        const pTimeout = setTimeout(() => pCtrl.abort(), 4000);
        const pRes = await fetch(`https://www.habbo.es/api/public/users/${habboUser.uniqueId}/profile`, {
          headers: { 'User-Agent': 'AgenciaShein/1.0' },
          signal: pCtrl.signal
        }).catch(() => null);
        clearTimeout(pTimeout);
        if (pRes && pRes.ok) {
          const pData = await pRes.json();
          groupBadges = (pData.groups || []).map((g) => g.badgeCode).filter(Boolean);
        }
      } catch {
        // Ignorar si el perfil está privado o tarda
      }
    }

    // Query local user
    const [[localUser]] = await pool.execute(
      `SELECT u.id, u.username, u.current_mission, r.name AS rank_name, r.badge_code, r.badge_url
       FROM users u
       LEFT JOIN ranks r ON r.id = u.rank_id
       WHERE u.username = ? LIMIT 1`,
      [username]
    );

    const cleanStr = (s) => (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().replace(/JEFE/g, 'JEF');
    const cleanHabboMotto = cleanStr(habboUser.motto);
    const cleanAgencyMission = cleanStr(localUser?.current_mission);
    const mottoMatches = Boolean(cleanAgencyMission && cleanHabboMotto && (cleanHabboMotto.includes(cleanAgencyMission) || cleanAgencyMission.includes(cleanHabboMotto)));

    const selectedBadgeCodes = (habboUser.selectedBadges || []).map((b) => b.code);
    const allBadges = [...groupBadges, ...selectedBadgeCodes];
    const hasRankBadge = localUser?.badge_code ? allBadges.includes(localUser.badge_code) : null;

    res.json({
      found: true,
      habbo: {
        username: habboUser.name,
        motto: habboUser.motto || '(Sin misión colocada)',
        online: Boolean(habboUser.online),
        figureString: habboUser.figureString,
        avatarUrl: `https://www.habbo.es/habbo-imaging/avatarimage?figure=${habboUser.figureString}&head_direction=2&gesture=sml`,
        lastAccessTime: habboUser.lastAccessTime,
        memberSince: habboUser.memberSince,
        profileVisible: habboUser.profileVisible
      },
      verification: {
        localRegistered: Boolean(localUser),
        agencyMission: localUser?.current_mission || null,
        mottoMatches,
        rankName: localUser?.rank_name || null,
        rankBadgeCode: localUser?.badge_code || null,
        rankBadgeUrl: localUser?.badge_url || null,
        hasRankBadge
      }
    });
  } catch (err) {
    console.error('Error verifying Habbo user:', err);
    res.status(500).json({ error: 'VERIFICATION_FAILED', message: 'No se pudo verificar el usuario en Habbo España.' });
  }
});

// 2. Financial Analytics Summary
app.get('/api/finances/summary', requireAuth, async (req, res) => {
  try {
    const [[salesSum]] = await pool.query(
      `SELECT COALESCE(SUM(final_credits),0) AS total_sales,
              COUNT(*) AS total_ops,
              COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_ops,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN final_credits ELSE 0 END),0) AS pending_credits
       FROM commercial_operations`
    );

    const [[payrollSum]] = await pool.query(
      `SELECT COALESCE(SUM(total_credits),0) AS total_payroll,
              COUNT(*) AS periods_paid,
              COALESCE(SUM(total_evaluated),0) AS members_paid
       FROM payroll_periods WHERE status = 'paid'`
    );

    const [salesByType] = await pool.query(
      `SELECT type, COUNT(*) as count, COALESCE(SUM(final_credits),0) as credits
       FROM commercial_operations WHERE status = 'completed' GROUP BY type`
    );

    const [topSellers] = await pool.query(
      `SELECT u.username, u.role, r.name as rank_name,
              COUNT(co.id) AS sales_count,
              COALESCE(SUM(co.final_credits), 0) AS total_volume,
              COALESCE(SUM(co.commission_credits), 0) AS total_commissions
       FROM commercial_operations co
       JOIN users u ON u.id = co.seller_id
       LEFT JOIN ranks r ON r.id = u.rank_id
       WHERE co.status = 'completed'
       GROUP BY co.seller_id
       ORDER BY total_volume DESC
       LIMIT 5`
    );

    const netBalance = Number(salesSum.total_sales || 0) - Number(payrollSum.total_payroll || 0);

    res.json({
      totalSales: Number(salesSum.total_sales || 0),
      totalOperations: Number(salesSum.total_ops || 0),
      pendingCredits: Number(salesSum.pending_credits || 0),
      pendingOperations: Number(salesSum.pending_ops || 0),
      totalPayroll: Number(payrollSum.total_payroll || 0),
      periodsPaid: Number(payrollSum.periods_paid || 0),
      membersPaid: Number(payrollSum.members_paid || 0),
      netBalance,
      salesByType,
      topSellers
    });
  } catch (err) {
    console.error('Error fetching finances summary:', err);
    res.status(500).json({ error: 'FINANCES_ERROR', message: 'Error al obtener resumen financiero.' });
  }
});

// 3. Database SQL Backup Download (Owners & Admins)
app.get('/api/admin/backup', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const [tables] = await pool.query('SHOW TABLES');
    if (!tables.length) {
      return res.status(500).json({ error: 'EMPTY_DB', message: 'No hay tablas en la base de datos.' });
    }
    const dbKey = Object.keys(tables[0])[0];
    const dateStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    let dump = `-- ========================================================\n`;
    dump += `-- AGENCIA SHEIN - HABBO ESPAÑA - RESPALDO COMPLETO SQL\n`;
    dump += `-- Fecha de generación: ${dateStr} (UTC)\n`;
    dump += `-- Servidor: Node.js / MySQL 8\n`;
    dump += `-- ========================================================\n\n`;
    dump += `SET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";\n\n`;

    for (const t of tables) {
      const tableName = t[dbKey];
      if (tableName === 'schema_migrations') continue;

      const [[createRow]] = await pool.query(`SHOW CREATE TABLE \`${tableName}\``);
      dump += `-- --------------------------------------------------------\n`;
      dump += `-- Estructura de tabla para \`${tableName}\`\n`;
      dump += `-- --------------------------------------------------------\n`;
      dump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
      dump += `${createRow['Create Table']};\n\n`;

      const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
      if (rows.length > 0) {
        dump += `-- Volcado de datos para \`${tableName}\` (${rows.length} registros)\n`;
        dump += `INSERT INTO \`${tableName}\` VALUES\n`;
        const rowsSql = rows.map((r) => {
          const vals = Object.values(r).map((v) => {
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return v;
            if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
            if (typeof v === 'boolean') return v ? 1 : 0;
            return pool.escape(String(v));
          });
          return `(${vals.join(', ')})`;
        });
        dump += rowsSql.join(',\n') + ';\n\n';
      }
    }

    dump += `SET FOREIGN_KEY_CHECKS=1;\n-- Fin del respaldo oficial de Agencia Shein\n`;

    await audit(req.user.id, 'admin.backup_download', 'database', 'agencia_shein');

    const filename = `agencia_shein_backup_${new Date().toISOString().slice(0, 10)}.sql`;
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(dump);
  } catch (err) {
    console.error('Error generating backup:', err);
    res.status(500).json({ error: 'BACKUP_FAILED', message: 'No se pudo generar la copia de seguridad SQL.' });
  }
});

// 4. Quick Payroll Item Status (Mark delivery in room)
app.put('/api/payroll/items/:id/status', requireAuth, requireRole('owner', 'admin', 'supervisor'), async (req, res) => {
  const itemId = Number(req.params.id);
  const status = String(req.body?.status || req.body?.delivery_status || 'paid').toLowerCase();
  if (!['pending', 'paid', 'saved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'INVALID_STATUS', message: 'Estado de pago inválido.' });
  }

  const [[item]] = await pool.execute('SELECT * FROM payroll_items WHERE id = ? LIMIT 1', [itemId]);
  if (!item) {
    return res.status(404).json({ error: 'ITEM_NOT_FOUND', message: 'Registro de nómina no encontrado.' });
  }

  await pool.execute(
    'UPDATE payroll_items SET payment_status = ?, override_by = ?, updated_at = NOW() WHERE id = ?',
    [status, req.user.id, itemId]
  );

  await audit(req.user.id, 'payroll.item_status_change', 'payroll_item', String(itemId), {
    oldStatus: item.payment_status,
    newStatus: status
  });

  res.json({ success: true, id: itemId, payment_status: status, delivery_status: status });
});

// 5. Membership Renewal (+30 Days)
app.post('/api/members/:id/renew-membership', requireAuth, requireRole('owner', 'admin', 'supervisor'), async (req, res) => {
  const userId = Number(req.params.id);
  const days = Math.max(1, Math.min(365, Number(req.body?.days || 30)));

  const [[user]] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!user || !user.membership_id) {
    return res.status(400).json({ error: 'NO_MEMBERSHIP', message: 'El usuario no tiene una membresía asignada para renovar.' });
  }

  await pool.execute(
    `UPDATE users
     SET membership_expires_at = CASE
       WHEN membership_expires_at > NOW() THEN DATE_ADD(membership_expires_at, INTERVAL ? DAY)
       ELSE DATE_ADD(NOW(), INTERVAL ? DAY)
     END
     WHERE id = ?`,
    [days, days, userId]
  );

  const [[updated]] = await pool.execute('SELECT membership_expires_at FROM users WHERE id = ?', [userId]);
  await audit(req.user.id, 'membership.renew', 'user', String(userId), { days, newExpiry: updated.membership_expires_at });

  res.json({ success: true, expires_at: updated.membership_expires_at, daysAdded: days });
});

// 6. Live Kiosk Data Feed
app.get('/api/kiosk/live', async (_req, res) => {
  try {
    const [timers] = await pool.query(
      `SELECT t.id, t.started_at, t.accumulated_seconds, t.location, t.status,
              u.username, r.name AS rank_name, r.badge_url
       FROM timers t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN ranks r ON r.id = u.rank_id
       WHERE t.status IN ('active', 'paused')
       ORDER BY t.started_at DESC`
    );

    const [[session]] = await pool.query(
      `SELECT s.*, u.username as creator_name
       FROM attendance_sessions s
       JOIN users u ON u.id = s.created_by
       WHERE s.status = 'open'
       ORDER BY s.id DESC LIMIT 1`
    );

    let sessionCounts = { present: 0, absent: 0, total: 0 };
    if (session) {
      const [[counts]] = await pool.execute(
        `SELECT
           COUNT(CASE WHEN status = 'present' THEN 1 END) AS present,
           COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent,
           COUNT(*) AS total
         FROM attendance_records WHERE session_id = ?`,
        [session.id]
      );
      sessionCounts = counts;
    }

    const [promos] = await pool.query(
      `SELECT p.id, p.new_mission, p.type, p.created_at,
              u.username, r.name AS rank_name,
              prom.username AS promoter_name
       FROM promotions_log p
       JOIN users u ON u.id = p.user_id
       JOIN users prom ON prom.id = p.promoter_id
       LEFT JOIN ranks r ON r.id = p.new_rank_id
       ORDER BY p.created_at DESC LIMIT 6`
    );

    const [topTime] = await pool.query(
      `SELECT u.username, u.current_mission, u.accumulated_time_seconds,
              r.name AS rank_name, r.badge_url
       FROM users u
       LEFT JOIN ranks r ON r.id = u.rank_id
       WHERE u.status = 'active'
       ORDER BY u.accumulated_time_seconds DESC LIMIT 5`
    );

    res.json({
      serverTime: new Date().toISOString(),
      timers,
      session: session ? { ...session, counts: sessionCounts } : null,
      recentPromotions: promos,
      topActive: topTime
    });
  } catch (err) {
    console.error('Error fetching kiosk data:', err);
    res.status(500).json({ error: 'KIOSK_ERROR', message: 'Error cargando datos de kiosco.' });
  }
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
