/**
 * Tests for the feed rule: the feed writer (lib/rss.js) and the build check
 * (lib/feed-check.js).
 *
 *   npm test
 *
 * Pages are small HTML strings with the canonical link, feed links and
 * JSON-LD the way SeoHead writes them; `checkFeeds` runs over a temporary
 * build folder.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rss, rssResponse } from '../lib/rss.js';
import { checkFeeds, feedLinks, readPage, samePage } from '../lib/feed-check.js';

const SITE = 'https://example.org';

const post = (url, feeds = [], type = 'BlogPosting', datePublished) =>
  `<!doctype html><html><head><link rel="canonical" href="${url}">${feeds
    .map((f) => `<link rel="alternate" type="application/rss+xml" title="Blog" href="${f}">`)
    .join('')}<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': url },
      { '@type': type, '@id': `${url}#article`, mainEntityOfPage: { '@id': url }, headline: 'A post', ...(datePublished ? { datePublished } : {}) },
    ],
  })}</script></head><body><h1>A post</h1></body></html>`;

const index = (url, posts, feeds = []) =>
  `<!doctype html><html><head><link rel="canonical" href="${url}">${feeds
    .map((f) => `<link rel="alternate" type="application/rss+xml" href="${f}">`)
    .join('')}<script type="application/ld+json">${JSON.stringify({
    '@type': 'Blog',
    '@id': `${url}#blog`,
    blogPost: posts.map((p) => ({ '@type': 'BlogPosting', '@id': `${p}#article`, url: p })),
  })}</script></head><body></body></html>`;

const feed = (links) =>
  rss({ title: 'Blog', description: 'Posts', site: SITE, link: '/blog/', self: '/blog/rss.xml', items: links.map((link, i) => ({ title: `Post ${i}`, link, pubDate: `2026-11-1${i}T08:00:00Z` })) });

const logger = () => {
  const lines = [];
  return { lines, info: (line) => lines.push(line), warn: (line) => lines.push(line) };
};

/** Run checkFeeds over a build folder made of { 'path/file': text }. */
async function build(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kit-feeds-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), text);
    }
    const log = logger();
    await checkFeeds(pathToFileURL(dir + path.sep), log);
    return log.lines;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('rss: newest first, absolute links, escaped text', () => {
  const xml = rss({
    title: 'Notes & <news>',
    description: 'Fish "and" chips',
    site: SITE,
    link: '/blog/',
    self: '/blog/rss.xml',
    language: 'de',
    items: [
      { title: 'Older', link: '/blog/older/', pubDate: '2026-01-02T00:00:00Z', description: 'a < b' },
      { title: 'Newer', link: 'https://example.org/blog/newer/', pubDate: new Date('2026-03-04T00:00:00Z'), categories: ['x'] },
    ],
  });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.match(xml, /<title>Notes &amp; &lt;news&gt;<\/title>/);
  assert.match(xml, /<description>Fish &quot;and&quot; chips<\/description>/);
  assert.match(xml, /<atom:link href="https:\/\/example.org\/blog\/rss.xml" rel="self"/);
  assert.match(xml, /<language>de<\/language>/);
  assert.ok(xml.indexOf('Newer') < xml.indexOf('Older'), 'newest first');
  assert.match(xml, /<link>https:\/\/example.org\/blog\/older\/<\/link>/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/example.org\/blog\/older\/<\/guid>/);
  assert.match(xml, /<pubDate>Wed, 04 Mar 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<lastBuildDate>Wed, 04 Mar 2026 00:00:00 GMT<\/lastBuildDate>/);
  assert.match(xml, /<description>a &lt; b<\/description>/);
  assert.match(xml, /<category>x<\/category>/);
  assert.deepEqual(feedLinks(xml), ['https://example.org/blog/newer/', 'https://example.org/blog/older/']);
});

test('rss: an empty feed is valid, a bad date throws', async () => {
  const xml = rss({ title: 'T', description: 'D', site: SITE, link: '/', self: '/rss.xml', items: [] });
  assert.doesNotMatch(xml, /<item>|lastBuildDate/);
  assert.throws(() => rss({ title: 'T', description: 'D', site: SITE, link: '/', self: '/rss.xml', items: [{ title: 'x', link: '/x/', pubDate: 'soon' }] }), /not a date/);
  const res = rssResponse({ title: 'T', description: 'D', site: SITE, link: '/', self: '/rss.xml', items: [] });
  assert.equal(res.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
  assert.match(await res.text(), /<channel>/);
});

test('readPage: a post, its feeds; a blog index is not a post', () => {
  const p = readPage(post('https://example.org/blog/a/', ['/blog/rss.xml']));
  assert.deepEqual(p, { canonical: 'https://example.org/blog/a/', isPost: true, feeds: ['/blog/rss.xml'] });
  assert.equal(readPage(index('https://example.org/blog/', ['https://example.org/blog/a/'])).isPost, false);
  assert.equal(readPage(post('https://example.org/guides/a/', [], 'Article')).isPost, false);
});

test('samePage ignores trailing slash, www, host case and %-escapes', () => {
  assert.equal(samePage('https://WWW.Example.org/ar/%D8%A3/'), samePage('https://example.org/ar/أ'));
});

test('checkFeeds: posts listed in a feed they link pass', async () => {
  const lines = await build({
    'blog/a/index.html': post('https://example.org/blog/a/', ['/blog/rss.xml']),
    'blog/b/index.html': post('https://example.org/blog/b', ['https://www.example.org/blog/rss.xml']),
    'blog/index.html': index('https://example.org/blog/', ['https://example.org/blog/a/']),
    'blog/rss.xml': feed(['/blog/a/', '/blog/b/']),
    'about/index.html': '<html><head><link rel="canonical" href="https://example.org/about/"></head></html>',
  });
  assert.deepEqual(lines, ['2 blog posts checked: each is in a feed it links.']);
});

test('checkFeeds: a site without posts logs nothing', async () => {
  assert.deepEqual(await build({ 'index.html': '<html><head></head><body>BlogPosting in text</body></html>' }), []);
});

test('checkFeeds: no feed link, a missing feed, a feed without the post, a feed elsewhere: the build fails', async () => {
  await assert.rejects(
    build({
      'blog/a/index.html': post('https://example.org/blog/a/'),
      'blog/b/index.html': post('https://example.org/blog/b/', ['/blog/feed.xml']),
      'de/blog/c/index.html': post('https://example.org/de/blog/c/', ['/blog/rss.xml'], 'BlogPosting', '2026-11-18T08:00:00Z'),
      'blog/d/index.html': post('https://example.org/blog/d/', ['https://feeds.example.net/blog.xml']),
      'blog/rss.xml': feed(['/blog/a/']),
    }),
    (err) => {
      assert.match(err.message, /4 blog posts without a feed/);
      assert.match(err.message, /\/blog\/a\/index.html: links no feed/);
      assert.match(err.message, /\/blog\/b\/index.html: \/blog\/feed.xml is not in the build/);
      assert.match(err.message, /\/de\/blog\/c\/index.html: \/blog\/rss.xml does not list https:\/\/example.org\/de\/blog\/c\/, though it lists older posts/);
      assert.match(err.message, /\/blog\/d\/index.html: https:\/\/feeds.example.net\/blog.xml is on another site/);
      return true;
    }
  );
});

test('checkFeeds: one of several linked feeds is enough; Atom counts', async () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="https://example.org/blog/a/"/></entry></feed>';
  const lines = await build({
    'blog/a/index.html': post('https://example.org/blog/a/', ['/other.xml', '/atom.xml']),
    'other.xml': feed([]),
    'atom.xml': atom,
  });
  assert.deepEqual(lines, ['1 blog post checked: each is in a feed it links.']);
});

test('checkFeeds: a feed may stop after its newest posts, but not skip a newer one', async () => {
  // feed() dates its items 2026-11-10, -11, -12 …
  const capped = feed(['/blog/new/', '/blog/newer/']);
  assert.deepEqual(
    await build({
      'blog/new/index.html': post('https://example.org/blog/new/', ['/blog/rss.xml'], 'BlogPosting', '2026-11-10T08:00:00Z'),
      'blog/old/index.html': post('https://example.org/blog/old/', ['/blog/rss.xml'], 'BlogPosting', '2023-09-19T00:00:00Z'),
      'blog/rss.xml': capped,
    }),
    ['2 blog posts checked: each is in a feed it links.']
  );
  await assert.rejects(
    build({
      'blog/new/index.html': post('https://example.org/blog/new/', ['/blog/rss.xml'], 'BlogPosting', '2026-11-10T08:00:00Z'),
      'blog/skipped/index.html': post('https://example.org/blog/skipped/', ['/blog/rss.xml'], 'BlogPosting', '2026-11-10T12:00:00Z'),
      'blog/rss.xml': capped,
    }),
    /\/blog\/skipped\/index.html: \/blog\/rss.xml does not list https:\/\/example.org\/blog\/skipped\/, though it lists older posts/
  );
  await assert.rejects(
    build({ 'blog/a/index.html': post('https://example.org/blog/a/', ['/blog/rss.xml']), 'blog/rss.xml': feed([]) }),
    /\/blog\/rss.xml lists no posts/
  );
});
