import assert from 'node:assert/strict';
import test from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';
import {
  contentSecurityPolicy,
  csrfInternals,
  csrfProtection,
  nonceMiddleware
} from '../src/security.js';

process.env.SESSION_SECRET =
  'test-secret-that-is-long-enough-for-hmac-validation';

function responseMock() {
  return {
    locals: {},
    cookieValue: null,
    statusCode: null,
    rendered: null,
    cookie(_name, value) {
      this.cookieValue = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    render(view, locals) {
      this.rendered = { view, locals };
      return this;
    }
  };
}

function requestMock({
  method = 'GET',
  cookie = '',
  body = {},
  header = ''
} = {}) {
  return {
    method,
    cookies: cookie
      ? { [csrfInternals.CSRF_COOKIE]: cookie }
      : {},
    body,
    get(name) {
      return name.toLowerCase() === 'x-csrf-token'
        ? header
        : '';
    }
  };
}

test('emite un token CSRF și îl acceptă la POST', () => {
  const getResponse = responseMock();
  let getNext = false;

  csrfProtection(
    requestMock(),
    getResponse,
    () => { getNext = true; }
  );

  assert.equal(getNext, true);
  assert.match(getResponse.cookieValue, /^[a-f0-9]{64}$/);
  assert.match(getResponse.locals.csrfToken, /^[a-f0-9]{64}$/);

  const postResponse = responseMock();
  let postNext = false;
  csrfProtection(
    requestMock({
      method: 'POST',
      cookie: getResponse.cookieValue,
      body: { _csrf: getResponse.locals.csrfToken }
    }),
    postResponse,
    () => { postNext = true; }
  );

  assert.equal(postNext, true);
  assert.equal(postResponse.statusCode, null);
});

test('respinge un POST fără token CSRF', () => {
  const response = responseMock();
  let nextCalled = false;

  csrfProtection(
    requestMock({ method: 'POST' }),
    response,
    () => { nextCalled = true; }
  );

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.rendered.view, 'error');
});

test('compararea tokenurilor nu acceptă valori parțiale', () => {
  assert.equal(csrfInternals.safeEqual('abc', 'abc'), true);
  assert.equal(csrfInternals.safeEqual('abc', 'ab'), false);
  assert.equal(csrfInternals.safeEqual('abc', 'abd'), false);
});

test('CSP și CSRF funcționează împreună într-o cerere HTTP', async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(nonceMiddleware);
  app.use(contentSecurityPolicy());
  app.use(csrfProtection);
  app.get('/', (_req, res) => {
    res.send(
      `<meta name="csrf-token" content="${res.locals.csrfToken}">` +
      `<script nonce="${res.locals.cspNonce}">void 0</script>`
    );
  });
  app.post('/', (_req, res) => res.sendStatus(204));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const getResponse = await fetch(base);
    const html = await getResponse.text();
    const cookie = getResponse.headers.get('set-cookie');
    const token = html.match(/content="([a-f0-9]{64})"/)?.[1];

    assert.ok(cookie);
    assert.ok(token);
    assert.match(
      getResponse.headers.get('content-security-policy'),
      /script-src 'self' 'nonce-/
    );

    const postResponse = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie.split(';')[0]
      },
      body: new URLSearchParams({ _csrf: token })
    });
    assert.equal(postResponse.status, 204);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
