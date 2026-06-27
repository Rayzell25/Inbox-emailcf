'use strict';

/**
 * Demo email generator. Used when DEMO_MODE is active (no Cloudflare
 * credentials configured) so the UI, animations and transitions can be
 * exercised without a live backend. Also used by the smoke test, which
 * runs in an offline sandbox.
 */

const SAMPLES = [
  {
    fromName: 'Cloudflare',
    from: 'noreply@notify.cloudflare.com',
    subject: 'Email Routing aktif untuk domain Anda',
    text:
      'Halo,\n\nEmail Routing untuk domain kustom Anda kini aktif. ' +
      'Pesan yang masuk akan ditangkap oleh Email Worker dan disimpan ' +
      'sehingga dapat ditampilkan di sini.\n\nSalam,\nTim Cloudflare',
    html:
      '<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#1f2937;line-height:1.6">' +
      '<h2 style="margin:0 0 12px">Email Routing aktif \u2705</h2>' +
      '<p>Halo,</p>' +
      '<p>Email Routing untuk domain kustom Anda kini <strong>aktif</strong>. ' +
      'Pesan yang masuk akan ditangkap oleh <em>Email Worker</em> dan disimpan ' +
      'sehingga dapat ditampilkan di sini.</p>' +
      '<p style="color:#6b7280;font-size:13px">Ini adalah email contoh (mode demo).</p>' +
      '<p>Salam,<br/>Tim Cloudflare</p></div>',
  },
  {
    fromName: 'GitHub',
    from: 'noreply@github.com',
    subject: '[GitHub] A new sign-in to your account',
    text:
      'We noticed a new sign-in to your GitHub account. ' +
      'If this was you, you can safely ignore this email.',
    html:
      '<div style="font-family:system-ui,sans-serif;color:#1f2937;line-height:1.6">' +
      '<h2 style="margin:0 0 12px">New sign-in detected</h2>' +
      '<p>We noticed a new sign-in to your GitHub account.</p>' +
      '<p>If this was you, you can safely ignore this email.</p>' +
      '<p style="color:#6b7280;font-size:13px">Demo message.</p></div>',
  },
  {
    fromName: 'Stripe',
    from: 'receipts@stripe.com',
    subject: 'Your receipt from Acme Inc. #1042-5567',
    text: 'Thanks for your payment. Amount: $29.00. This is a demo receipt.',
    html:
      '<div style="font-family:system-ui,sans-serif;color:#1f2937;line-height:1.6">' +
      '<h2 style="margin:0 0 12px">Payment receipt</h2>' +
      '<p>Thanks for your payment.</p>' +
      '<p><strong>Amount:</strong> $29.00</p>' +
      '<p style="color:#6b7280;font-size:13px">Demo receipt.</p></div>',
  },
];

/**
 * Return a demo email object for the given recipient.
 * @param {string} email
 * @param {number} [index] choose a specific sample (used for refresh variety)
 */
function getDemoEmail(email, index) {
  const i =
    typeof index === 'number'
      ? ((index % SAMPLES.length) + SAMPLES.length) % SAMPLES.length
      : Math.floor(Math.random() * SAMPLES.length);
  const sample = SAMPLES[i];
  return {
    to: email,
    fromName: sample.fromName,
    from: sample.from,
    subject: sample.subject,
    text: sample.text,
    html: sample.html,
    date: new Date().toISOString(),
    demo: true,
  };
}

module.exports = { getDemoEmail, SAMPLES };
