/**
 * The contact-form Worker, shared by every PhonicScore site.
 *
 * Sites are static Astro builds served from the ASSETS binding; this adds one
 * dynamic route (POST <endpoint>): honeypot + Turnstile spam checks, a per-IP
 * rate limit, a row in D1 for every submission (kept even when mail fails) and
 * delivery via Resend. Everything else falls through to the static site.
 *
 *   // worker/index.ts in a site
 *   import { createContactWorker } from '@phonicscore/astro-kit/worker/contact.ts';
 *   export default createContactWorker({ paths: ..., defaultTo: ..., defaultFrom: ... });
 *
 * Bindings and secrets (set per site; secrets never go in the repo):
 *   ASSETS               static assets (always present)
 *   DB                   D1 database — apply worker/schema.sql to it
 *   TURNSTILE_SECRET_KEY optional; verification is skipped when unset
 *   RESEND_API_KEY       optional; submissions are stored but not mailed when unset
 *   CONTACT_TO / CONTACT_FROM   override the defaults below
 *
 * Types are kept light so sites build without @cloudflare/workers-types.
 */

export interface ContactEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB?: D1Like;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
}

interface D1Like {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export interface ContactOptions {
  /** The form's POST target. Default: /api/contact */
  endpoint?: string;
  /** Locale values the form may submit; anything else becomes the first one. */
  locales?: string[];
  /** Where to send the visitor back to (with ?error=...) and on success. */
  paths: (locale: string) => { form: string; sent: string };
  /** Recipient when CONTACT_TO is unset. */
  defaultTo: string;
  /** Resend sender when CONTACT_FROM is unset; must be on a verified domain. */
  defaultFrom: string;
  /** SQLite datetime modifier for the rate-limit window. Default: -10 minutes */
  rateWindow?: string;
  /** Submissions allowed per IP within the window. Default: 5 */
  rateMax?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createContactWorker(options: ContactOptions) {
  const endpoint = options.endpoint ?? '/api/contact';
  const locales = options.locales ?? ['en'];
  const rateWindow = options.rateWindow ?? '-10 minutes';
  const rateMax = options.rateMax ?? 5;

  /** 303 (Post/Redirect/Get) to a same-origin path. */
  const seeOther = (path: string) =>
    new Response(null, { status: 303, headers: { Location: path } });

  async function handleContact(request: Request, env: ContactEnv): Promise<Response> {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const get = (k: string) => (form.get(k) ?? '').toString().trim();
    const submitted = get('locale');
    const locale = locales.includes(submitted) ? submitted : locales[0];
    const { form: formPath, sent: sentPath } = options.paths(locale);

    // Honeypot: a filled hidden field means a bot. Pretend success, do nothing.
    if (get('company')) return seeOther(sentPath);

    const firstName = get('firstName');
    const lastName = get('lastName');
    const email = get('email');
    const confirmEmail = get('confirmEmail');
    const message = get('message');

    if (!firstName || !lastName || !email || !confirmEmail || !message || !EMAIL_RE.test(email)) {
      return seeOther(`${formPath}?error=1`);
    }
    if (email !== confirmEmail) return seeOther(`${formPath}?error=mismatch`);

    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const userAgent = request.headers.get('User-Agent') ?? '';

    // Turnstile: verify when a token is present. No token (no JavaScript) falls
    // back to the honeypot + rate limit, so the form works without JS.
    const token = get('cf-turnstile-response');
    if (env.TURNSTILE_SECRET_KEY && token) {
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip);
      if (!ok) return seeOther(`${formPath}?error=1`);
    }

    if (env.DB && ip) {
      try {
        const row = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM contact_submissions WHERE ip = ?1 AND created_at > datetime('now', ?2)`
        )
          .bind(ip, rateWindow)
          .first<{ n: number }>();
        if (row && Number(row.n) >= rateMax) return seeOther(`${formPath}?error=rate`);
      } catch (e) {
        console.error('rate-limit check failed', e);
      }
    }

    // Never drop a submission silently: with neither storage nor mail, fail
    // loudly so the misconfiguration is visible instead of faking success.
    if (!env.DB && !env.RESEND_API_KEY) {
      console.error('contact form not configured: no DB and no RESEND_API_KEY');
      return new Response('Contact form is not configured yet.', { status: 503 });
    }

    // Mail first (best effort), then always record the submission with the
    // outcome, so D1 keeps the message even if Resend fails.
    let mailSent = false;
    if (env.RESEND_API_KEY) {
      try {
        mailSent = await sendEmail(env, { firstName, lastName, email, message, locale });
      } catch (e) {
        console.error('resend send failed', e);
      }
    }

    if (env.DB) {
      try {
        await env.DB.prepare(
          `INSERT INTO contact_submissions
            (locale, first_name, last_name, email, message, ip, user_agent, mail_sent)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        )
          .bind(locale, firstName, lastName, email, message, ip, userAgent, mailSent ? 1 : 0)
          .run();
      } catch (e) {
        console.error('D1 insert failed', e);
        if (!mailSent) {
          return new Response('Could not process your message. Please email us directly.', {
            status: 500,
          });
        }
      }
    }

    return seeOther(sentPath);
  }

  async function sendEmail(
    env: ContactEnv,
    m: { firstName: string; lastName: string; email: string; message: string; locale: string }
  ): Promise<boolean> {
    const to = env.CONTACT_TO || options.defaultTo;
    const from = env.CONTACT_FROM || options.defaultFrom;
    const name = `${m.firstName} ${m.lastName}`.trim();
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const text =
      `New contact form submission (${m.locale}).\n\n` +
      `Name: ${name}\nEmail: ${m.email}\n\nMessage:\n${m.message}\n`;
    const html =
      `<p>New contact form submission (${m.locale}).</p>` +
      `<p><strong>Name:</strong> ${esc(name)}<br>` +
      `<strong>Email:</strong> ${esc(m.email)}</p>` +
      `<p><strong>Message:</strong></p><p>${esc(m.message).replace(/\n/g, '<br>')}</p>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: m.email,
        subject: `Contact form: ${name}`,
        text,
        html,
      }),
    });
    if (!res.ok) {
      console.error('resend responded', res.status, await res.text());
      return false;
    }
    return true;
  }

  return {
    async fetch(request: Request, env: ContactEnv): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === endpoint) {
        if (request.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
        }
        return handleContact(request, env);
      }
      // Everything else is the static site (honours not_found_handling).
      return env.ASSETS.fetch(request);
    },
  };
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error('turnstile verify failed', e);
    return false;
  }
}
