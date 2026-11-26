/**
 * Tests for the newsletter sign-up and its confirm reminder (worker/newsletter.ts).
 *
 *   npm test
 *
 * Node runs them alone and reads the TypeScript file as it is (Node 22.18 or
 * newer). `fetch` is replaced for every test, so nothing ever reaches Tarvent:
 * each GraphQL request is recorded and answered by a stand-in.
 *
 * They hold the sign-up to what the form relies on (one address, the page's
 * language, the same "ok" for a known address, nothing sent for bots, other
 * sites or bodies over the limit) and the reminder to its one rule: each
 * unconfirmed sign-up gets the confirm mail once, 24 to 25 hours later, and
 * Tarvent is never asked to mail or tag without the contacts' ids, because
 * without them it acts on the whole audience.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BASELINE_SECURITY_HEADERS } from '../worker/analytics.ts';
import {
  DEFAULT_REMINDER_TAG,
  MAX_SIGNUP_BODY,
  TARVENT_GRAPHQL,
  createNewsletter,
  limitKey,
  redact,
  reminderWindow,
} from '../worker/newsletter.ts';

const SITE = 'https://site.test';
const ENV = { TARVENT_API_KEY: 'test-key', TARVENT_ACCOUNT_ID: '111', TARVENT_AUDIENCE_ID: '222' };
const { isNewsletterPath, newsletter, doiReminder } = createNewsletter({ locales: ['en', 'de', 'ar'] });

/** What went to Tarvent, how the stand-in answers, and what the Worker logged. */
let sent;
let answer;
let errors;
let logs;
const realFetch = globalThis.fetch;
const realError = console.error;
const realLog = console.log;

const data = (d) => new Response(JSON.stringify({ data: d }), { status: 200, headers: { 'content-type': 'application/json' } });
const fails = (message) =>
  new Response(JSON.stringify({ errors: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  answer = () => data({ createContact: { id: '9' } });
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), headers: new Headers(init.headers), query: body.query, variables: body.variables });
    return answer(body);
  };
  errors = [];
  logs = [];
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  console.log = realLog;
});

/** A sign-up as the form's script posts it (multipart), from a visitor at 203.0.113.9. */
function signup(fields = {}, { headers = {}, env = ENV, handler = newsletter } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ lang: 'de', website: '', email: 'reader@example.com', ...fields })) form.append(k, v);
  return handler(
    new Request(SITE + '/api/newsletter', {
      method: 'POST',
      headers: { origin: SITE, 'cf-connecting-ip': '203.0.113.9', accept: 'application/json', ...headers },
      body: form,
    }),
    env
  );
}

const json = async (res) => ({ status: res.status, body: await res.json(), headers: res.headers });

// The sign-up

test('only the form target is the newsletter path', () => {
  assert.equal(isNewsletterPath('/api/newsletter'), true);
  assert.equal(isNewsletterPath('/api/newsletter/'), false);
  assert.equal(isNewsletterPath('/api/contact'), false);
  const other = createNewsletter({ locales: ['en'], endpoint: '/api/subscribe' });
  assert.equal(other.isNewsletterPath('/api/subscribe'), true);
  assert.equal(other.isNewsletterPath('/api/newsletter'), false);
});

test('the languages are required', () => {
  assert.throws(() => createNewsletter({}), /locales/);
  assert.throws(() => createNewsletter({ locales: [] }), /locales/);
});

test('a sign-up adds the address with the page language and the IPv4 address', async () => {
  const res = await json(await signup());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 1);
  const [call] = sent;
  assert.equal(call.url, TARVENT_GRAPHQL);
  assert.equal(call.headers.get('x-api-key'), 'test-key');
  // Tarvent's account header has no X- prefix.
  assert.equal(call.headers.get('account'), '111');
  assert.match(call.query, /createContact/);
  assert.deepEqual(call.variables.i, { audienceId: '222', email: 'reader@example.com', language: 'de', optInIp: '203.0.113.9' });
});

test('answers are JSON, never cached, with the security headers', async () => {
  const { headers } = await json(await signup());
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('cache-control'), 'no-store');
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) assert.equal(headers.get(name), value);
  const own = createNewsletter({ locales: ['en'], headers: { 'X-Frame-Options': 'DENY' } });
  const res = await signup({}, { handler: own.newsletter });
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('strict-transport-security'), null);
});

test('the address is trimmed; an unknown language becomes the first one', async () => {
  await signup({ email: '  reader@example.com ', lang: 'xx' });
  assert.equal(sent[0].variables.i.email, 'reader@example.com');
  assert.equal(sent[0].variables.i.language, 'en');
});

test('an IPv6 visitor signs up without an IP address (Tarvent takes IPv4 only)', async () => {
  await signup({}, { headers: { 'cf-connecting-ip': '2001:db8::7' } });
  assert.equal('optInIp' in sent[0].variables.i, false);
});

test('JSON and urlencoded bodies work too', async () => {
  const body = JSON.stringify({ email: 'reader@example.com', lang: 'ar' });
  const a = await newsletter(new Request(SITE + '/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), ENV);
  assert.deepEqual(await a.json(), { ok: true });
  assert.equal(sent[0].variables.i.language, 'ar');
  const b = await newsletter(
    new Request(SITE + '/api/newsletter', { method: 'POST', body: new URLSearchParams({ email: 'reader@example.com', lang: 'en' }) }),
    ENV
  );
  assert.deepEqual(await b.json(), { ok: true });
  assert.equal(sent.length, 2);
});

test('an address that is already there gets the same answer as a new one', async () => {
  answer = () => fails('Contact with this email already exists');
  const res = await json(await signup());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(errors, []);
});

test('a refused language code signs the address up without it', async () => {
  answer = (body) => (body.variables.i.language ? fails('Invalid language culture code') : data({ createContact: { id: '9' } }));
  const res = await json(await signup());
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 2);
  assert.equal('language' in sent[1].variables.i, false);
});

test('a Tarvent failure answers "failed" and logs no address', async () => {
  answer = () => fails('Could not create contact reader@example.com: limit reached');
  const res = await json(await signup());
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, error: 'failed' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /createContact failed/);
  assert.doesNotMatch(errors[0], /reader@example\.com/);
  assert.match(errors[0], /<address>/);
});

test('an unreachable Tarvent answers "failed"', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const res = await json(await signup());
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { ok: false, error: 'failed' });
});

test('without the secret or the ids nothing is sent', async () => {
  for (const missing of ['TARVENT_API_KEY', 'TARVENT_ACCOUNT_ID', 'TARVENT_AUDIENCE_ID']) {
    const env = { ...ENV, [missing]: '' };
    const res = await json(await signup({}, { env }));
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { ok: false, error: 'failed' });
  }
  assert.equal(sent.length, 0);
  assert.equal(errors.length, 3);
});

test('a filled honeypot gets a quiet "ok" and nothing is sent', async () => {
  const res = await json(await signup({ website: 'https://spam.test' }));
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 0);
});

test('an unusable address answers "invalid" and nothing is sent', async () => {
  for (const email of ['', 'reader', 'reader@example', 'a b@example.com', `${'a'.repeat(310)}@example.com`]) {
    const res = await json(await signup({ email }));
    assert.equal(res.status, 400, email);
    assert.deepEqual(res.body, { ok: false, error: 'invalid' });
  }
  const noField = await newsletter(new Request(SITE + '/api/newsletter', { method: 'POST', body: new URLSearchParams({ lang: 'en' }) }), ENV);
  assert.equal(noField.status, 400);
  const broken = await newsletter(
    new Request(SITE + '/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":' }),
    ENV
  );
  assert.equal(broken.status, 400);
  assert.equal(sent.length, 0);
});

test('a post from another site is refused', async () => {
  const res = await json(await signup({}, { headers: { origin: 'https://other.test' } }));
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { ok: false, error: 'origin' });
  assert.equal(sent.length, 0);
});

test('only POST', async () => {
  const res = await newsletter(new Request(SITE + '/api/newsletter'), ENV);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal(sent.length, 0);
});

test('a body over the limit is refused, by its Content-Length and by what is read', async () => {
  const big = 'x'.repeat(MAX_SIGNUP_BODY + 1);
  const declared = await newsletter(
    new Request(SITE + '/api/newsletter', { method: 'POST', body: new URLSearchParams({ email: 'reader@example.com', note: big }) }),
    ENV
  );
  assert.equal(declared.status, 400);
  const bytes = new TextEncoder().encode(`email=reader%40example.com&note=${big}`);
  const streamed = await newsletter(
    new Request(SITE + '/api/newsletter', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.subarray(i, i + 4096));
          c.close();
        },
      }),
      duplex: 'half',
    }),
    ENV
  );
  assert.equal(streamed.status, 400);
  assert.equal(sent.length, 0);
});

test('the rate limit counts per address, and refuses with "rate"', async () => {
  const keys = [];
  const env = { ...ENV, NEWSLETTER_LIMIT: { limit: async ({ key }) => (keys.push(key), { success: keys.length < 3 }) } };
  assert.deepEqual((await json(await signup({}, { env }))).body, { ok: true });
  await signup({}, { env, headers: { 'cf-connecting-ip': '2001:db8:aa:bb:1:2:3:4' } });
  const third = await json(await signup({}, { env }));
  assert.equal(third.status, 429);
  assert.deepEqual(third.body, { ok: false, error: 'rate' });
  assert.deepEqual(keys, ['203.0.113.9', '2001:db8:aa:bb::/64', '203.0.113.9']);
  assert.equal(sent.length, 2);
});

test('limitKey: IPv4 as it is, IPv6 by its /64', () => {
  assert.equal(limitKey('198.51.100.4'), '198.51.100.4');
  assert.equal(limitKey('2001:0db8:0001:0002:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(limitKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(limitKey('::1'), '0:0:0:0::/64');
});

test('redact: no address survives a log line', () => {
  assert.equal(redact('Contact a.b+c@example.co.uk exists; ask x@y.z'), 'Contact <address> exists; ask <address>');
});

// The reminder

const T = Date.parse('2026-11-26T12:05:00Z');

test('reminderWindow: the full hour 24 hours before the run', () => {
  const w = reminderWindow(T);
  assert.equal(new Date(w.from).toISOString(), '2026-11-25T11:00:00.000Z');
  assert.equal(new Date(w.to).toISOString(), '2026-11-25T12:00:00.000Z');
  // A late start still stands for its own hour.
  assert.deepEqual(reminderWindow(Date.parse('2026-11-26T12:59:59Z')), w);
  assert.equal(new Date(reminderWindow(T, 48).to).toISOString(), '2026-11-24T12:00:00.000Z');
});

const contact = (id, created, status = 'PENDING_CONFIRM') => ({ id, status, createdUtc: created });

/** Tarvent as the reminder meets it: pages of contacts newest first, then resend and tag. */
function tarvent(pages, { resend = (ids) => ({ contactCount: ids.length, sendCount: ids.length, failCount: 0 }), tag = () => 'COMPLETED' } = {}) {
  return (body) => {
    if (/contacts\(/.test(body.query)) {
      const page = body.variables.after ? Number(body.variables.after) : 0;
      return data({ contacts: { pageInfo: { hasNextPage: page + 1 < pages.length, endCursor: String(page + 1) }, nodes: pages[page] } });
    }
    if (/resendDoiEmail/.test(body.query)) return data({ resendDoiEmail: resend(body.variables.i.contactIds) });
    if (/addContactTag/.test(body.query)) return data({ addContactTag: tag(body.variables.i) });
    throw new Error('unexpected query');
  };
}

test('the reminder resends to the unconfirmed sign-ups of its hour, then tags them', async () => {
  answer = tarvent([
    [
      contact('n1', '2026-11-26T11:59:00Z'), // too new
      contact('a', '2026-11-25T11:59:59Z'),
      contact('b', '2026-11-25T11:30:00Z', 'ACTIVE'), // confirmed
    ],
    [
      contact('c', '2026-11-25T11:00:00Z'),
      contact('o1', '2026-11-25T10:59:59Z'), // older than the window: stops here
      contact('o2', '2026-11-24T09:00:00Z'),
    ],
  ]);
  await doiReminder(T, ENV);
  const queries = sent.map((s) => s.query.match(/(contacts|resendDoiEmail|addContactTag)/)[1]);
  assert.deepEqual(queries, ['contacts', 'contacts', 'resendDoiEmail', 'addContactTag']);
  assert.equal(sent[1].variables.after, '1');
  assert.deepEqual(sent[2].variables.i, { audienceId: '222', contactIds: ['a', 'c'] });
  assert.deepEqual(sent[3].variables.i, { audienceId: '222', contactIds: ['a', 'c'], tag: DEFAULT_REMINDER_TAG });
  assert.match(logs[0], /^doi-reminder: sign-ups 2026-11-25T11:00Z to 2026-11-25T12:00Z: 2 sent, 0 failed, 2 asked: a, c$/);
  assert.match(logs[1], /tagged 2 "confirm reminder sent": COMPLETED/);
  assert.deepEqual(errors, []);
});

test('nobody unconfirmed in the hour: one line, no mail, no tag', async () => {
  answer = tarvent([[contact('a', '2026-11-25T11:20:00Z', 'ACTIVE'), contact('o', '2026-11-25T10:00:00Z')]]);
  await doiReminder(T, ENV);
  assert.equal(sent.length, 1);
  assert.deepEqual(logs, ['doi-reminder: sign-ups 2026-11-25T11:00Z to 2026-11-25T12:00Z: none unconfirmed']);
});

test('the dry run names the contacts and sends nothing', async () => {
  answer = tarvent([[contact('a', '2026-11-25T11:20:00Z')]]);
  await doiReminder(T, { ...ENV, DOI_REMINDER_DRY_RUN: '1' });
  assert.equal(sent.length, 1);
  assert.match(logs[0], /dry run, .*would remind and tag 1: a$/);
});

test('not every mail sent: no tags', async () => {
  answer = tarvent([[contact('a', '2026-11-25T11:20:00Z'), contact('b', '2026-11-25T11:10:00Z')]], {
    resend: () => ({ contactCount: 2, sendCount: 1, failCount: 1 }),
  });
  await doiReminder(T, ENV);
  assert.equal(sent.some((s) => /addContactTag/.test(s.query)), false);
  assert.match(errors[0], /not all sent, no tags added/);
});

test('a failed tag is logged and does not throw', async () => {
  const base = tarvent([[contact('a', '2026-11-25T11:20:00Z')]]);
  answer = (body) => (/addContactTag/.test(body.query) ? fails('Not authorized') : base(body));
  await doiReminder(T, ENV);
  assert.match(logs[0], /1 sent, 0 failed/);
  assert.match(errors[0], /tagging failed: Not authorized/);
});

test('a Tarvent failure is logged, never thrown', async () => {
  answer = () => fails('Unauthorized');
  await doiReminder(T, ENV);
  assert.match(errors[0], /^doi-reminder: failed: Unauthorized/);
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await doiReminder(T, ENV);
  assert.match(errors[1], /^doi-reminder: failed: fetch failed/);
});

test('without the secret or the ids the reminder sends nothing', async () => {
  await doiReminder(T, { ...ENV, TARVENT_API_KEY: undefined });
  assert.equal(sent.length, 0);
  assert.match(errors[0], /missing/);
});

test('remindAfterHours and reminderTag', async () => {
  const own = createNewsletter({ locales: ['en'], remindAfterHours: 48, reminderTag: 'reminded' });
  answer = tarvent([[contact('a', '2026-11-24T11:20:00Z'), contact('o', '2026-11-24T10:00:00Z')]]);
  await own.doiReminder(T, ENV);
  assert.deepEqual(sent[1].variables.i.contactIds, ['a']);
  assert.equal(sent[2].variables.i.tag, 'reminded');
});

test('the reading stops after 20 pages', async () => {
  const full = Array.from({ length: 50 }, (_, i) => contact(`p${i}`, '2026-11-26T11:00:00Z'));
  answer = tarvent(Array.from({ length: 30 }, () => full));
  await doiReminder(T, ENV);
  assert.equal(sent.filter((s) => /contacts\(/.test(s.query)).length, 20);
  assert.match(errors[0], /more than 1000 sign-ups to read, stopped/);
  assert.match(logs[0], /none unconfirmed/);
});
