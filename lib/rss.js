// @ts-check
/**
 * The feed rule (Thomas, 2026-11-19): a kit site that has a blog serves an
 * RSS feed, and its post pages link it. `rss()` writes an RSS 2.0 feed,
 * `rssResponse()` wraps it for an Astro endpoint such as
 * `src/pages/blog/rss.xml.ts`. No dependency: the same few lines every site
 * would otherwise copy. See README "Feeds".
 */

/** @param {string} s */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @param {string | Date} d */
const toDate = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) throw new Error(`@phonicscore/astro-kit rss: not a date: ${JSON.stringify(d)}`);
  return date;
};

/**
 * An RSS 2.0 feed, newest item first.
 * @param {import('./rss.d.ts').RssOptions} options
 * @returns {string}
 */
export function rss({ title, description, site, link, self, language, items }) {
  const abs = (/** @type {string} */ href) => new URL(href, site).href;
  const sorted = items
    .map((item) => ({ ...item, date: toDate(item.pubDate) }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${esc(title)}</title>`,
    `    <link>${esc(abs(link))}</link>`,
    `    <atom:link href="${esc(abs(self))}" rel="self" type="application/rss+xml" />`,
    `    <description>${esc(description)}</description>`,
    ...(language ? [`    <language>${esc(language)}</language>`] : []),
    ...(sorted.length ? [`    <lastBuildDate>${sorted[0].date.toUTCString()}</lastBuildDate>`] : []),
  ];
  for (const item of sorted) {
    const url = abs(item.link);
    lines.push(
      '    <item>',
      `      <title>${esc(item.title)}</title>`,
      `      <link>${esc(url)}</link>`,
      `      <guid isPermaLink="true">${esc(url)}</guid>`,
      `      <pubDate>${item.date.toUTCString()}</pubDate>`,
      ...(item.description ? [`      <description>${esc(item.description)}</description>`] : []),
      ...(item.author ? [`      <author>${esc(item.author)}</author>`] : []),
      ...(item.categories ?? []).map((c) => `      <category>${esc(c)}</category>`),
      '    </item>'
    );
  }
  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}

/**
 * `rss()` as the Response of an Astro endpoint.
 * @param {import('./rss.d.ts').RssOptions} options
 * @returns {Response}
 */
export function rssResponse(options) {
  return new Response(rss(options), { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
