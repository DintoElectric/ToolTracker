// netlify/functions/notify.mjs
// Notification sender for reminders. Channel is chosen by what's configured:
//   • SMS via Twilio      — if TWILIO_* env vars are set and the recipient
//                           has a phone (best for field crews)
//   • Email via Resend    — else if RESEND_API_KEY is set and they have email
//   • Log only            — else: writes what WOULD send to the function log,
//                           so the scheduled job is safe to deploy first.
//
// Override the auto choice with REMINDER_CHANNEL = "sms" | "email" | "log".
//
// Env vars (set in Netlify → Site configuration → Environment variables):
//   RESEND_API_KEY     Resend API key
//   REMINDER_FROM      verified sender, e.g. "Dinto Tools <tools@dintoelectric.com>"
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM        an SMS-capable Twilio number, e.g. "+12035551234"
//   REMINDER_CHANNEL   (optional) force a channel

const env = (k) => process.env[k] || '';

function chooseChannel(recipient) {
  const forced = env('REMINDER_CHANNEL').toLowerCase();
  if (forced === 'sms' || forced === 'email' || forced === 'log') return forced;

  const smsReady = env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM');
  const emailReady = env('RESEND_API_KEY') && env('REMINDER_FROM');

  if (smsReady && recipient.phone) return 'sms';
  if (emailReady && recipient.email) return 'email';
  return 'log';
}

/* ── channel senders ─────────────────────────────────────────────── */

async function sendEmail(recipient, { subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('RESEND_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env('REMINDER_FROM'),
      to: [recipient.email],
      subject,
      text,
      html: html || undefined,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
  }
  return { channel: 'email', to: recipient.email };
}

async function sendSms(recipient, { text }) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const auth = Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64');
  const body = new URLSearchParams({ To: recipient.phone, From: env('TWILIO_FROM'), Body: text });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Twilio ${res.status}: ${detail.slice(0, 300)}`);
  }
  return { channel: 'sms', to: recipient.phone };
}

/* ── public entry ────────────────────────────────────────────────── */

// recipient: { name, email?, phone? }
// message:   { subject, text, html? }
export async function deliver(recipient, message) {
  const channel = chooseChannel(recipient);

  if (channel === 'log') {
    // Safe no-op: shows in the function log exactly what would have been sent.
    console.log('[reminder:log-only]', JSON.stringify({
      to: recipient.name, email: recipient.email || null, phone: recipient.phone || null,
      subject: message.subject, text: message.text,
    }));
    return { channel: 'log', to: recipient.name };
  }

  if (channel === 'sms') return sendSms(recipient, message);
  return sendEmail(recipient, message);
}

// True when at least one real channel is wired up. Lets the scheduler note in
// its log whether it's actually sending or just dry-running.
export function anyChannelConfigured() {
  const smsReady = env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM');
  const emailReady = env('RESEND_API_KEY') && env('REMINDER_FROM');
  return { smsReady: !!smsReady, emailReady: !!emailReady };
}
