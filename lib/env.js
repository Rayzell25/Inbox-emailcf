'use strict';

/**
 * Zero-dependency .env loader + typed config.
 *
 * Reads KEY=VALUE pairs from a .env file (if present) WITHOUT overriding
 * variables that are already set in process.env. This means real
 * environment variables (e.g. injected by Docker / systemd) always win,
 * while the .env file is a convenient fallback for VPS `nano` editing.
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse the textual content of a .env file into a plain object.
 * Supports:
 *   - `KEY=value`
 *   - quoted values:  KEY="value"  or  KEY='value'
 *   - inline comments are NOT stripped from quoted values
 *   - blank lines and lines starting with `#`
 *   - optional leading `export `
 * @param {string} content
 * @returns {Record<string,string>}
 */
function parseEnv(content) {
  const out = {};
  if (typeof content !== 'string') return out;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    let working = line;
    if (working.startsWith('export ')) working = working.slice(7).trim();

    const eq = working.indexOf('=');
    if (eq === -1) continue;

    const key = working.slice(0, eq).trim();
    if (!key) continue;

    let value = working.slice(eq + 1).trim();

    // Quoted value -> take everything up to the matching closing quote.
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'")) {
      const quote = value[0];
      const closing = value.indexOf(quote, 1);
      if (closing !== -1) {
        value = value.slice(1, closing);
      } else {
        // No closing quote: drop the leading quote, keep the rest.
        value = value.slice(1);
      }
    } else {
      // Unquoted: strip trailing inline comment ("  # ...").
      const hashIdx = value.indexOf(' #');
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }

    out[key] = value;
  }
  return out;
}

/**
 * Load the .env file from disk (best effort) into process.env without
 * overriding existing keys.
 * @param {string} [envPath]
 */
function loadEnvFile(envPath) {
  const file = envPath || path.join(process.cwd(), '.env');
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (_err) {
    return {}; // No .env file is fine.
  }
  const parsed = parseEnv(content);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return parsed;
}

function truthy(value) {
  if (value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function falsy(value) {
  return /^(0|false|no|off)$/i.test(String(value || '').trim());
}

/**
 * Build the typed runtime configuration object.
 * @param {string} [envPath]
 */
function getConfig(envPath) {
  loadEnvFile(envPath);

  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const kvNamespaceId = (process.env.CLOUDFLARE_KV_NAMESPACE_ID || '').trim();

  // Placeholder values from .env.example must NOT be treated as real creds.
  const isPlaceholder = (v) => !v || /^masukkan_/i.test(v);
  const hasCloudflareCreds =
    !isPlaceholder(apiToken) &&
    !isPlaceholder(accountId) &&
    !isPlaceholder(kvNamespaceId);

  // Demo mode: explicit override, otherwise auto-on when creds are missing.
  let demoMode;
  if (truthy(process.env.DEMO_MODE)) demoMode = true;
  else if (falsy(process.env.DEMO_MODE)) demoMode = false;
  else demoMode = !hasCloudflareCreds;

  const allowedDomains = (process.env.ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const port = Number.parseInt(process.env.PORT, 10);

  return {
    siteName: (process.env.NEXT_PUBLIC_SITE_NAME || 'Inbox Viewer').trim(),
    themeColor: normalizeHex(process.env.NEXT_PUBLIC_THEME_COLOR) || '#8b5cf6',
    apiToken,
    accountId,
    kvNamespaceId,
    hasCloudflareCreds,
    demoMode,
    allowedDomains,
    port: Number.isFinite(port) && port > 0 ? port : 3000,
  };
}

/**
 * Validate a hex colour like #abc or #aabbcc. Returns normalized #rrggbb
 * string or null if invalid.
 * @param {string|undefined} value
 */
function normalizeHex(value) {
  if (!value) return null;
  const v = String(value).trim();
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return '#' + hex.toLowerCase();
}

module.exports = { parseEnv, loadEnvFile, getConfig, normalizeHex, truthy };
