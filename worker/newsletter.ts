/**
 * The newsletter sign-up, shared by every PhonicScore site whose newsletter
 * Tarvent sends. It started on opensheetmusiceducation.org (2026-11-17) and
 * moved here so that every site has the same one (Thomas, 2026-11-26).
 *
 *   POST /api/newsletter   the footer form (components/NewsletterForm.astro):
 *                          one email address, the page's language, and a
 *                          honeypot field that people don't see
 *   newsletterCron()       for the site's hourly Cron Trigger: addresses that
 *                          signed up 24 to 25 hours ago and still haven't
 *                          confirmed get Tarvent's confirm mail once more
 *                          (doiReminder), and addresses still unconfirmed
 *                          after 30 days are deleted (deleteUnconfirmed)
 *
 * The Worker adds the address to the site's audience in Tarvent, with the
 * page's language and the visitor's IPv4 address. The audience requires
 * double opt-in, so Tarvent mails a confirm link, and the address gets no
 * newsletter until it is clicked. The confirm mail's text and sender, and the
 * page its link leads to, are set in Tarvent, not here.
 *
 * Answers are JSON for the form's script: {"ok":true}, or {"ok":false} with
 * an `error`: "invalid" (no usable address), "rate" (too many sign-ups from
 * this address), "failed" (Tarvent or the setup), "origin" (posted from
 * another site), "method". An address that is already in the audience gets
 * the same {"ok":true} as a new one, so the form never tells whether someone
 * is subscribed. A filled honeypot gets {"ok":true} and nothing happens.
 *
 *   // worker/newsletter.ts in a site
 *   import { createNewsletter } from '@phonicscore/astro-kit/worker/newsletter.ts';
 *   import { locales } from '../src/i18n/locales';
 *   export const { isNewsletterPath, newsletter, newsletterCron } = createNewsletter({ locales });
 *
 *   // worker/index.ts
 *   if (isNewsletterPath(url.pathname)) return newsletter(request, env);
 *   // and in scheduled():
 *   ctx.waitUntil(newsletterCron(controller.scheduledTime, env));
 *
 * What the site's Worker needs (wrangler.jsonc; secrets never go in the repo):
 *   TARVENT_API_KEY       secret: a key for the site's audience only, with the
 *                         rights to view the audience, to create, read, update
 *                         and delete contacts, and to create and view tags
 *   TARVENT_ACCOUNT_ID    var: the Tarvent account
 *   TARVENT_AUDIENCE_ID   var: the site's audience
 *   NEWSLETTER_LIMIT      optional rate-limit binding: sign-ups per visitor
 *                         address (IPv4, or the /64 of an IPv6 address)
 *   DOI_REMINDER_DRY_RUN  optional, "1" in .dev.vars: the cron logs whom it
 *                         would remind or delete and changes nothing
 * plus an hourly Cron Trigger (any minute) and Workers Logs, where every run
 * writes one `doi-reminder:` line and one `doi-cleanup:` line. No line ever
 * holds an email address.
 *
 * Types are kept light so sites build without @cloudflare/workers-types.
 * test/newsletter.test.mjs holds all of the above to account, with fetch
 * replaced, so nothing reaches Tarvent.
 */
import { BASELINE_SECURITY_HEADERS } from './analytics.ts';

/** A Cloudflare rate-limit binding (wrangler.jsonc `ratelimits`). */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface NewsletterEnv {
  TARVENT_API_KEY?: string;
  TARVENT_ACCOUNT_ID?: string;
  TARVENT_AUDIENCE_ID?: string;
  NEWSLETTER_LIMIT?: RateLimit;
  /** "1": the reminder logs whom it would remind and sends nothing (local tests). */
  DOI_REMINDER_DRY_RUN?: string;
}

export interface NewsletterOptions {
  /** The site's languages, as the form sends them; anything else is taken as the first. */
  locales: readonly string[];
  /** The form's POST target. Default: /api/newsletter */
  endpoint?: string;
  /** Hours from a sign-up to its one reminder. Default: 24 */
  remindAfterHours?: number;
  /** Days after which a sign-up that is still unconfirmed is deleted; 0 keeps them. Default: 30 */
  deleteUnconfirmedAfterDays?: number;
  /** The tag a reminded contact gets in Tarvent. Default: "confirm reminder sent" */
  reminderTag?: string;
  /**
   * Headers set on every answer (values already there are replaced). Default:
   * the kit's baseline security headers, as the Usermaven proxy uses them.
   */
  headers?: Record<string, string>;
}

export interface Newsletter {
  /** True for the form's POST target only. */
  isNewsletterPath(pathname: string): boolean;
  /** The answer to the form. */
  newsletter(request: Request, env: NewsletterEnv): Promise<Response>;
  /** The hourly run: doiReminder, then deleteUnconfirmed. Never throws: it logs. */
  newsletterCron(scheduledTime: number, env: NewsletterEnv): Promise<void>;
  /** One reminder run, for the Cron Trigger's scheduledTime. Never throws: it logs. */
  doiReminder(scheduledTime: number, env: NewsletterEnv): Promise<void>;
  /** Deletes the sign-ups still unconfirmed after `deleteUnconfirmedAfterDays`. Never throws: it logs. */
  deleteUnconfirmed(scheduledTime: number, env: NewsletterEnv): Promise<void>;
}

export const TARVENT_GRAPHQL = 'https://api.tarvent.com/graphql';
export const DEFAULT_REMINDER_TAG = 'confirm reminder sent';
/** The largest body the form may send, in bytes; one address and two short fields fit many times. */
export const MAX_SIGNUP_BODY = 16 * 1024;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PAGE = 50;
// Reading stops after 1,000 sign-ups in the window's 25 hours.
const MAX_PAGES = 20;
/**
 * Deletions per run: one request each, so a run stays far below a Worker's
 * subrequest limit (50 on the free plan). The next hour goes on where it stopped.
 */
export const MAX_DELETIONS_PER_RUN = 25;
// Loose on purpose: the browser's type="email" check runs first, Tarvent checks again.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** An address in a log line becomes this, so Workers Logs never keep one. */
export const redact = (text: string): string => text.replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+/g, '<address>');

/** The key a sign-up counts against: the IPv4 address, or the first 64 bits of an IPv6 one. */
export function limitKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** The sign-ups one run reminds: the full hour `remindAfterHours` before the run's own hour. */
export function reminderWindow(scheduledTime: number, remindAfterHours = 24): { from: number; to: number } {
  // The full hour this run stands for: consecutive runs cover consecutive windows,
  // even when one starts a little late.
  const hour = Math.floor(scheduledTime / HOUR) * HOUR;
  const to = hour - remindAfterHours * HOUR;
  return { from: to - HOUR, to };
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z';

interface Contact {
  id: string;
  status: string;
  createdUtc: string;
}

interface Connection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Contact[];
}

const CREATE = 'mutation($i:CreateContactInput!){ createContact(input:$i){ id } }';
const CONTACTS = `query($i:GetAllContactsInput!, $after:String){
  contacts(input:$i, first:${PAGE}, after:$after, order:[{createdUtc:DESC}]){
    pageInfo{ hasNextPage endCursor } nodes{ id status createdUtc } } }`;
const RESEND = `mutation($i:ResendDoiEmailInput!){
  resendDoiEmail(input:$i){ contactCount sendCount failCount } }`;
const ADD_TAG = 'mutation($i:AddTagInput!){ addContactTag(input:$i) }';
// Only the stale unconfirmed ones, oldest first: Tarvent filters, and each contact is checked again here.
const STALE = `query($i:GetAllContactsInput!){
  contacts(input:$i, first:${PAGE}, order:[{createdUtc:ASC}]){ nodes{ id status createdUtc } } }`;
// One contact per call: an id-less bulk delete would act on the whole audience.
const DELETE = 'mutation($i:DeleteContactInput!){ deleteContact(input:$i) }';

const configured = (env: NewsletterEnv) =>
  Boolean(env.TARVENT_API_KEY && env.TARVENT_ACCOUNT_ID && env.TARVENT_AUDIENCE_ID);

/** One GraphQL call; the answer's `data`, or an Error with Tarvent's messages. */
async function tarvent<T>(env: NewsletterEnv, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(TARVENT_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': env.TARVENT_API_KEY as string,
      // Tarvent's account header has no X- prefix.
      Account: env.TARVENT_ACCOUNT_ID as string,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] };
  if (!res.ok || body.errors?.length || !body.data) {
    throw new Error(body.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`);
  }
  return body.data;
}

/** The form's fields, from multipart, urlencoded or JSON; null when unreadable. */
async function readFields(request: Request): Promise<Record<string, string> | null> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_SIGNUP_BODY) return null;
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return null;
  }
  // Whatever the header said: a longer body is refused by what was read.
  if (bytes.byteLength > MAX_SIGNUP_BODY) return null;
  const type = request.headers.get('Content-Type') ?? '';
  try {
    if (type.includes('application/json')) {
      const data = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
    }
    const form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch {
    return null;
  }
}

export function createNewsletter(options: NewsletterOptions): Newsletter {
  const locales = options?.locales;
  if (!Array.isArray(locales) || locales.length === 0 || locales.some((l) => typeof l !== 'string' || !l)) {
    throw new Error('createNewsletter: pass the site\'s languages as `locales`');
  }
  const endpoint = options.endpoint ?? '/api/newsletter';
  const remindAfterHours = options.remindAfterHours ?? 24;
  const deleteAfterDays = options.deleteUnconfirmedAfterDays ?? 30;
  if (!(deleteAfterDays === 0 || deleteAfterDays * 24 > remindAfterHours + 1)) {
    throw new Error('createNewsletter: deleteUnconfirmedAfterDays must be 0 or come after the reminder');
  }
  const reminderTag = options.reminderTag ?? DEFAULT_REMINDER_TAG;
  const extra = options.headers ?? BASELINE_SECURITY_HEADERS;

  function answer(body: Record<string, unknown>, status = 200, more: Record<string, string> = {}): Response {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...more });
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    return new Response(JSON.stringify(body), { status, headers });
  }

  async function createContact(env: NewsletterEnv, input: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
    try {
      await tarvent(env, CREATE, { i: input });
      return { ok: true, message: '' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async function newsletter(request: Request, env: NewsletterEnv): Promise<Response> {
    if (request.method !== 'POST') return answer({ ok: false, error: 'method' }, 405, { Allow: 'POST' });
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return answer({ ok: false, error: 'origin' }, 403);

    const form = await readFields(request);
    if (!form) return answer({ ok: false, error: 'invalid' }, 400);
    // A field people don't see: bots that fill every field get a quiet "ok".
    if (form.website) return answer({ ok: true });

    const email = (form.email ?? '').trim();
    if (email.length > 320 || !EMAIL.test(email)) return answer({ ok: false, error: 'invalid' }, 400);
    if (!configured(env)) {
      console.error('newsletter: TARVENT_API_KEY or the Tarvent ids missing');
      return answer({ ok: false, error: 'failed' }, 503);
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    if (env.NEWSLETTER_LIMIT && ip) {
      const { success } = await env.NEWSLETTER_LIMIT.limit({ key: limitKey(ip) });
      if (!success) return answer({ ok: false, error: 'rate' }, 429);
    }

    const lang = locales.includes(form.lang ?? '') ? form.lang : locales[0];
    const input: Record<string, unknown> = {
      audienceId: env.TARVENT_AUDIENCE_ID,
      email,
      language: lang,
      // Tarvent's IP fields take IPv4 only.
      ...(IPV4.test(ip) ? { optInIp: ip } : {}),
    };

    let result = await createContact(env, input);
    // An address that is already there: the same answer as a new one (see the top of this file).
    if (!result.ok && /exist|duplicate|already/i.test(result.message)) return answer({ ok: true });
    // If Tarvent ever refuses a language code, sign the address up without it.
    if (!result.ok && /language|culture/i.test(result.message)) {
      delete input.language;
      result = await createContact(env, input);
      if (!result.ok && /exist|duplicate|already/i.test(result.message)) return answer({ ok: true });
    }
    if (!result.ok) {
      console.error('newsletter: createContact failed:', redact(result.message));
      return answer({ ok: false, error: 'failed' }, 502);
    }
    return answer({ ok: true });
  }

  /** Ids of the contacts created in [from, to) that are still waiting for the confirm click. */
  async function pendingSignups(env: NewsletterEnv, from: number, to: number): Promise<string[]> {
    const ids: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { contacts }: { contacts: Connection } = await tarvent<{ contacts: Connection }>(env, CONTACTS, {
        i: { audienceId: env.TARVENT_AUDIENCE_ID },
        after,
      });
      // Newest first, so the first contact older than the window ends the search.
      for (const c of contacts.nodes) {
        const created = Date.parse(c.createdUtc);
        if (created < from) return ids;
        if (created < to && c.status === 'PENDING_CONFIRM') ids.push(c.id);
      }
      if (!contacts.pageInfo.hasNextPage) return ids;
      after = contacts.pageInfo.endCursor;
    }
    console.error(`doi-reminder: more than ${PAGE * MAX_PAGES} sign-ups to read, stopped`);
    return ids;
  }

  async function doiReminder(scheduledTime: number, env: NewsletterEnv): Promise<void> {
    try {
      if (!configured(env)) {
        console.error('doi-reminder: TARVENT_API_KEY or the Tarvent ids missing');
        return;
      }
      const { from, to } = reminderWindow(scheduledTime, remindAfterHours);
      const window = `sign-ups ${iso(from)} to ${iso(to)}`;
      const ids = await pendingSignups(env, from, to);
      if (!ids.length) {
        console.log(`doi-reminder: ${window}: none unconfirmed`);
        return;
      }
      if (env.DOI_REMINDER_DRY_RUN === '1') {
        console.log(`doi-reminder: dry run, ${window}: would remind and tag ${ids.length}: ${ids.join(', ')}`);
        return;
      }
      // contactIds is never empty here: without it Tarvent would mail every pending contact.
      const { resendDoiEmail: r } = await tarvent<{
        resendDoiEmail: { contactCount: number; sendCount: number; failCount: number };
      }>(env, RESEND, { i: { audienceId: env.TARVENT_AUDIENCE_ID, contactIds: ids } });
      console.log(`doi-reminder: ${window}: ${r.sendCount} sent, ${r.failCount} failed, ${ids.length} asked: ${ids.join(', ')}`);
      // Tarvent only gives counts, so the tag goes on only when every asked contact got the mail.
      if (r.failCount || r.sendCount !== ids.length) {
        console.error('doi-reminder: not all sent, no tags added');
        return;
      }
      try {
        // contactIds is never empty here: without it Tarvent would tag the whole audience.
        const { addContactTag: status } = await tarvent<{ addContactTag: string }>(env, ADD_TAG, {
          i: { audienceId: env.TARVENT_AUDIENCE_ID, contactIds: ids, tag: reminderTag },
        });
        console.log(`doi-reminder: tagged ${ids.length} "${reminderTag}": ${status}`);
      } catch (e) {
        // The mails went out; a missing tag must not look like a failed reminder.
        console.error('doi-reminder: tagging failed:', redact(e instanceof Error ? e.message : String(e)));
      }
    } catch (e) {
      console.error('doi-reminder: failed:', redact(e instanceof Error ? e.message : String(e)));
    }
  }

  /**
   * Deletes the contacts that are still unconfirmed `deleteAfterDays` days after their sign-up.
   * Tarvent picks them (status and age), and each one is checked again before it goes, so a
   * filter Tarvent ever ignores can never delete a confirmed subscriber.
   */
  async function deleteUnconfirmed(scheduledTime: number, env: NewsletterEnv): Promise<void> {
    try {
      if (!deleteAfterDays) return;
      if (!configured(env)) {
        console.error('doi-cleanup: TARVENT_API_KEY or the Tarvent ids missing');
        return;
      }
      const cutoff = Math.floor(scheduledTime / HOUR) * HOUR - deleteAfterDays * DAY;
      const { contacts }: { contacts: { nodes: Contact[] } } = await tarvent<{ contacts: { nodes: Contact[] } }>(env, STALE, {
        i: {
          audienceId: env.TARVENT_AUDIENCE_ID,
          criteria: {
            operator: 'AND',
            conditions: [
              { fieldName: 'status', operator: 'EQUAL', value: 'PENDING_CONFIRM' },
              { fieldName: 'createdUtc', operator: 'LESS_THAN', value: new Date(cutoff).toISOString() },
            ],
          },
        },
      });
      const stale = contacts.nodes.filter((c) => c.status === 'PENDING_CONFIRM' && Date.parse(c.createdUtc) < cutoff);
      const skipped = contacts.nodes.length - stale.length;
      if (skipped) console.error(`doi-cleanup: Tarvent returned ${skipped} contacts that are confirmed or newer; kept them`);
      const ids = stale.slice(0, MAX_DELETIONS_PER_RUN).map((c) => c.id);
      const label = `unconfirmed sign-ups before ${iso(cutoff)}`;
      if (!ids.length) {
        console.log(`doi-cleanup: ${label}: none`);
        return;
      }
      if (env.DOI_REMINDER_DRY_RUN === '1') {
        console.log(`doi-cleanup: dry run, ${label}: would delete ${ids.length}: ${ids.join(', ')}`);
        return;
      }
      const deleted: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await tarvent(env, DELETE, { i: { audienceId: env.TARVENT_AUDIENCE_ID, id } });
          deleted.push(id);
        } catch (e) {
          failed.push(id);
          console.error(`doi-cleanup: deleting ${id} failed:`, redact(e instanceof Error ? e.message : String(e)));
        }
      }
      const more = stale.length > ids.length || contacts.nodes.length === PAGE ? ' (more next hour)' : '';
      console.log(`doi-cleanup: ${label}: ${deleted.length} deleted, ${failed.length} failed${more}: ${deleted.join(', ')}`);
    } catch (e) {
      console.error('doi-cleanup: failed:', redact(e instanceof Error ? e.message : String(e)));
    }
  }

  async function newsletterCron(scheduledTime: number, env: NewsletterEnv): Promise<void> {
    await doiReminder(scheduledTime, env);
    await deleteUnconfirmed(scheduledTime, env);
  }

  return {
    isNewsletterPath: (pathname: string) => pathname === endpoint,
    newsletter,
    newsletterCron,
    doiReminder,
    deleteUnconfirmed,
  };
}
