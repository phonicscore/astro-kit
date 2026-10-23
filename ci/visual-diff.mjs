// @ts-check
/**
 * Compares two builds of a site, before and after a dependency update, and
 * says whether a visitor could tell them apart.
 *
 *   node ci/visual-diff.mjs <before/dist> <after/dist> <out-dir>
 *
 * Every .html file in either build is a page, and each page is checked for:
 * - a full-page screenshot at desktop and phone width, compared pixel by
 *   pixel. A page that differs is shot again, both sides, before it counts.
 * - its <head> metadata: title, meta tags, canonical and alternate links,
 *   and the JSON-LD anywhere on the page.
 * - console errors and exceptions that only the new build throws.
 * Every other file outside _astro/ (sitemaps, robots.txt, llms.txt, _headers,
 * share cards, fonts, images) is compared byte for byte, PNGs pixel by pixel.
 * _astro/ holds the bundles under content-hashed names that change with any
 * compiler update; what they do shows in the screenshots.
 *
 * Pages render offline: only the two local servers answer, and every other
 * request (analytics, Turnstile, checkout scripts) is aborted on both sides.
 * Motion is reduced and animations are stopped, so a page renders the same
 * frame each time.
 *
 * Writes <out-dir>/report.md and report.json, plus before, after and diff PNGs
 * for every screenshot that differs. Exit code 0: no difference; 1:
 * differences; 2: the comparison itself failed.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

/**
 * @typedef {{ name: string, width: number, height: number, mobile: boolean }} Viewport
 * @typedef {{ png: Buffer, errors: string[] }} Shot
 * @typedef {{ page: string, width?: string, what: string, images?: string }} Difference
 */

/** @type {Viewport[]} */
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
];
const CONCURRENCY = 4;
// pixelmatch's colour tolerance per pixel. Anti-aliased pixels are detected
// and ignored, so a page passes only if no other pixel moved.
const THRESHOLD = 0.1;
const STILL = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.musicxml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

const [beforeArg, afterArg, outArg] = process.argv.slice(2);
if (!beforeArg || !afterArg || !outArg) {
  console.error('usage: node ci/visual-diff.mjs <before/dist> <after/dist> <out-dir>');
  process.exit(2);
}
const BEFORE = path.resolve(beforeArg);
const AFTER = path.resolve(afterArg);
const OUT = path.resolve(outArg);

/** Every file under `root`, as a POSIX path relative to it. */
async function files(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

/** `about/index.html` → `/about/`, `404.html` → `/404.html`. */
function urlOf(file) {
  if (file === 'index.html') return '/';
  return file.endsWith('/index.html') ? `/${file.slice(0, -'index.html'.length)}` : `/${file}`;
}

/** `/about/team/` → `about-team`, for screenshot file names. */
function slugOf(url) {
  return url.replace(/^\/|\/$/g, '').replace(/[^\w.-]+/g, '-') || 'home';
}

/** A static server for one build, the way the hosts serve it: /x/ → /x/index.html, 404.html otherwise. */
function serve(root) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = path.join(root, pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      await stat(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(path.join(root, '404.html'))
        .on('error', () => res.end())
        .pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Hashed bundle names change with every compiler update: _astro/Base.Bx3kQ9aZ.css → _astro/Base.css.
const unhash = (/** @type {string} */ s) => s.replace(/(\/_astro\/[\w.-]+?)\.[\w-]{8}(\.\w+)/g, '$1$2');

/**
 * The metadata a search engine or a share preview reads, one line per item.
 * `meta generator` is left out: it names the Astro version.
 */
function metadataOf(html) {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const lines = [];
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title !== undefined) lines.push(`title: ${title.trim()}`);
  for (const tag of head.match(/<(?:meta|link)\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => [
        m[1].toLowerCase(),
        m[2] ?? m[3] ?? m[4],
      ]),
    );
    if (/^<meta/i.test(tag)) {
      const key = attrs.name ?? attrs.property ?? attrs['http-equiv'] ?? (attrs.charset ? 'charset' : undefined);
      if (key && key !== 'generator') lines.push(`meta ${key}: ${attrs.content ?? attrs.charset}`);
    } else if (/^(canonical|alternate|icon|apple-touch-icon|manifest|sitemap|me)$/.test(attrs.rel ?? '')) {
      lines.push(`link ${[attrs.rel, attrs.hreflang, attrs.type].filter(Boolean).join(' ')}: ${attrs.href}`);
    }
  }
  for (const m of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    lines.push(`ld+json: ${m[1].trim()}`);
  }
  return lines.map(unhash);
}

/** Two PNGs: `null` if they match, else what differs and the diff image. */
function comparePngs(a, b) {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) {
    return { what: `size ${A.width}×${A.height} → ${B.width}×${B.height}`, diff: undefined };
  }
  const diff = new PNG({ width: A.width, height: A.height });
  const pixels = pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold: THRESHOLD });
  if (pixels === 0) return null;
  const share = ((pixels / (A.width * A.height)) * 100).toFixed(pixels < A.width ? 3 : 1);
  return { what: `${pixels.toLocaleString('en')} pixels (${share} %)`, diff: PNG.sync.write(diff) };
}

/**
 * One browser context per build and width. Only the build's own server
 * answers; everything else is aborted, so third-party scripts cannot make
 * the two sides differ.
 */
async function contextFor(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Europe/Vienna',
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
  return context;
}

/** @returns {Promise<Shot>} */
async function shoot(context, origin, url) {
  const page = await context.newPage();
  const errors = [];
  const local = (/** @type {string} */ s) => s.replaceAll(origin, '');
  page.on('pageerror', (e) => errors.push(`exception: ${local(e.message)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${local(m.text())}`));
  try {
    await page.goto(origin + url, { waitUntil: 'load', timeout: 30_000 });
    await page.addStyleTag({ content: STILL });
    // Walk down the page once, so lazy images and IntersectionObserver
    // content load, then wait for fonts and for every image to be decoded:
    // a loaded `decoding="async"` image below the fold can still be missing
    // from a full-page screenshot.
    await page.evaluate(async () => {
      for (const img of document.images) {
        img.loading = 'eager';
        img.decoding = 'sync';
      }
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 50));
      }
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);
    const png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
    return { png, errors };
  } finally {
    await page.close();
  }
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(/** @type {any} */ (queue.shift()));
  }));
}

async function main() {
  const [beforeFiles, afterFiles] = await Promise.all([files(BEFORE), files(AFTER)]);
  const all = [...new Set([...beforeFiles, ...afterFiles])].sort();
  const inBefore = new Set(beforeFiles);
  const inAfter = new Set(afterFiles);
  /** @type {Difference[]} */
  const differences = [];
  await mkdir(path.join(OUT, 'pages'), { recursive: true });

  // Pages that exist on one side only, and everything that is not a page.
  const pages = [];
  let otherFiles = 0;
  for (const file of all) {
    if (file.startsWith('_astro/')) continue;
    const isPage = file.endsWith('.html');
    if (!inBefore.has(file) || !inAfter.has(file)) {
      differences.push({
        page: isPage ? urlOf(file) : file,
        what: inBefore.has(file) ? 'gone after the update' : 'new after the update',
      });
      continue;
    }
    if (isPage) {
      pages.push(file);
      continue;
    }
    if (file.startsWith('_astro/')) continue;
    otherFiles++;
    const [a, b] = await Promise.all([readFile(path.join(BEFORE, file)), readFile(path.join(AFTER, file))]);
    if (a.equals(b)) continue;
    const changed = file.endsWith('.png') ? comparePngs(a, b) : { what: 'content changed' };
    if (changed) differences.push({ page: file, what: changed.what });
  }

  // Metadata, straight from the HTML.
  for (const file of pages) {
    const [a, b] = await Promise.all([
      readFile(path.join(BEFORE, file), 'utf8').then(metadataOf),
      readFile(path.join(AFTER, file), 'utf8').then(metadataOf),
    ]);
    const gone = a.filter((line) => !b.includes(line));
    const added = b.filter((line) => !a.includes(line));
    if (gone.length || added.length) {
      const list = [...gone.map((l) => `− ${l}`), ...added.map((l) => `+ ${l}`)].join('<br>');
      differences.push({ page: urlOf(file), what: `metadata<br>${list}` });
    }
  }

  // Screenshots and console errors.
  const [beforeServer, afterServer] = await Promise.all([serve(BEFORE), serve(AFTER)]);
  const origin = (server) => `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const contexts = new Map();
    for (const viewport of VIEWPORTS) {
      contexts.set(viewport.name, {
        before: await contextFor(browser, viewport),
        after: await contextFor(browser, viewport),
      });
    }
    const jobs = pages.flatMap((file) => VIEWPORTS.map((viewport) => ({ url: urlOf(file), viewport })));
    let done = 0;
    await pool(jobs, CONCURRENCY, async ({ url, viewport }) => {
      const { before, after } = contexts.get(viewport.name);
      const pair = () =>
        Promise.all([shoot(before, origin(beforeServer), url), shoot(after, origin(afterServer), url)]);
      let [a, b] = await pair();
      let changed = comparePngs(a.png, b.png);
      if (changed) {
        [a, b] = await pair();
        changed = comparePngs(a.png, b.png);
      }
      if (changed) {
        const name = `${slugOf(url)}-${viewport.name}`;
        await writeFile(path.join(OUT, 'pages', `${name}-before.png`), a.png);
        await writeFile(path.join(OUT, 'pages', `${name}-after.png`), b.png);
        if (changed.diff) await writeFile(path.join(OUT, 'pages', `${name}-diff.png`), changed.diff);
        differences.push({ page: url, width: viewport.name, what: changed.what, images: `pages/${name}-*.png` });
      }
      const newErrors = [...new Set(b.errors.filter((e) => !a.errors.includes(e)))];
      if (newErrors.length) {
        differences.push({ page: url, width: viewport.name, what: `new errors<br>${newErrors.join('<br>')}` });
      }
      done++;
      if (done % 20 === 0 || done === jobs.length) console.log(`screenshots: ${done}/${jobs.length}`);
    });
  } finally {
    await browser.close();
    beforeServer.close();
    afterServer.close();
  }

  differences.sort((x, y) => x.page.localeCompare(y.page) || (x.width ?? '').localeCompare(y.width ?? ''));
  const scope = `${pages.length} pages at ${VIEWPORTS.map((v) => `${v.width} px`).join(' and ')}, ${otherFiles} other files`;
  const cell = (/** @type {string} */ s) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const report = differences.length
    ? [
        `**${differences.length} difference${differences.length === 1 ? '' : 's'}** (${scope})`,
        '',
        '| Page or file | Width | What changed |',
        '|---|---|---|',
        ...differences.map((d) => `| \`${cell(d.page)}\` | ${d.width ?? ''} | ${cell(d.what)} |`),
      ].join('\n')
    : `**No difference** (${scope})`;
  await writeFile(path.join(OUT, 'report.md'), report + '\n');
  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ pages: pages.length, otherFiles, viewports: VIEWPORTS, differences }, null, 2) + '\n',
  );
  console.log(report);
  return differences.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(2);
  },
);
