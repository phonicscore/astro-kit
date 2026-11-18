/**
 * Tests for the video rule (lib/video-check.js).
 *
 *   npm test
 *
 * Pages are small HTML strings with the JSON-LD the way SeoHead writes it;
 * `checkVideos` runs over a temporary build folder.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkVideos, readVideos } from '../lib/video-check.js';

const BUILD = Date.parse('2026-11-18T10:00:00Z');

/** A page whose JSON-LD is `graph` (an object, or a raw string). */
const page = (...blocks) =>
  `<!doctype html><html><head>${blocks
    .map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`)
    .join('')}</head><body><h1>x</h1></body></html>`;

const video = (fields = {}) => ({
  '@type': 'VideoObject',
  '@id': 'https://example.org/#video',
  name: 'App preview',
  description: 'Twenty seconds of the app.',
  thumbnailUrl: 'https://example.org/video/preview-poster.jpg',
  contentUrl: 'https://example.org/video/preview.mp4',
  uploadDate: '2023-12-10T00:00:00.000Z',
  ...fields,
});

const graph = (...nodes) => ({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', '@id': 'https://example.org/' }, ...nodes] });

const logger = () => {
  const lines = [];
  return { lines, info: (line) => lines.push(line), warn: (line) => lines.push(line) };
};

test('a complete VideoObject passes', () => {
  assert.deepEqual(readVideos(page(graph(video())), BUILD), { count: 1, problems: [] });
});

test('a time zone offset passes', () => {
  assert.deepEqual(readVideos(page(graph(video({ uploadDate: '2023-12-10T10:14:35+01:00' }))), BUILD).problems, []);
});

test('a page without video markup has nothing to check', () => {
  assert.deepEqual(readVideos(page(graph()), BUILD), { count: 0, problems: [] });
});

test('each required field is named when it is missing or empty', () => {
  const { problems } = readVideos(page(graph(video({ name: '', thumbnailUrl: undefined, uploadDate: undefined }))), BUILD);
  assert.deepEqual(problems, [
    'https://example.org/#video: no name',
    'https://example.org/#video: no thumbnailUrl',
    'https://example.org/#video: no uploadDate',
  ]);
});

test('thumbnailUrl may be a list of addresses', () => {
  assert.deepEqual(readVideos(page(graph(video({ thumbnailUrl: ['https://example.org/a.jpg', 'https://example.org/b.jpg'] }))), BUILD).problems, []);
});

test('an uploadDate without a time zone, or not a date, fails', () => {
  for (const uploadDate of ['2023-12-10', '2023-12-10T00:00:00', '10.12.2023', '2023-13-45T00:00:00Z']) {
    const { problems } = readVideos(page(graph(video({ uploadDate }))), BUILD);
    assert.equal(problems.length, 1, uploadDate);
    assert.match(problems[0], /not an ISO 8601 time with a time zone/);
  }
});

test("an uploadDate at or after the build's start (new Date() in a page) fails", () => {
  for (const uploadDate of ['2026-11-18T10:00:00.000Z', '2026-11-18T10:00:03.417Z', '2027-01-01T00:00:00Z']) {
    const { problems } = readVideos(page(graph(video({ uploadDate }))), BUILD);
    assert.equal(problems.length, 1, uploadDate);
    assert.match(problems[0], /not before the build started/);
  }
  // The day of the build itself, set in the source, is fine.
  assert.deepEqual(readVideos(page(graph(video({ uploadDate: '2026-11-18T00:00:00.000Z' }))), BUILD).problems, []);
});

test('a VideoObject is found nested, with @type as a list, and outside a @graph', () => {
  const nested = graph({ '@type': 'Article', '@id': 'https://example.org/#article', video: video({ '@id': undefined, name: 'Nested', uploadDate: undefined }) });
  assert.deepEqual(readVideos(page(nested), BUILD).problems, ['Nested: no uploadDate']);
  assert.equal(readVideos(page(graph(video({ '@type': ['VideoObject', 'CreativeWork'] }))), BUILD).count, 1);
  assert.equal(readVideos(page({ '@context': 'https://schema.org', ...video() }), BUILD).count, 1);
  assert.equal(readVideos(page([video(), video({ '@id': 'https://example.org/#second' })]), BUILD).count, 2);
});

test('every JSON-LD block of a page counts, and one that does not parse is skipped', () => {
  const { count, problems } = readVideos(page('{ not json', graph(video()), graph(video({ '@id': 'b', uploadDate: undefined }))), BUILD);
  assert.equal(count, 2);
  assert.deepEqual(problems, ['b: no uploadDate']);
});

test('checkVideos fails the build with every page and problem, and passes a clean one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kit-video-'));
  try {
    await mkdir(path.join(dir, 'de'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), page(graph(video())));
    await writeFile(path.join(dir, 'about.html'), page(graph()));
    const out = pathToFileURL(dir + path.sep);

    const ok = logger();
    await checkVideos(out, BUILD, ok);
    assert.deepEqual(ok.lines, ['1 VideoObject checked: name, thumbnailUrl and uploadDate set.']);

    await writeFile(path.join(dir, 'de', 'index.html'), page(graph(video({ '@id': 'https://example.org/de/#video', uploadDate: undefined }))));
    await assert.rejects(checkVideos(out, BUILD, logger()), (error) => {
      assert.match(error.message, /1 VideoObject problem\./);
      assert.match(error.message, /\/de\/index\.html: https:\/\/example\.org\/de\/#video: no uploadDate/);
      return true;
    });

    // No video markup anywhere: nothing to log.
    const quiet = logger();
    await rm(path.join(dir, 'de'), { recursive: true });
    await rm(path.join(dir, 'index.html'));
    await checkVideos(out, BUILD, quiet);
    assert.deepEqual(quiet.lines, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
