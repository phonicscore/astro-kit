/**
 * Tests for the Usermaven proxy (worker/analytics.ts).
 *
 *   npm test
 *
 * Node runs them alone and reads the TypeScript file as it is (Node 22.18 or
 * newer). `fetch` is replaced for every test, so nothing ever reaches
 * Usermaven: each upstream request is recorded and answered by a stand-in.
 *
 * The page view is the shape Usermaven's script sends it from a built page
 * (test/fixtures/usermaven-event.json, with a neutral key and host). It has to
 * go upstream exactly as it came, with the query the Worker writes. Every
 * event for another workspace, every body that is not JSON and every body over
 * the limit stays here: nothing goes upstream.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import {
  BASELINE_SECURITY_HEADERS,
  MAX_EVENT_BODY,
  createAnalyticsProxy,
} from '../worker/analytics.ts';

const fixture = JSON.parse(await readFile(new URL('./fixtures/usermaven-event.json', import.meta.url), 'utf8'));
const KEY = 'UMsitekey0';
const OTHER = 'UMotherkey';
const SITE = 'https://site.test';
const UPSTREAM_EVENT = `https://events.usermaven.com/api/v1/event?token=${KEY}&cookie_policy=strict&ip_policy=strict`;

const { isAnalyticsPath, analytics } = createAnalyticsProxy({ key: KEY });

/** What went upstream, and how the stand-in answers. */
let sent;
let answer;
let logged;
const realFetch = globalThis.fetch;
const realError = console.error;

beforeEach(() => {
  sent = [];
  answer = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } });
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body, cf: init.cf });
    return answer();
  };
  logged = [];
  console.error = (...args) => logged.push(args.join(' '));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

/** An event as the browser posts it, from a visitor at 203.0.113.9. */
const event = (path = fixture.path, { headers = {}, body = fixture.body, proxy = analytics } = {}) =>
  proxy(
    new Request(SITE + path, {
      method: 'POST',
      headers: { ...fixture.headers, 'cf-connecting-ip': '203.0.113.9', ...headers },
      body,
    })
  );

/** A body as a stream, so the request declares no Content-Length. */
function streamed(bytes) {
  return new Request(SITE + fixture.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.subarray(i, i + 4096));
        c.close();
      },
    }),
    duplex: 'half',
  });
}

test('the captured page view goes upstream unchanged, with the query the Worker writes', async () => {
  const r = await event();
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].url, UPSTREAM_EVENT);
  assert.equal(sent[0].body, fixture.body, 'body byte for byte');
  assert.equal(sent[0].headers.get('x-forwarded-for'), '203.0.113.9');
  assert.equal(sent[0].headers.get('content-type'), 'application/json');
  assert.equal(sent[0].headers.get('origin'), fixture.headers.origin);
  assert.equal(sent[0].headers.get('user-agent'), fixture.headers['user-agent']);
});

test('no cookie goes up, no Set-Cookie comes down, and the answer is not cached', async () => {
  const r = await event(fixture.path, { headers: { cookie: 'a=1' } });
  assert.equal(sent[0].headers.has('cookie'), false);
  assert.equal(sent[0].headers.has('cf-connecting-ip'), false);
  assert.equal(r.headers.has('set-cookie'), false);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('content-type'), 'application/json');
});

test('upstream status and body come back as Usermaven answered', async () => {
  answer = () => new Response('{"ok":false}', { status: 400, headers: { 'content-type': 'application/json' } });
  const r = await event();
  assert.equal(r.status, 400);
  assert.equal(await r.text(), '{"ok":false}');
});

test('the fallback path goes to its own upstream path', async () => {
  const r = await event(`/um/api/v1/s2s/event?token=${KEY}&cookie_policy=strict&ip_policy=strict`);
  assert.equal(r.status, 200);
  assert.equal(sent[0].url, `https://events.usermaven.com/api/v1/s2s/event?token=${KEY}&cookie_policy=strict&ip_policy=strict`);
});

test('the Worker sets the strict policies, whatever the browser asks for', async () => {
  await event(`/um/api/v1/event?token=${KEY}&cookie_policy=none&ip_policy=keep`);
  assert.equal(sent[0].url, UPSTREAM_EVENT);
});

test('missing policies are added', async () => {
  await event(`/um/api/v1/event?token=${KEY}`);
  assert.equal(sent[0].url, UPSTREAM_EVENT);
});

test('nothing else from the browser\'s query goes upstream', async () => {
  await event(`/um/api/v1/event?ip_policy=keep&token=${KEY}&debug=1&api_key=${KEY}`);
  assert.equal(sent[0].url, UPSTREAM_EVENT);
});

test('the site\'s own key as api_key in the query passes', async () => {
  const r = await event(`/um/api/v1/event?token=${KEY}&api_key=${KEY}`);
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
});

test('a body without api_key passes', async () => {
  const r = await event(fixture.path, { body: JSON.stringify([{ event_type: 'pageview' }]) });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
});

const escaped = fixture.body.replace(`"api_key":"${KEY}"`, `"\\u0061pi_key":"${OTHER}"`);

for (const [label, path, body, status] of [
  ['another workspace\'s token', `/um/api/v1/event?token=${OTHER}&cookie_policy=strict&ip_policy=strict`, fixture.body, 403],
  ['no token', '/um/api/v1/event', fixture.body, 403],
  ['an empty token', '/um/api/v1/event?token=', fixture.body, 403],
  ['the site\'s token and a second one', `/um/api/v1/event?token=${KEY}&token=${OTHER}&cookie_policy=strict&ip_policy=strict`, fixture.body, 403],
  ['the site\'s token and another api_key in the query', `/um/api/v1/event?token=${KEY}&api_key=${OTHER}`, fixture.body, 403],
  ['another api_key in the body', fixture.path, fixture.body.replace(`"api_key":"${KEY}"`, `"api_key":"${OTHER}"`), 403],
  ['another api_key written with unicode escapes', fixture.path, escaped, 403],
  ['another api_key nested in the body', fixture.path, JSON.stringify({ events: [{ api_key: OTHER, event_type: 'pageview' }] }), 403],
  ['an api_key that is not a string', fixture.path, JSON.stringify([{ api_key: [KEY] }]), 403],
  ['a body that is not JSON', fixture.path, `api_key=${KEY}`, 400],
  ['an empty body', fixture.path, '', 400],
  ['a body over the limit, by its Content-Length', fixture.path, 'x'.repeat(MAX_EVENT_BODY + 1), 413],
]) {
  test(`refused, nothing upstream: ${label} (${status})`, async () => {
    const r = await event(path, { body });
    assert.equal(r.status, status);
    assert.equal(sent.length, 0);
    assert.equal(await r.text(), '');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
}

test('the escaped case really holds an escaped key that JSON reads as api_key', () => {
  assert.ok(escaped.includes('\\u0061pi_key'));
  assert.equal(JSON.parse(escaped)[0].api_key, OTHER);
});

test('a body over the limit without Content-Length is refused by what is read', async () => {
  const big = new TextEncoder().encode('[' + '"x",'.repeat(20000) + '"x"]');
  assert.ok(big.length > MAX_EVENT_BODY);
  const request = streamed(big);
  assert.equal(request.headers.get('content-length'), null);
  const r = await analytics(request);
  assert.equal(r.status, 413);
  assert.equal(sent.length, 0);
});

test('a body over the limit that declares a small Content-Length is refused by what is read', async () => {
  const big = new TextEncoder().encode(JSON.stringify(['x'.repeat(MAX_EVENT_BODY)]));
  const request = streamed(big);
  // What a client may claim; the Worker reads no further than the limit either way.
  const lying = new Request(request, { headers: { 'content-type': 'application/json', 'content-length': '10' } });
  assert.equal(lying.headers.get('content-length'), '10');
  const r = await analytics(lying);
  assert.equal(r.status, 413);
  assert.equal(sent.length, 0);
});

test('a streamed body under the limit goes on', async () => {
  const request = streamed(new TextEncoder().encode(fixture.body));
  const r = await analytics(new Request(SITE + `/um/api/v1/event?token=${KEY}`, request));
  assert.equal(r.status, 200);
  assert.equal(sent[0].body, fixture.body);
});

test('Global Privacy Control: Sec-GPC 1 answers 204 and nothing goes upstream', async () => {
  const r = await event(fixture.path, { headers: { 'sec-gpc': '1' } });
  assert.equal(r.status, 204);
  assert.equal(sent.length, 0);
});

test('an event upstream that is down answers 502 without a body', async () => {
  answer = () => {
    throw new TypeError('network down');
  };
  const r = await event();
  assert.equal(r.status, 502);
  assert.equal(await r.text(), '');
  assert.match(logged[0], /event forward failed/);
});

test('events take POST only', async () => {
  const r = await analytics(new Request(SITE + fixture.path));
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'POST');
  assert.equal(sent.length, 0);
});

test('the script comes from Usermaven and is kept a day', async () => {
  answer = () => new Response('/* lib */', { status: 200, headers: { 'content-type': 'application/javascript', 'set-cookie': 'x=1' } });
  const r = await analytics(new Request(SITE + '/um/lib.js'));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '/* lib */');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://t.usermaven.com/lib.js');
  assert.deepEqual(sent[0].cf, { cacheEverything: true, cacheTtl: 86400 });
  assert.equal(r.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(r.headers.has('set-cookie'), false);
});

test('the script answers HEAD without a body, and refuses other methods', async () => {
  let r = await analytics(new Request(SITE + '/um/lib.js', { method: 'HEAD' }));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '');
  r = await analytics(new Request(SITE + '/um/lib.js', { method: 'POST', body: 'x' }));
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'GET, HEAD');
});

test('a script upstream that is down or failing answers 502 without a body, a missing one 404', async () => {
  answer = () => {
    throw new TypeError('network down');
  };
  let r = await analytics(new Request(SITE + '/um/lib.js'));
  assert.equal(r.status, 502);
  assert.equal(await r.text(), '');
  assert.match(logged[0], /script fetch failed/);
  answer = () => new Response('oops', { status: 500 });
  r = await analytics(new Request(SITE + '/um/lib.js'));
  assert.equal(r.status, 502);
  assert.equal(await r.text(), '');
  answer = () => new Response('gone', { status: 404 });
  r = await analytics(new Request(SITE + '/um/lib.js'));
  assert.equal(r.status, 404);
  assert.equal(await r.text(), '');
});

test('any other path under /um/ answers 404, and nothing goes upstream', async () => {
  for (const path of ['/um/anything', '/um/', '/um/api/v1/other', '/um/lib.js/x', '/um/api/v1/event/']) {
    const r = await analytics(new Request(SITE + path, { method: 'POST', body: fixture.body }));
    assert.equal(r.status, 404, path);
  }
  assert.equal(sent.length, 0);
});

test('isAnalyticsPath is everything under /um/ and nothing else', () => {
  assert.equal(isAnalyticsPath('/um/lib.js'), true);
  assert.equal(isAnalyticsPath('/um/api/v1/event'), true);
  assert.equal(isAnalyticsPath('/um/anything'), true);
  assert.equal(isAnalyticsPath('/um'), false);
  assert.equal(isAnalyticsPath('/umbrella/'), false);
  assert.equal(isAnalyticsPath('/de/um/lib.js'), false);
});

test('every answer carries the kit\'s baseline security headers by default', async () => {
  for (const r of [await event(), await event('/um/api/v1/event'), await analytics(new Request(SITE + '/um/lib.js')), await analytics(new Request(SITE + '/um/x'))]) {
    for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) assert.equal(r.headers.get(name), value, name);
  }
});

test('a site\'s own headers replace the default set', async () => {
  const own = { 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'microphone=()' };
  const proxy = createAnalyticsProxy({ key: KEY, headers: own }).analytics;
  const r = await event(fixture.path, { proxy });
  assert.equal(r.headers.get('permissions-policy'), 'microphone=()');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.has('x-frame-options'), false);
});

test('the default set is the one in the kit\'s baseline _headers', async () => {
  const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  const block = /\n\/\*\n((?:  .+\n)+)/.exec(index);
  assert.ok(block, 'the /* block of BASELINE_HEADERS in index.js');
  const baseline = Object.fromEntries(
    block[1]
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/:\s(.*)/s).slice(0, 2))
  );
  assert.deepEqual({ ...BASELINE_SECURITY_HEADERS }, baseline);
});

test('another key is another workspace: each proxy takes only its own', async () => {
  const other = createAnalyticsProxy({ key: OTHER }).analytics;
  const r = await event(fixture.path, { proxy: other });
  assert.equal(r.status, 403);
  assert.equal(sent.length, 0);
});

test('a proxy without a key is not made', () => {
  assert.throws(() => createAnalyticsProxy({}), /key/);
  assert.throws(() => createAnalyticsProxy({ key: '' }), /key/);
  assert.throws(() => createAnalyticsProxy({ key: ' UMsitekey0' }), /key/);
  assert.throws(() => createAnalyticsProxy(), /key/);
});
