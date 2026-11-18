// @ts-check
/**
 * The video rule (Thomas, 2026-11-18): every schema.org VideoObject on a kit
 * site carries the fields Google's video results require (name, thumbnailUrl,
 * uploadDate), and uploadDate is the day the video was first published, set
 * in the site's source. The preset runs `checkVideos` after every build and
 * fails the build on a VideoObject that breaks it. See README "Videos".
 *
 * Found on sawti.app on 2026-11-18: three home pages without uploadDate, a
 * critical issue in Search Console's Videos report.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LD_JSON = /<script\b[^>]*\btype=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
// ISO 8601 date and time with a time zone: 2023-12-10T00:00:00.000Z, 2023-12-10T10:14:35+01:00.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Every node whose @type is or includes VideoObject, wherever it sits: in a
 * @graph, at the top, or nested (an Article's `video`).
 * @param {unknown} value
 * @param {Record<string, unknown>[]} [found]
 */
function videoNodes(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) videoNodes(item, found);
  } else if (value && typeof value === 'object') {
    const node = /** @type {Record<string, unknown>} */ (value);
    if ([node['@type']].flat().includes('VideoObject')) found.push(node);
    for (const item of Object.values(node)) videoNodes(item, found);
  }
  return found;
}

/** A non-empty string, or a list holding one. @param {unknown} value */
const text = (value) =>
  Array.isArray(value) ? value.some(text) : typeof value === 'string' && value.trim() !== '';

/**
 * The VideoObject nodes of one page and what is wrong with them.
 * @param {string} html
 * @param {number} buildStart when the build started (ms): an uploadDate at or
 *   after it is the build's own time (`new Date()` in a page) or the future
 * @returns {{ count: number, problems: string[] }}
 */
export function readVideos(html, buildStart) {
  let count = 0;
  /** @type {string[]} */
  const problems = [];
  for (const [, json] of html.matchAll(LD_JSON)) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      continue; // JSON-LD that does not parse is for other checks to report
    }
    for (const video of videoNodes(data)) {
      count++;
      const label = String(video['@id'] ?? video.name ?? 'VideoObject');
      for (const field of ['name', 'thumbnailUrl', 'uploadDate']) {
        if (!text(video[field])) problems.push(`${label}: no ${field}`);
      }
      const date = video.uploadDate;
      if (!text(date)) continue;
      if (typeof date !== 'string' || !ISO_WITH_ZONE.test(date) || Number.isNaN(Date.parse(date))) {
        problems.push(`${label}: uploadDate ${JSON.stringify(date)} is not an ISO 8601 time with a time zone`);
      } else if (Date.parse(date) >= buildStart) {
        problems.push(
          `${label}: uploadDate ${date} is not before the build started, so it is the build's own time or the future; set the day the video was first published`
        );
      }
    }
  }
  return { count, problems };
}

/**
 * Read every HTML page of the build and fail it when a VideoObject breaks the
 * rule.
 * @param {URL} dir the build output
 * @param {number} buildStart
 * @param {import('astro').AstroIntegrationLogger} logger
 */
export async function checkVideos(dir, buildStart, logger) {
  const out = fileURLToPath(dir);
  const files = (await readdir(out, { recursive: true })).filter((f) => f.endsWith('.html')).sort();
  let count = 0;
  /** @type {string[]} */
  const problems = [];
  for (const file of files) {
    const html = await readFile(path.join(out, file), 'utf8');
    if (!html.includes('VideoObject')) continue;
    const page = readVideos(html, buildStart);
    count += page.count;
    for (const problem of page.problems) problems.push(`/${file.split(path.sep).join('/')}: ${problem}`);
  }
  if (problems.length) {
    throw new Error(
      `@phonicscore/astro-kit: ${problems.length} VideoObject problem${problems.length === 1 ? '' : 's'}. ` +
        `Google's video results need name, thumbnailUrl and uploadDate (the day the video was first published, ` +
        `ISO 8601 with a time zone); see the kit README, "Videos".\n  ${problems.join('\n  ')}`
    );
  }
  if (count) logger.info(`${count} VideoObject${count === 1 ? '' : 's'} checked: name, thumbnailUrl and uploadDate set.`);
}
