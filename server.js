// server.js — Admin panel DeadpoolCHK (projectoPrimoVIPS)
// Minimal API para listar + editar usuarios con auth cookie + rate limit + whitelist estricta.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const fs = require('fs');

const PORT = +process.env.PORT || 3737;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambiame123';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = 8;

// ─────────────────── DB POOL ───────────────────
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: +process.env.DB_PORT || 3306,
  connectionLimit: 8,
  connectTimeout: 15000,
  charset: 'utf8mb4',
});

// ─────────────────── LOG DE CAMBIOS ───────────────────
const LOG_PATH = path.join(__dirname, 'admin-changes.log');
function logChange(actor, userId, username, field, oldVal, newVal) {
  const line = `${new Date().toISOString()} | by=${actor} | user=${userId}(${username}) | ${field}: ${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (_) {}
}

// ─────────────────── SESSIONS (in-memory) ───────────────────
const sessions = new Map(); // token → { exp, actor, ip }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function createSession(actor, ip) {
  const token = newToken();
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  sessions.set(token, { exp, actor, ip });
  return { token, exp };
}
function validateSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(token); return null; }
  return s;
}
// GC cada 1h
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now > v.exp) sessions.delete(k);
}, 3600 * 1000);

// ─────────────────── APP ───────────────────
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─────────────────── RATE LIMITS ───────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos. Reintentá en 15 min.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
});

// ─────────────────── AUTH MIDDLEWARE ───────────────────
function requireAuth(req, res, next) {
  const token = req.signedCookies?.ppv_session;
  const s = token && validateSession(token);
  if (!s) return res.status(401).json({ error: 'auth required' });
  req.session = s;
  next();
}
function pageAuth(req, res, next) {
  const token = req.signedCookies?.ppv_session;
  const s = token && validateSession(token);
  if (!s) return res.redirect('/login');
  req.session = s;
  next();
}

// ─────────────────── ROUTES ───────────────────

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API
app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'password requerido' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'password incorrecto' });
  }
  const ip = req.ip || req.headers['x-forwarded-for'] || 'local';
  const { token, exp } = createSession('admin', ip);
  res.cookie('ppv_session', token, {
    httpOnly: true, signed: true, sameSite: 'strict',
    secure: req.secure, maxAge: (exp - Date.now()),
  });
  return res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = req.signedCookies?.ppv_session;
  if (token) sessions.delete(token);
  res.clearCookie('ppv_session');
  res.json({ ok: true });
});

// Health check
app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Index (requiere auth)
app.get('/', pageAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────── API USUARIOS ───────────────────
app.use('/api/users', apiLimiter);

// Stats dashboard
app.get('/api/stats', requireAuth, async (_req, res) => {
  try {
    const [[total]] = await db.query('SELECT COUNT(*) AS n FROM users');
    const [[vipActive]] = await db.query('SELECT COUNT(*) AS n FROM users WHERE isVip=1 AND expiry>NOW()');
    const [[vipExpired]] = await db.query('SELECT COUNT(*) AS n FROM users WHERE isVip=1 AND (expiry IS NULL OR expiry<=NOW())');
    const [[free]] = await db.query('SELECT COUNT(*) AS n FROM users WHERE isVip=0 OR isVip IS NULL');
    const [[sums]] = await db.query('SELECT COALESCE(SUM(credits),0) AS credits, COALESCE(SUM(creditsms),0) AS creditsms, COALESCE(SUM(charged),0) AS charged FROM users');
    res.json({
      total: total.n,
      vipActive: vipActive.n,
      vipExpired: vipExpired.n,
      free: free.n,
      sumCredits: Number(sums.credits),
      sumCreditsms: Number(sums.creditsms),
      sumCharged: Number(sums.charged),
    });
  } catch (e) {
    console.error('stats', e);
    res.status(500).json({ error: 'stats fail' });
  }
});

// List users con filtros
const SORT_WHITELIST = {
  id: 'id', username: 'username', email: 'email',
  expiry: 'expiry', credits: 'credits', creditsms: 'creditsms',
  charged: 'charged', createdAt: 'createdAt', updatedAt: 'updatedAt',
};
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const q = (req.query.q || '').trim();
    const status = (req.query.status || 'all').toLowerCase(); // all|vip|vip_active|vip_expired|free
    const minCredits = req.query.minCredits !== undefined && req.query.minCredits !== '' ? Number(req.query.minCredits) : null;
    const maxCredits = req.query.maxCredits !== undefined && req.query.maxCredits !== '' ? Number(req.query.maxCredits) : null;
    const minSms = req.query.minSms !== undefined && req.query.minSms !== '' ? Number(req.query.minSms) : null;
    const maxSms = req.query.maxSms !== undefined && req.query.maxSms !== '' ? Number(req.query.maxSms) : null;

    const sortBy = SORT_WHITELIST[req.query.sortBy] || 'id';
    const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const where = [];
    const args = [];

    if (q) {
      // buscar por id, username, email o telegramUsername
      if (/^\d+$/.test(q)) {
        where.push('(id = ? OR username LIKE ? OR email LIKE ? OR telegramUsername LIKE ?)');
        args.push(Number(q), `%${q}%`, `%${q}%`, `%${q}%`);
      } else {
        where.push('(username LIKE ? OR email LIKE ? OR telegramUsername LIKE ?)');
        args.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
    }
    if (status === 'vip') where.push('isVip=1');
    else if (status === 'vip_active') where.push('isVip=1 AND expiry>NOW()');
    else if (status === 'vip_expired') where.push('isVip=1 AND (expiry IS NULL OR expiry<=NOW())');
    else if (status === 'free') where.push('(isVip=0 OR isVip IS NULL)');

    if (minCredits !== null && !Number.isNaN(minCredits)) { where.push('(credits >= ?)'); args.push(minCredits); }
    if (maxCredits !== null && !Number.isNaN(maxCredits)) { where.push('(credits <= ?)'); args.push(maxCredits); }
    if (minSms !== null && !Number.isNaN(minSms)) { where.push('(creditsms >= ?)'); args.push(minSms); }
    if (maxSms !== null && !Number.isNaN(maxSms)) { where.push('(creditsms <= ?)'); args.push(maxSms); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT id, username, email, telegramUsername, isVip, expiry, credits, creditsms, charged, createdAt, updatedAt
       FROM users ${whereSql}
       ORDER BY ${sortBy} ${sortDir}
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[cnt]] = await db.query(`SELECT COUNT(*) AS n FROM users ${whereSql}`, args);

    res.json({
      page, limit, total: cnt.n,
      totalPages: Math.max(1, Math.ceil(cnt.n / limit)),
      rows,
    });
  } catch (e) {
    console.error('users list', e);
    res.status(500).json({ error: 'list fail' });
  }
});

// Detalle de 1 user
app.get('/api/users/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalido' });
  try {
    const [rows] = await db.query(
      'SELECT id, username, email, telegramUsername, telegramVerified, isVip, expiry, credits, creditsms, charged, createdAt, updatedAt, lastLogin FROM users WHERE id=? LIMIT 1',
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('user detail', e);
    res.status(500).json({ error: 'detail fail' });
  }
});

// PATCH user (whitelist estricta)
const EDITABLE_FIELDS = new Set(['isVip', 'expiry', 'credits', 'creditsms', 'charged']);
app.patch('/api/users/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalido' });
  const body = req.body || {};
  const changes = {};
  for (const k of Object.keys(body)) {
    if (!EDITABLE_FIELDS.has(k)) continue;
    changes[k] = body[k];
  }
  if (Object.keys(changes).length === 0) {
    return res.status(400).json({ error: 'nada para actualizar' });
  }

  // Validaciones por tipo
  const sanitized = {};
  try {
    if ('isVip' in changes) {
      sanitized.isVip = changes.isVip ? 1 : 0;
    }
    if ('expiry' in changes) {
      if (changes.expiry === null || changes.expiry === '') {
        sanitized.expiry = null;
      } else {
        const d = new Date(changes.expiry);
        if (isNaN(d.getTime())) throw new Error('expiry invalida');
        sanitized.expiry = d.toISOString().slice(0, 19).replace('T', ' ');
      }
    }
    if ('credits' in changes) {
      const n = parseInt(changes.credits);
      if (!Number.isFinite(n) || n < 0) throw new Error('credits debe ser int >= 0');
      sanitized.credits = n;
    }
    if ('creditsms' in changes) {
      const n = Number(changes.creditsms);
      if (!Number.isFinite(n) || n < 0) throw new Error('creditsms debe ser num >= 0');
      sanitized.creditsms = Math.round(n * 1000) / 1000;
    }
    if ('charged' in changes) {
      const n = parseInt(changes.charged);
      if (!Number.isFinite(n) || n < 0) throw new Error('charged debe ser int >= 0');
      sanitized.charged = n;
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    // leer estado actual (para log + validar que existe)
    const [cur] = await db.query('SELECT id, username, isVip, expiry, credits, creditsms, charged FROM users WHERE id=? LIMIT 1', [id]);
    if (!cur[0]) return res.status(404).json({ error: 'not found' });
    const before = cur[0];

    const setPairs = Object.keys(sanitized).map(k => `\`${k}\`=?`).join(', ');
    const args = Object.values(sanitized);
    args.push(id);
    await db.query(`UPDATE users SET ${setPairs}, updatedAt=NOW() WHERE id=?`, args);

    // log cada cambio
    for (const k of Object.keys(sanitized)) {
      if (String(before[k]) !== String(sanitized[k])) {
        logChange(req.session.actor, id, before.username, k, before[k], sanitized[k]);
      }
    }

    const [after] = await db.query('SELECT id, username, email, telegramUsername, isVip, expiry, credits, creditsms, charged, updatedAt FROM users WHERE id=? LIMIT 1', [id]);
    res.json({ ok: true, user: after[0] });
  } catch (e) {
    console.error('user patch', e);
    res.status(500).json({ error: 'update fail' });
  }
});

// ─────────────────── 404 ───────────────────
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// ─────────────────── START ───────────────────
app.listen(PORT, () => {
  console.log(`🩸 projectoPrimoVIPS admin → http://localhost:${PORT}`);
  console.log(`   DB  : ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  console.log(`   Auth: password en ADMIN_PASSWORD env`);
});

process.on('SIGINT', () => { console.log('bye'); process.exit(0); });
process.on('SIGTERM', () => { console.log('bye'); process.exit(0); });
