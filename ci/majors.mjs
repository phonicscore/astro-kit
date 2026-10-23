// @ts-check
/**
 * The majors a site's ranges hold back, for the weekly run: one per package,
 * as JSON for a job matrix. A 0.x minor counts as a major, as npm reads it
 * (^0.13 never takes 0.14). The kit is left out: its majors are ours to
 * release.
 *
 *   npm outdated --json | node ci/majors.mjs
 *
 * → [{"name":"typescript","from":"6.0.3","to":"7.0.2","line":"6 → 7","slug":"typescript-7"}]
 */
import { text } from 'node:stream/consumers';

const KIT = '@phonicscore/astro-kit';
const raw = (await text(process.stdin)).trim();
/** @type {Record<string, { current?: string, wanted: string, latest: string }>} */
const outdated = raw ? JSON.parse(raw) : {};

/** `7.0.2` → [7, 0]; prereleases and odd versions → null. */
const parse = (/** @type {string} */ v) => (/^(\d+)\.(\d+)\.\d+$/.exec(v ?? '') ?? []).slice(1).map(Number);
/** The release line a caret range stays on: `7` for 7.x, `0.13` for 0.13.x. */
const line = ([major, minor]) => (major > 0 ? `${major}` : `0.${minor}`);

const majors = [];
for (const [name, { current, wanted, latest }] of Object.entries(outdated)) {
  const [from, to] = [parse(wanted), parse(latest)];
  if (name === KIT || from.length < 2 || to.length < 2) continue;
  const ahead = to[0] > from[0] || (to[0] === 0 && from[0] === 0 && to[1] > from[1]);
  if (!ahead) continue;
  majors.push({
    name,
    from: current ?? wanted,
    to: latest,
    line: `${line(from)} → ${line(to)}`,
    slug: `${name.replace(/^@/, '').replace(/\//g, '-')}-${line(to)}`,
  });
}
console.log(JSON.stringify(majors));
