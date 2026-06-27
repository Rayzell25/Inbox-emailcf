'use strict';

/**
 * Minimal Cloudflare Workers KV REST client (read-only) using the global
 * fetch available in Node 18+. No third-party dependencies.
 *
 * Email messages are written into KV by the Email Worker (see worker/).
 * Layout written by the worker:
 *   - key `latest:<recipient>`            -> JSON of the most recent email
 *   - key `inbox:<recipient>:<epoch_ms>`  -> JSON of each email (history)
 *
 * We read `latest:<recipient>` first (fast path); if missing we fall back
 * to listing the `inbox:<recipient>:` prefix and picking the newest key.
 */

const API_BASE = 'https://api.cloudflare.com/client/v4';
const DEFAULT_TIMEOUT_MS = 12000;

class CloudflareError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status || 0;
  }
}

function kvKeyForLatest(email) {
  return `latest:${String(email).trim().toLowerCase()}`;
}

function kvPrefixForInbox(email) {
  return `inbox:${String(email).trim().toLowerCase()}:`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs || DEFAULT_TIMEOUT_MS
  );
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{apiToken:string, accountId:string, kvNamespaceId:string}} config
 */
function createCloudflareClient(config) {
  const { apiToken, accountId, kvNamespaceId } = config;
  const authHeaders = { Authorization: `Bearer ${apiToken}` };
  const nsBase = `${API_BASE}/accounts/${encodeURIComponent(
    accountId
  )}/storage/kv/namespaces/${encodeURIComponent(kvNamespaceId)}`;

  /**
   * GET the raw string value for a KV key. Returns null on 404.
   */
  async function getValue(key) {
    const url = `${nsBase}/values/${encodeURIComponent(key)}`;
    const res = await fetchWithTimeout(url, { headers: authHeaders });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await safeReadError(res);
      throw new CloudflareError(
        `KV read failed (HTTP ${res.status})${body ? ': ' + body : ''}`,
        res.status
      );
    }
    return await res.text();
  }

  /**
   * List up to `limit` keys matching a prefix. Returns array of key names.
   */
  async function listKeys(prefix, limit) {
    const url =
      `${nsBase}/keys?prefix=${encodeURIComponent(prefix)}` +
      `&limit=${Math.min(Math.max(limit || 100, 1), 1000)}`;
    const res = await fetchWithTimeout(url, { headers: authHeaders });
    if (!res.ok) {
      const body = await safeReadError(res);
      throw new CloudflareError(
        `KV list failed (HTTP ${res.status})${body ? ': ' + body : ''}`,
        res.status
      );
    }
    const json = await res.json();
    if (!json || json.success !== true || !Array.isArray(json.result)) {
      throw new CloudflareError('Unexpected KV list response', res.status);
    }
    return json.result.map((k) => k.name);
  }

  /**
   * Fetch the latest stored email for a recipient, or null if none.
   * @param {string} email
   * @returns {Promise<object|null>}
   */
  async function getLatestEmail(email) {
    // Fast path: dedicated "latest" pointer maintained by the worker.
    const direct = await getValue(kvKeyForLatest(email));
    if (direct) {
      const parsed = tryParse(direct);
      if (parsed) return normalizeEmail(parsed, email);
    }

    // Fallback: scan history keys and pick the newest by trailing epoch.
    const prefix = kvPrefixForInbox(email);
    const keys = await listKeys(prefix, 1000);
    if (keys.length === 0) return null;

    keys.sort((a, b) => epochFromKey(b) - epochFromKey(a));
    const newest = keys[0];
    const value = await getValue(newest);
    if (!value) return null;
    const parsed = tryParse(value);
    return parsed ? normalizeEmail(parsed, email) : null;
  }

  /** Lightweight connectivity/permission check against the namespace. */
  async function verify() {
    await listKeys('', 1);
    return true;
  }

  return { getValue, listKeys, getLatestEmail, verify };
}

function epochFromKey(key) {
  const idx = key.lastIndexOf(':');
  const n = Number.parseInt(key.slice(idx + 1), 10);
  return Number.isFinite(n) ? n : 0;
}

function tryParse(str) {
  try {
    return JSON.parse(str);
  } catch (_e) {
    return null;
  }
}

async function safeReadError(res) {
  try {
    const data = await res.json();
    if (data && Array.isArray(data.errors) && data.errors.length) {
      return data.errors
        .map((e) => `${e.code ? e.code + ' ' : ''}${e.message || ''}`.trim())
        .join('; ');
    }
  } catch (_e) {
    /* ignore */
  }
  return '';
}

/**
 * Coerce a stored record into the canonical email shape the frontend
 * expects, tolerating partial/legacy payloads.
 */
function normalizeEmail(raw, email) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  return {
    to: obj.to || email,
    fromName: str(obj.fromName) || str(obj.from_name) || '',
    from: str(obj.from) || str(obj.sender) || '',
    subject: str(obj.subject) || '(tanpa subjek)',
    text: str(obj.text) || str(obj.body) || '',
    html: str(obj.html) || '',
    date: str(obj.date) || str(obj.receivedAt) || new Date().toISOString(),
    demo: false,
  };
}

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

module.exports = {
  createCloudflareClient,
  CloudflareError,
  normalizeEmail,
  kvKeyForLatest,
  kvPrefixForInbox,
};
