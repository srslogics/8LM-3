import express from 'express';
import { workspaceRoutes } from './workspaces.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const derive = promisify(scrypt);
const path = process.env.DATABASE_PATH || './data/8lm.db';
mkdirSync(dirname(path), { recursive: true });
const db = new Database(path);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);`);
const app = express();
app.disable('x-powered-by');
const production = process.env.NODE_ENV === 'production';
const appOrigin = new URL(process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 8000}`).origin;
if (production) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': production ? [] : null } } }));
app.use(express.json({ limit: '4kb' }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== appOrigin))) return res.status(403).json({ error: 'Please use the login page to continue.' });
  next();
});
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
const digest = token => createHash('sha256').update(token).digest('hex');
const cookieToken = req => req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('8lm_session='))?.slice(12);
function session(req) { const token = cookieToken(req); return token ? db.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(digest(token), Date.now()) : null; }
function signIn(req, res, user) {
  const old = cookieToken(req); if (old) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(old));
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), user.id, Date.now() + 7 * 86400000);
  res.cookie('8lm_session', token, { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 7 * 86400000, path: '/' });
  res.json({ user: { email: user.email } });
}
app.post('/api/auth/:action', limiter, async (req, res) => {
  const { action } = req.params;
  if (!['login', 'signup'].includes(action)) return res.sendStatus(404);
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length > 128 || password.length < (action === 'signup' ? 12 : 1)) return res.status(400).json({ error: 'Enter a valid email. New passwords must contain 12–128 characters.' });
  if (action === 'signup') {
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(password, salt, 64)).toString('hex');
    try { const result = db.prepare('INSERT INTO users(email,salt,password_hash) VALUES(?,?,?)').run(email, salt, hash); return signIn(req, res, { id: result.lastInsertRowid, email }); }
    catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Unable to create this account. Try signing in instead.' }); throw error; }
  }
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const hash = await derive(password, user?.salt || 'unregistered-account', 64);
  if (!user || !timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex'))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  signIn(req, res, user);
});
app.get('/api/me', (req, res) => { const user = session(req); res.json({ user: user ? { email: user.email } : null }); });
app.post('/api/logout', (req, res) => { const token = cookieToken(req); if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token)); res.clearCookie('8lm_session', { path: '/' }); res.json({ ok: true }); });
workspaceRoutes(app, db, session);
app.use(express.static('public'));
app.use((_error, _req, res, _next) => res.status(500).json({ error: 'Something went wrong. Please try again.' }));
app.listen(process.env.PORT || 8000, () => console.log(`8LM ready on port ${process.env.PORT || 8000}`));
