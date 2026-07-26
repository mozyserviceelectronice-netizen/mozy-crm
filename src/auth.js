import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const COOKIE_NAME = 'mozy_crm_session';
const RETURN_BASE = 'https://mozy-crm.local';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/'
  };
}

export async function validCredentials(username, password) {
  const normalized = String(username || '').trim();
  if (!normalized || !password) return null;

  const result = await query(`
    SELECT id, username, password_hash, activ
    FROM crm.utilizatori
    WHERE LOWER(username) = LOWER($1)
    LIMIT 1
  `, [normalized]);

  if (result.rowCount) {
    const user = result.rows[0];
    if (!user.activ) return null;
    if (!(await bcrypt.compare(password, user.password_hash))) return null;

    await query(`
      UPDATE crm.utilizatori
      SET ultima_autentificare_la = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [user.id]);

    return { id: user.id, username: user.username };
  }

  if (normalized !== process.env.CRM_ADMIN_USER) return null;
  const passwordHash = process.env.CRM_ADMIN_PASSWORD_HASH || '';
  if (!(await bcrypt.compare(password, passwordHash))) return null;

  const created = await query(`
    INSERT INTO crm.utilizatori (
      username,
      password_hash,
      activ,
      ultima_autentificare_la
    )
    VALUES ($1, $2, TRUE, NOW())
    ON CONFLICT (LOWER(username))
    DO UPDATE SET
      activ = TRUE,
      ultima_autentificare_la = NOW(),
      updated_at = NOW()
    RETURNING id, username
  `, [normalized, passwordHash]);

  return created.rows[0];
}

export function createSession(res, user) {
  const token = jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: 'admin'
    },
    process.env.SESSION_SECRET,
    { expiresIn: '12h', issuer: 'mozy-crm' }
  );
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

export function safeLoginReturnTo(value, fallback = '/') {
  const candidate = String(value || '').trim();
  if (
    !candidate ||
    candidate.length > 2000 ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\')
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, RETURN_BASE);
    if (
      parsed.origin !== RETURN_BASE ||
      parsed.pathname === '/login' ||
      parsed.pathname === '/logout'
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    const session = jwt.verify(token, process.env.SESSION_SECRET, {
      issuer: 'mozy-crm'
    });
    const id = Number(session.sub);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Sesiune veche');

    const result = await query(`
      SELECT id, username
      FROM crm.utilizatori
      WHERE id = $1 AND activ = TRUE
    `, [id]);
    if (!result.rowCount) throw new Error('Cont inactiv');

    req.user = {
      id: result.rows[0].id,
      username: result.rows[0].username,
      role: 'admin'
    };
    next();
  } catch {
    clearSession(res);
    const returnTo = safeLoginReturnTo(req.originalUrl);
    res.redirect(
      `/login?returnTo=${encodeURIComponent(returnTo)}`
    );
  }
}

export function hashPassword(password) {
  return bcrypt.hash(password, 12);
}
