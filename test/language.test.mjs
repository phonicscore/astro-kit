/**
 * Tests for the language redirect (worker/language.ts).
 *
 *   npm test
 *
 * Node runs them alone and reads the TypeScript file as it is (Node 22.18 or
 * newer), so nothing has to be installed. They hold two things:
 *
 * 1. The redirect never leaves the site. Its new address is the old one with
 *    another language prefix, so everything after the prefix comes from the
 *    request. Up to 1.11.1, /de//example.com/ with the cookie lang=en answered
 *    302 to //example.com/, which a browser reads as the host example.com.
 * 2. The redirects the sites rely on still happen, each as before.
 *
 * ASSETS is played by two stand-ins. `likeWorkersAssets` answers as Workers
 * static assets do: by the path alone whatever host the request names, each
 * segment decoded and several slashes read as one. That is how the old
 * question about //example.com/ came back as the page "/". `yesToAnything`
 * says yes to every question, as a site with a single-page fallback would:
 * the redirect has to stay on the site even when nothing behind it says no.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLanguageRedirect, preferredLanguage } from '../worker/language.ts';

const SITE = 'https://site.test';
const locales = ['en', 'de', 'fr'];

/** The pages of a small site in three languages. The blog is in English only. */
const PAGES = new Set([
  '/',
  '/viewer/',
  '/guides/',
  '/blog/',
  '/de/',
  '/de/viewer/',
  '/de/guides/',
  '/fr/',
  '/fr/viewer/',
  '/fr/guides/',
]);

function decoded(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function likeWorkersAssets(url) {
  const path = url.pathname.split('/').map(decoded).join('/').replace(/\/+/g, '/');
  if (!PAGES.has(path)) return 404;
  // A page under another spelling of its address is sent to the address itself.
  return path === url.pathname ? 200 : 307;
}

function yesToAnything() {
  return 200;
}

/**
 * One visit: what the redirect answers (null is the page as it is) and what it
 * asked ASSETS on the way. `answer` plays ASSETS, `options` are the site's.
 */
async function visit(path, headers = {}, { answer = likeWorkersAssets, method = 'GET', options = { locales } } = {}) {
  const asked = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        asked.push({ method: request.method, url: request.url });
        return new Response(null, { status: answer(new URL(request.url)) });
      },
    },
  };
  const request = new Request(SITE + path, { method, headers });
  const response = await createLanguageRedirect(options)(request, env);
  return { response, asked, request, location: response?.headers.get('Location') ?? null };
}

/**
 * The redirect and its question to ASSETS stay on the site. The Location is
 * read twice: as text (one slash, then neither a slash nor a backslash) and
 * the way a browser resolves it against the page it came from.
 */
function assertOnSite({ response, asked, request, location }, label) {
  for (const { url } of asked) {
    assert.equal(new URL(url).origin, SITE, `${label}: ASSETS was asked about ${url}`);
  }
  if (!response) return;
  assert.equal(response.status, 302, label);
  assert.ok(location, `${label}: a redirect without a Location`);
  assert.match(location, /^\/(?![/\\])/, `${label}: Location is ${location}`);
  assert.equal(new URL(location, request.url).origin, SITE, `${label}: Location ${location} leads to another host`);
}

/** Who opens the address: with the menu's pick, without one, with a browser language or none. */
const VISITORS = [
  { Cookie: 'lang=en' },
  { Cookie: 'lang=de' },
  { Cookie: 'lang=fr' },
  {},
  { 'Accept-Language': 'de-AT, de;q=0.9, en;q=0.8' },
  { 'Accept-Language': 'en-US, en;q=0.9' },
  { Cookie: 'lang=en', 'Accept-Language': 'de' },
  { Cookie: 'lang=de', 'Accept-Language': 'en' },
  { Cookie: 'theme=dark; lang=en; other=1' },
];

const who = (headers) => JSON.stringify(headers);

/**
 * The addresses of the report (2026-11-16). With the cookie lang=en the first
 * three answered 302 to //example.com/... up to 1.11.1; a backslash reaches
 * the Worker as a slash.
 */
const REPORTED = [
  '/de//example.com/',
  '/de/\\example.com/',
  '/de//example.com/guides/',
  '//example.com/',
  '/de/%2F%2Fexample.com/',
  '/de/%5Cexample.com/',
];

/** More of the kind: what could follow a language prefix, or stand without one. */
const TAILS = [
  '//example.com/',
  '//example.com/guides/',
  '///example.com/',
  '/\\example.com/',
  '/\\\\example.com/',
  '/\\/example.com/',
  '//\\example.com/',
  '/.//example.com/',
  '/..//example.com/',
  '/%2e%2e//example.com/',
  '/\t/example.com/',
  '/%09/example.com/',
  '/%2F%2Fexample.com/',
  '/%2f/example.com/',
  '/%5Cexample.com/',
  '/%5C%5Cexample.com/',
  '//example.com/?next=/de/',
  '//example.com:443/',
  '//user@example.com/',
  '/@example.com/',
  '/https://example.com/',
  '/https:/example.com/',
  '//',
  '///',
];
const PREFIXES = ['', '/de', '/fr', '/en', '/DE', '/de/guides', '/viewer'];
const HOSTILE = [...new Set([...REPORTED, ...PREFIXES.flatMap((prefix) => TAILS.map((tail) => prefix + tail))])];

test('no address leads off the site, whoever opens it and whatever ASSETS answers', async () => {
  let visits = 0;
  for (const path of HOSTILE) {
    for (const headers of VISITORS) {
      for (const answer of [likeWorkersAssets, yesToAnything]) {
        for (const method of ['GET', 'HEAD']) {
          const visited = await visit(path, headers, { answer, method });
          assertOnSite(visited, `${method} ${JSON.stringify(path)} ${who(headers)} (${answer.name})`);
          visits++;
        }
      }
    }
  }
  assert.ok(visits > 5000, `${visits} visits`);
});

test('an address with an empty segment or a backslash is served as it is, and ASSETS is not asked', async () => {
  for (const path of HOSTILE) {
    const { pathname } = new URL(SITE + path);
    if (!pathname.includes('//') && !pathname.includes('\\')) continue;
    for (const headers of VISITORS) {
      const { response, asked } = await visit(path, headers, { answer: yesToAnything });
      const label = `${JSON.stringify(path)} ${who(headers)}`;
      assert.equal(response, null, `${label}: redirected to ${response?.headers.get('Location')}`);
      assert.deepEqual(asked, [], label);
    }
  }
});

test('the reported addresses: no redirect at all on a site like ours', async () => {
  for (const path of REPORTED) {
    for (const headers of VISITORS) {
      const { response } = await visit(path, headers);
      assert.equal(response, null, `${JSON.stringify(path)} ${who(headers)}`);
    }
  }
});

test('an encoded slash or backslash stays a path of the site, even when ASSETS says yes to it', async () => {
  const lang = { Cookie: 'lang=en' };
  assert.equal((await visit('/de/%2F%2Fexample.com/', lang, { answer: yesToAnything })).location, '/%2F%2Fexample.com/');
  assert.equal((await visit('/de/%5Cexample.com/', lang, { answer: yesToAnything })).location, '/%5Cexample.com/');
  // A browser asks this site for them: neither is decoded into the start of a host.
  assert.equal(new URL('/%2F%2Fexample.com/', SITE + '/de/').href, SITE + '/%2F%2Fexample.com/');
  assert.equal(new URL('/%5Cexample.com/', SITE + '/de/').href, SITE + '/%5Cexample.com/');
});

test('other languages at the root, and codes with a hyphen', async () => {
  const german = { locales: ['de', 'en', 'zh-hant'], defaultLocale: 'de' };
  for (const path of ['/en//example.com/', '/zh-hant//example.com/', '/en/\\example.com/', '//example.com/']) {
    for (const headers of [{ Cookie: 'lang=de' }, { Cookie: 'lang=en' }, { Cookie: 'lang=zh-hant' }, {}]) {
      const visited = await visit(path, headers, { answer: yesToAnything, options: german });
      assert.equal(visited.response, null, `${path} ${who(headers)}`);
    }
  }
  assert.equal((await visit('/en/viewer/', { Cookie: 'lang=de' }, { answer: yesToAnything, options: german })).location, '/viewer/');
  assert.equal((await visit('/viewer/', { Cookie: 'lang=zh-hant' }, { answer: yesToAnything, options: german })).location, '/zh-hant/viewer/');
  assert.equal((await visit('/zh-hant/viewer/', { Cookie: 'lang=en' }, { answer: yesToAnything, options: german })).location, '/en/viewer/');
});

/**
 * The redirects of a site in use: [what, address, headers, the Location or
 * null for the page as it is].
 */
const USUAL = [
  ["the menu's pick, on a page in the default language", '/viewer/', { Cookie: 'lang=de' }, '/de/viewer/'],
  ["the menu's pick, back to the default language", '/de/viewer/', { Cookie: 'lang=en' }, '/viewer/'],
  ["the menu's pick, from one prefix to another", '/de/viewer/', { Cookie: 'lang=fr' }, '/fr/viewer/'],
  ['the home page, to a prefix', '/', { Cookie: 'lang=fr' }, '/fr/'],
  ['the home page, from a prefix', '/de/', { Cookie: 'lang=en' }, '/'],
  ['the pick among other cookies', '/guides/', { Cookie: 'theme=dark; lang=de; other=1' }, '/de/guides/'],
  ['the pick wins over the browser', '/de/guides/', { Cookie: 'lang=en', 'Accept-Language': 'de' }, '/guides/'],
  ['the query stays', '/viewer/?url=https://example.com/a.musicxml&zoom=2', { Cookie: 'lang=de' }, '/de/viewer/?url=https://example.com/a.musicxml&zoom=2'],
  ['the query stays on the way back', '/de/viewer/?url=//example.com/a.musicxml', { Cookie: 'lang=en' }, '/viewer/?url=//example.com/a.musicxml'],
  ['already in the picked language', '/de/viewer/', { Cookie: 'lang=de' }, null],
  ['already in the picked default language', '/viewer/', { Cookie: 'lang=en' }, null],
  ['a page missing in the picked language stays', '/blog/', { Cookie: 'lang=de' }, null],
  ['an address that is no page stays', '/de/nothing-here/', { Cookie: 'lang=en' }, null],
  ["the browser's first language", '/', { 'Accept-Language': 'de-AT, en' }, '/de/'],
  ["the browser's first language, on a page", '/guides/', { 'Accept-Language': 'fr-CH, fr;q=0.9, de;q=0.8' }, '/fr/guides/'],
  ["the browser's weights", '/', { 'Accept-Language': 'en;q=0.5, fr;q=0.9' }, '/fr/'],
  ['English first stays English', '/', { 'Accept-Language': 'en-US, de' }, null],
  ['a language the site does not have', '/', { 'Accept-Language': 'it, es;q=0.9' }, null],
  ['no cookie and no browser language', '/', {}, null],
  ['a page under a prefix is not moved by the browser', '/fr/viewer/', { 'Accept-Language': 'de' }, null],
  ['a pick the site does not have falls back to the browser', '/', { Cookie: 'lang=xx', 'Accept-Language': 'de' }, '/de/'],
  ['a click on the site itself', '/viewer/', { Cookie: 'lang=de', 'Sec-Fetch-Site': 'same-origin' }, null],
  ['a visit from another site', '/viewer/', { Cookie: 'lang=de', 'Sec-Fetch-Site': 'cross-site' }, '/de/viewer/'],
  ['a typed address or a bookmark', '/viewer/', { Cookie: 'lang=de', 'Sec-Fetch-Site': 'none' }, '/de/viewer/'],
  ['a referrer on the site, without Sec-Fetch-Site', '/viewer/', { Cookie: 'lang=de', Referer: `${SITE}/guides/` }, null],
  ['a referrer elsewhere, without Sec-Fetch-Site', '/viewer/', { Cookie: 'lang=de', Referer: 'https://example.com/' }, '/de/viewer/'],
  ['a crawler', '/', { 'Accept-Language': 'de', 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, null],
  ['a link preview', '/viewer/', { Cookie: 'lang=de', 'User-Agent': 'facebookexternalhit/1.1' }, null],
  ['a file', '/favicon.svg', { Cookie: 'lang=de' }, null],
  ['a page without its last slash', '/de/viewer', { Cookie: 'lang=en' }, null],
];

for (const [what, path, headers, expected] of USUAL) {
  test(`${what}: ${path} ${who(headers)} -> ${expected ?? 'as it is'}`, async () => {
    for (const method of ['GET', 'HEAD']) {
      const visited = await visit(path, headers, { method });
      assert.equal(visited.location, expected, method);
      assertOnSite(visited, what);
    }
  });
}

test('the redirect is a 302 that no cache keeps, after one HEAD question about the new page', async () => {
  const { response, asked } = await visit('/viewer/?url=x', { Cookie: 'lang=de' });
  assert.equal(response?.status, 302);
  assert.equal(response?.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response?.headers.get('Vary'), 'Accept-Language, Cookie');
  assert.deepEqual(asked, [{ method: 'HEAD', url: `${SITE}/de/viewer/` }]);
});

test('the page a redirect leads to is not redirected again', async () => {
  for (const [path, headers] of [
    ['/viewer/', { Cookie: 'lang=de' }],
    ['/de/viewer/', { Cookie: 'lang=en' }],
    ['/de/', { Cookie: 'lang=fr' }],
    ['/', { 'Accept-Language': 'de' }],
  ]) {
    const first = await visit(path, headers);
    assert.ok(first.location, path);
    assert.equal((await visit(first.location, headers)).response, null, `${path} -> ${first.location}`);
  }
});

test('only GET and HEAD are redirected', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.equal((await visit('/viewer/', { Cookie: 'lang=de' }, { method })).response, null, method);
  }
});

test("preferredLanguage: the browser's first language that the site has", () => {
  assert.equal(preferredLanguage('de-AT, en', locales), 'de');
  assert.equal(preferredLanguage('en-US, de', locales), 'en');
  assert.equal(preferredLanguage('en;q=0.5, fr;q=0.9', locales), 'fr');
  assert.equal(preferredLanguage('it, es;q=0.9, de;q=0.1', locales), 'de');
  assert.equal(preferredLanguage('it, es;q=0.9', locales), null);
  assert.equal(preferredLanguage('*, de;q=0', locales), null);
  assert.equal(preferredLanguage('', locales), null);
  assert.equal(preferredLanguage(null, locales), null);
});
