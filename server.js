'use strict';

/**
 * Cloudflare Single Email Viewer — HTTP server.
 *
 * Zero runtime dependencies (Node 18+ built-ins only). Serves the static
 * frontend from ./public and exposes a small JSON API:
 *
 *   GET /api/config           -> public branding (site name, theme color)
 *   GET /api/inbox?email=...   -> the single latest email for that address
 *   GET /healthz              -> liveness probe
 *
 * The Cloudflare API token is used ONLY here on the server; it is never
 * sent to the browser.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { getConfig } = require('./lib/env');
const { getDemoEmail } = require('./lib/demo');
const { createCloudflareClient, CloudflareError } = require('./lib/cloudflare');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Permissive but reasonable email validation (RFC-lite).
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function isPathSafe(resolved) {
  return resolved === PUBLIC_DIR || resolved.startsWith(PUBLIC_DIR + path.sep);
}

/**
 * Serve a static file from PUBLIC_DIR. Returns true if handled.
 */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const resolved = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!isPathSafe(resolved)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }

  fs.stat(resolved, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA-ish fallback to index.html for unknown non-API GET routes.
      if (!path.extname(resolved)) {
        return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
      }
      return sendJson(res, 404, { error: 'Not found' });
    }
    serveFile(res, resolved);
  });
  return true;
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('open', () => {
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
  });
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { error: 'Read error' });
    else res.end();
  });
  stream.pipe(res);
}

/**
 * Build the request handler bound to a config + (optional) CF client.
 */
function createApp(config) {
  const cfClient =
    config.hasCloudflareCreds && !config.demoMode
      ? createCloudflareClient(config)
      : null;

  async function handleInbox(req, res, url) {
    const emailRaw = (url.searchParams.get('email') || '').trim();
    const email = emailRaw.toLowerCase();
    const refreshIndex = Number.parseInt(
      url.searchParams.get('i') || '',
      10
    );

    if (!email) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Parameter "email" wajib diisi.',
      });
    }
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Format alamat email tidak valid.',
      });
    }

    const domain = email.slice(email.indexOf('@') + 1);
    if (
      config.allowedDomains.length > 0 &&
      !config.allowedDomains.includes(domain)
    ) {
      return sendJson(res, 403, {
        ok: false,
        error: 'Domain ini tidak diizinkan pada server ini.',
      });
    }

    // Demo mode: synthesize an email so the UI works without Cloudflare.
    if (config.demoMode || !cfClient) {
      const idx = Number.isFinite(refreshIndex) ? refreshIndex : undefined;
      return sendJson(res, 200, {
        ok: true,
        demo: true,
        email: getDemoEmail(email, idx),
      });
    }

    try {
      const message = await cfClient.getLatestEmail(email);
      if (!message) {
        return sendJson(res, 200, {
          ok: true,
          demo: false,
          email: null,
          message: 'No new messages',
        });
      }
      return sendJson(res, 200, { ok: true, demo: false, email: message });
    } catch (err) {
      const status = err instanceof CloudflareError ? err.status : 0;
      // Map common Cloudflare auth/permission problems to clear messages.
      let friendly = 'Gagal mengambil email dari Cloudflare.';
      if (status === 401 || status === 403) {
        friendly =
          'Cloudflare menolak permintaan (cek API Token harus punya izin ' +
          'Workers KV Storage: Read, serta Account ID & Namespace ID benar).';
      } else if (status === 404) {
        friendly =
          'KV namespace tidak ditemukan (cek CLOUDFLARE_KV_NAMESPACE_ID).';
      }
      // eslint-disable-next-line no-console
      console.error('[inbox] error:', err && err.message ? err.message : err);
      return sendJson(res, 502, { ok: false, error: friendly });
    }
  }

  const handler = (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (_e) {
      return sendJson(res, 400, { error: 'Bad request' });
    }
    const { pathname } = url;

    // Only GET/HEAD are supported.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }

    if (pathname === '/healthz') {
      return sendJson(res, 200, { ok: true, demo: config.demoMode });
    }

    if (pathname === '/api/config') {
      return sendJson(res, 200, {
        siteName: config.siteName,
        themeColor: config.themeColor,
        demo: config.demoMode,
      });
    }

    if (pathname === '/api/inbox') {
      handleInbox(req, res, url).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[inbox] unhandled:', err);
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: 'Internal server error' });
        }
      });
      return;
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: 'Unknown endpoint' });
    }

    return serveStatic(req, res, pathname);
  };

  return { handler, cfClient };
}

function start() {
  const config = getConfig();
  const { handler } = createApp(config);
  const server = http.createServer(handler);

  server.listen(config.port, () => {
    const mode = config.demoMode ? 'DEMO (no Cloudflare calls)' : 'LIVE';
    // eslint-disable-next-line no-console
    console.log(
      `\n  ${config.siteName} \u2014 server ready\n` +
        `  > http://localhost:${config.port}\n` +
        `  > mode: ${mode}\n`
    );
  });

  const shutdown = (signal) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start, EMAIL_RE };
