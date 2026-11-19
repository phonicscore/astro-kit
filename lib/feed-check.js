// @ts-check
/**
 * The feed rule (Thomas, 2026-11-19): "if there is a blog, add a rss feed".
 * The preset runs `checkFeeds` after every build and fails it when a blog
 * post page (a schema.org BlogPosting about the page itself) does not link,
 * with <link rel="alternate" type="application/rss+xml">, a feed of the build
 * that lists the page. See README "Feeds".
 *
 * Found on 2026-11-19: sawti.app had posts in three languages and no feed,
 * phonicscore.com had a feed that no page linked.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LD_JSON = /<script\b[^>]*\btype=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const LINK_TAG = /<link\b[^>]*>/gi;
/** @param {string} tag @param {string} name */
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/g, '&') : undefined;
};

/** Same page, whatever the trailing slash, case of host or %-escaping. @param {string} url */
export const samePage = (url) => {
  try {
    const u = new URL(url);
    return `${u.host.toLowerCase().replace(/^www\./, '')}${decodeURI(u.pathname).replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
};

/** @param {unknown} value @param {(node: Record<string, unknown>) => void} visit */
function walk(value, visit) {
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value && typeof value === 'object') {
    const node = /** @type {Record<string, unknown>} */ (value);
    visit(node);
    for (const item of Object.values(node)) walk(item, visit);
  }
}

/** @param {unknown} ref */
const refId = (ref) =>
  typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? String(/** @type {any} */ (ref)['@id'] ?? '') : '';

/**
 * What a page says about itself: its canonical URL, whether it is a blog post
 * (a BlogPosting whose @id, url or mainEntityOfPage is the page; a blog's index
 * that lists BlogPosting nodes is not one), and the feeds it links.
 * @param {string} html
 * @returns {{ canonical?: string, isPost: boolean, feeds: string[] }}
 */
export function readPage(html) {
  let canonical;
  /** @type {string[]} */
  const feeds = [];
  for (const tag of html.match(LINK_TAG) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr(tag, 'href');
    if (!href) continue;
    if (rel.includes('canonical')) canonical ??= href;
    if (rel.includes('alternate') && /^application\/(rss|atom)\+xml$/i.test(attr(tag, 'type') ?? '')) feeds.push(href);
  }
  let isPost = false;
  if (canonical && html.includes('BlogPosting')) {
    const page = samePage(canonical);
    for (const [, json] of html.matchAll(LD_JSON)) {
      let data;
      try {
        data = JSON.parse(json);
      } catch {
        continue;
      }
      walk(data, (node) => {
        if (![node['@type']].flat().includes('BlogPosting')) return;
        const about = [refId(node['@id']).split('#')[0], refId(node.url), refId(node.mainEntityOfPage)];
        if (about.some((u) => u && samePage(new URL(u, canonical).href) === page)) isPost = true;
      });
    }
  }
  return { canonical, isPost, feeds };
}

/**
 * The page addresses a feed lists: RSS <item><link>, Atom <entry><link href>.
 * @param {string} xml
 */
export function feedLinks(xml) {
  /** @type {string[]} */
  const links = [];
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const m = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    if (m) links.push(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim().replace(/&amp;/g, '&'));
  }
  for (const [, entry] of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    for (const tag of entry.match(LINK_TAG) ?? []) {
      const rel = attr(tag, 'rel');
      const href = attr(tag, 'href');
      if (href && (!rel || rel === 'alternate')) links.push(href);
    }
  }
  return links;
}

/**
 * Read every HTML page of the build and fail it when a blog post is in no
 * feed it links.
 * @param {URL} dir the build output
 * @param {import('astro').AstroIntegrationLogger} logger
 */
export async function checkFeeds(dir, logger) {
  const out = fileURLToPath(dir);
  const files = await readdir(out, { recursive: true });
  /** @type {Map<string, Set<string> | null>} feed file -> pages it lists (null: missing) */
  const cache = new Map();
  /** @param {string} rel */
  const listed = async (rel) => {
    if (!cache.has(rel)) {
      try {
        const xml = await readFile(path.join(out, rel), 'utf8');
        cache.set(rel, new Set(feedLinks(xml).map(samePage)));
      } catch {
        cache.set(rel, null);
      }
    }
    return cache.get(rel);
  };
  let posts = 0;
  /** @type {string[]} */
  const problems = [];
  for (const file of files.filter((f) => f.endsWith('.html')).sort()) {
    const html = await readFile(path.join(out, file), 'utf8');
    const page = readPage(html);
    if (!page.isPost || !page.canonical) continue;
    posts++;
    const name = `/${file.split(path.sep).join('/')}`;
    if (!page.feeds.length) {
      problems.push(`${name}: links no feed (<link rel="alternate" type="application/rss+xml">; SeoHead's \`feeds\`)`);
      continue;
    }
    const origin = new URL(page.canonical).host.replace(/^www\./, '');
    let found = false;
    /** @type {string[]} */
    const why = [];
    for (const href of page.feeds) {
      const url = new URL(href, page.canonical);
      if (url.host.replace(/^www\./, '') !== origin) {
        why.push(`${href} is on another site`);
        continue;
      }
      const rel = decodeURI(url.pathname).replace(/^\/+/, '').replace(/\/$/, '/index.xml');
      const pages = await listed(rel);
      if (pages === null) why.push(`${href} is not in the build`);
      else if (pages && pages.has(samePage(page.canonical))) found = true;
      else why.push(`${href} does not list ${page.canonical}`);
    }
    if (!found) problems.push(`${name}: ${why.join('; ')}`);
  }
  if (problems.length) {
    throw new Error(
      `@phonicscore/astro-kit: ${problems.length} blog post${problems.length === 1 ? '' : 's'} without a feed. ` +
        `A site with a blog serves an RSS feed, and every post page links one that lists it; see the kit README, "Feeds".\n  ` +
        problems.join('\n  ')
    );
  }
  if (posts) logger.info(`${posts} blog post${posts === 1 ? '' : 's'} checked: each is in a feed it links.`);
}
