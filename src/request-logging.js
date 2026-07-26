import crypto from 'node:crypto';

function safeRequestId(value) {
  const candidate = String(value || '');
  return /^[A-Za-z0-9_-]{8,80}$/.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

export function requestLogging(req, res, next) {
  const started = process.hrtime.bigint();
  const requestId = safeRequestId(req.get('x-request-id'));

  req.requestId = requestId;
  res.set('x-request-id', requestId);

  res.on('finish', () => {
    const durationMs =
      Number(process.hrtime.bigint() - started) / 1_000_000;

    console.log(JSON.stringify({
      event: 'http_request',
      request_id: requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(1)),
      user_id: req.user?.id || null
    }));
  });

  next();
}

export function logError(error, req = null) {
  console.error(JSON.stringify({
    event: 'application_error',
    request_id: req?.requestId || null,
    method: req?.method || null,
    path: req?.path || null,
    error_name: String(error?.name || 'Error'),
    error_code: String(error?.code || ''),
    message: String(error?.message || 'Eroare necunoscută').slice(0, 500)
  }));
}
