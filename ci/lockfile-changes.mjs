// @ts-check
/**
 * What `npm update` changed, as a Markdown list for the commit message and
 * the issue: the site's own dependencies one per line, the rest as a count.
 *
 *   node ci/lockfile-changes.mjs <before/package-lock.json> <after/package-lock.json>
 */
import { readFile } from 'node:fs/promises';

const [before, after] = await Promise.all(
  process.argv.slice(2, 4).map(async (file) => JSON.parse(await readFile(file, 'utf8')).packages),
);
const root = after[''];
const direct = new Set(Object.keys({ ...root.dependencies, ...root.devDependencies }));
const lines = [];
let others = 0;
for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
  const [from, to] = [before[key]?.version, after[key]?.version];
  if (!key || from === to) continue;
  const name = key.slice('node_modules/'.length);
  if (direct.has(name)) lines.push(`- ${name} ${from ?? '(new)'} → ${to ?? '(removed)'}`);
  else others++;
}
lines.sort();
if (others) lines.push(`- and ${others} package${others === 1 ? '' : 's'} they depend on`);
console.log(lines.join('\n'));
