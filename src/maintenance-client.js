import http from 'node:http';

const socketPath = String(
  process.env.MAINTENANCE_SOCKET ||
    '/run/mozy-crm-maintenance/maintenance.sock'
);

export function maintenanceRequest(
  method,
  requestPath,
  body = null,
  timeoutMs = 15000
) {
  return new Promise((resolve, reject) => {
    const payload = body === null
      ? null
      : Buffer.from(JSON.stringify(body), 'utf8');
    const request = http.request({
      socketPath,
      path: requestPath,
      method,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': String(payload.length)
          }
        : {},
      timeout: timeoutMs
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          return reject(new Error('Răspuns invalid de la serviciul de mentenanță.'));
        }
        if ((response.statusCode || 500) >= 400) {
          return reject(new Error(
            String(data.error || 'Operațiunea de mentenanță a eșuat.')
          ));
        }
        resolve(data);
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('Serviciul de mentenanță nu a răspuns la timp.'));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

export function maintenanceDownload(requestPath, res) {
  const request = http.request({
    socketPath,
    path: requestPath,
    method: 'GET',
    timeout: 30000
  }, response => {
    if ((response.statusCode || 500) >= 400) {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        res.status(response.statusCode || 500).render('error', {
          message: Buffer.concat(chunks).toString('utf8') ||
            'Backupul nu a putut fi descărcat.',
          active: 'setari'
        });
      });
      return;
    }

    for (const header of [
      'content-type',
      'content-length',
      'content-disposition',
      'x-content-type-options'
    ]) {
      if (response.headers[header]) {
        res.setHeader(header, response.headers[header]);
      }
    }
    response.pipe(res);
  });
  request.on('timeout', () => {
    request.destroy(new Error('Descărcarea backupului a expirat.'));
  });
  request.on('error', error => {
    if (!res.headersSent) {
      res.status(503).render('error', {
        message: error.message,
        active: 'setari'
      });
    } else {
      res.destroy(error);
    }
  });
  request.end();
}
