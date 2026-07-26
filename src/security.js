import crypto from 'node:crypto';
import helmet from 'helmet';

const CSRF_COOKIE = 'mozy_crm_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/'
  };
}

function csrfToken(secret) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(`mozy-crm-csrf:${secret}`, 'utf8')
    .digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function nonceMiddleware(_req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(18).toString('base64');
  next();
}

export function contentSecurityPolicy() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: [
          "'self'",
          (_req, res) => `'nonce-${res.locals.cspNonce}'`
        ],
        scriptSrcAttr: ["'none'"],
        styleSrc: [
          "'self'",
          (_req, res) => `'nonce-${res.locals.cspNonce}'`
        ],
        upgradeInsecureRequests:
          process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' }
  });
}

export function csrfProtection(req, res, next) {
  let secret = String(req.cookies?.[CSRF_COOKIE] || '');

  if (!TOKEN_PATTERN.test(secret)) {
    secret = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    res.cookie(CSRF_COOKIE, secret, cookieOptions());
  }

  const expected = csrfToken(secret);
  res.locals.csrfToken = expected;

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const supplied =
    req.body?._csrf ||
    req.get('x-csrf-token') ||
    '';

  if (!TOKEN_PATTERN.test(String(supplied)) ||
      !safeEqual(expected, supplied)) {
    return res.status(403).render('error', {
      message:
        'Cererea nu mai este validă. Reîncarcă pagina și încearcă din nou.',
      active: ''
    });
  }

  next();
}

export const csrfInternals = {
  CSRF_COOKIE,
  csrfToken,
  safeEqual
};
