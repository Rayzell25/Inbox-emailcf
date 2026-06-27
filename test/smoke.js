'use strict';

/**
 * Smoke test: boots the HTTP server (in DEMO mode, no network) on an
 * ephemeral port and exercises the real request flow end-to-end:
 * config, healthz, static index, valid/invalid inbox queries, unknown
 * endpoints, method handling, and ALLOWED_DOMAINS gating.
 *
 * Runs fully offline — safe for CI / sandboxes without internet.
 */

const http = require('http');
const assert = require('assert');
const { createApp } = require('../server');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ok    ${name}`);
}

function baseConfig(overrides) {
  return Object.assign(
    {
      siteName: 'SmokeTest Inbox',
      themeColor: '#8b5cf6',
      apiToken: '',
      accountId: '',
      kvNamespaceId: '',
      hasCloudflareCreds: false,
      demoMode: true,
      allowedDomains: [],
      port: 0,
    },
    overrides || {}
  );
}

function startServer(config) {
  const { handler } = createApp(config);
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function get(port, pathname, method) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: method || 'GET',
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    /* not json */
  }
  return { status: res.status, text, json, headers: res.headers };
}

async function run() {
  const { server, port } = await startServer(baseConfig());

  try {
    // healthz
    let r = await get(port, '/healthz');
    check('GET /healthz -> 200', r.status === 200);
    check('healthz reports demo mode', r.json && r.json.demo === true);

    // config (no secrets leaked)
    r = await get(port, '/api/config');
    check('GET /api/config -> 200', r.status === 200);
    check('config exposes siteName', r.json && r.json.siteName === 'SmokeTest Inbox');
    check('config exposes themeColor', r.json && r.json.themeColor === '#8b5cf6');
    check(
      'config does NOT leak token/account',
      r.json && !('apiToken' in r.json) && !('accountId' in r.json)
    );

    // static index
    r = await get(port, '/');
    check('GET / -> 200', r.status === 200);
    check('index is HTML', /<!DOCTYPE html>/i.test(r.text));
    check('index references app.js', /\/app\.js/.test(r.text));

    // static asset
    r = await get(port, '/styles.css');
    check('GET /styles.css -> 200', r.status === 200);
    check(
      'styles.css served as CSS',
      (r.headers.get('content-type') || '').includes('text/css')
    );

    // valid inbox query (demo)
    r = await get(port, '/api/inbox?email=admin@domainanda.com');
    check('GET /api/inbox (valid) -> 200', r.status === 200);
    check('inbox ok=true', r.json && r.json.ok === true);
    check('inbox demo flagged', r.json && r.json.demo === true);
    check(
      'inbox returns an email with subject',
      r.json && r.json.email && typeof r.json.email.subject === 'string' &&
        r.json.email.subject.length > 0
    );
    check(
      'inbox email addressed to query',
      r.json && r.json.email && r.json.email.to === 'admin@domainanda.com'
    );

    // refresh variety param works
    r = await get(port, '/api/inbox?email=admin@domainanda.com&i=1');
    check('GET /api/inbox with &i= -> 200', r.status === 200 && r.json.ok === true);

    // missing email
    r = await get(port, '/api/inbox');
    check('GET /api/inbox (missing) -> 400', r.status === 400 && r.json.ok === false);

    // invalid email
    r = await get(port, '/api/inbox?email=not-an-email');
    check('GET /api/inbox (invalid) -> 400', r.status === 400 && r.json.ok === false);

    // unknown api endpoint
    r = await get(port, '/api/nope');
    check('GET /api/nope -> 404', r.status === 404);

    // method not allowed
    r = await get(port, '/api/config', 'POST');
    check('POST /api/config -> 405', r.status === 405);

    // path traversal blocked
    r = await get(port, '/../server.js');
    check(
      'path traversal blocked',
      r.status === 403 || r.status === 404 || !/createApp/.test(r.text)
    );
  } finally {
    server.close();
  }

  // Second server: ALLOWED_DOMAINS gating.
  const gated = await startServer(
    baseConfig({ allowedDomains: ['allowed.com'] })
  );
  try {
    let r = await get(gated.port, '/api/inbox?email=user@blocked.com');
    check('blocked domain -> 403', r.status === 403 && r.json.ok === false);

    r = await get(gated.port, '/api/inbox?email=user@allowed.com');
    check('allowed domain -> 200', r.status === 200 && r.json.ok === true);
  } finally {
    gated.server.close();
  }

  console.log(`\nSmoke test passed: ${passed} assertion(s).`);
}

run().catch((err) => {
  console.error('\nSMOKE TEST FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
