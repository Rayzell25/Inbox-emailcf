/**
 * Cloudflare Email Worker — capture incoming mail into KV.
 *
 * Deploy this with Wrangler (see worker/README section in the main README).
 * It is triggered by Cloudflare Email Routing for your custom domain, parses
 * each incoming message, and stores it in a KV namespace so the web app can
 * display the single latest message per recipient.
 *
 * KV layout written here (read by the VPS app):
 *   - latest:<recipient>            -> JSON of most recent email (fast path)
 *   - inbox:<recipient>:<epoch_ms>  -> JSON of each email (history, TTL'd)
 *
 * Bindings expected (wrangler.toml):
 *   - KV namespace binding:  INBOX_KV
 * Optional vars:
 *   - FORWARD_TO     : if set, also forward the raw email to this address
 *   - HISTORY_TTL    : seconds to keep history keys (default 1209600 = 14d)
 */

import PostalMime from 'postal-mime';

export default {
  /**
   * @param {ForwardableEmailMessage} message
   * @param {{INBOX_KV: KVNamespace, FORWARD_TO?: string, HISTORY_TTL?: string}} env
   * @param {ExecutionContext} ctx
   */
  async email(message, env, ctx) {
    const recipient = String(message.to || '').trim().toLowerCase();

    try {
      const parsed = await PostalMime.parse(message.raw);

      const fromAddr =
        (parsed.from && parsed.from.address) ||
        message.from ||
        '';
      const fromName = (parsed.from && parsed.from.name) || '';

      const record = {
        to: recipient,
        from: String(fromAddr).toLowerCase(),
        fromName: fromName,
        subject: parsed.subject || '(tanpa subjek)',
        text: parsed.text || '',
        html: parsed.html || '',
        date: normalizeDate(parsed.date),
        messageId: parsed.messageId || message.headers.get('message-id') || '',
        receivedAt: new Date().toISOString(),
      };

      const value = JSON.stringify(record);
      const ttl = clampTtl(env.HISTORY_TTL);

      if (env.INBOX_KV && recipient) {
        // Fast-path pointer (no expiry) + history entry (TTL'd).
        await Promise.all([
          env.INBOX_KV.put(`latest:${recipient}`, value),
          env.INBOX_KV.put(`inbox:${recipient}:${Date.now()}`, value, {
            expirationTtl: ttl,
          }),
        ]);
      }
    } catch (err) {
      // Never block delivery because of a storage/parse error.
      console.error('email-worker store failed:', err && err.message);
    }

    // Optionally forward the original message so normal delivery continues.
    if (env.FORWARD_TO) {
      try {
        await message.forward(env.FORWARD_TO);
      } catch (err) {
        console.error('forward failed:', err && err.message);
      }
    }
  },
};

function normalizeDate(d) {
  if (!d) return new Date().toISOString();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function clampTtl(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1209600; // 14 days
  // KV requires expirationTtl >= 60.
  return Math.max(60, n);
}
