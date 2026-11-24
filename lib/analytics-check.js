// @ts-check
/**
 * The proxy note (README "Usermaven proxy"). A site that sends its statistics
 * through its own domain uses the kit's proxy (worker/analytics.ts), never a
 * copy of its own. The preset runs `checkAnalyticsProxy` after every build: a
 * file in the site's `worker/` folder that names events.usermaven.com and
 * does not import the kit's proxy gets one warning, naming the file.
 *
 * A warning, not a failure, for now: sites still carrying their own module
 * keep building while they move. A later release turns it into a failure.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM = 'events.usermaven.com';
const KIT_PROXY = '@phonicscore/astro-kit/worker/analytics';
const SOURCE = /\.(?:[cm]?[jt]s|tsx?)$/;

/**
 * The files under `dir` (relative to `root`) that name Usermaven's event host
 * and do not import the kit's proxy. node_modules and dot folders are skipped.
 * @param {string} root
 * @param {string} [dir]
 * @returns {Promise<string[]>}
 */
export async function findProxyCopies(root, dir = 'worker') {
  /** @type {string[]} */
  const found = [];
  /** @param {string} folder */
  async function walk(folder) {
    let entries;
    try {
      entries = await readdir(path.join(root, folder), { withFileTypes: true });
    } catch {
      return; // no Worker folder: nothing to check
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) await walk(rel);
      } else if (entry.isFile() && SOURCE.test(entry.name)) {
        const text = await readFile(path.join(root, rel), 'utf8').catch(() => '');
        if (text.includes(UPSTREAM) && !text.includes(KIT_PROXY)) found.push(rel.split(path.sep).join('/'));
      }
    }
  }
  await walk(dir);
  return found;
}

/**
 * One warning when the site's Worker carries its own Usermaven proxy. Never
 * throws.
 * @param {URL | string} root the project root (Astro's `config.root`)
 * @param {{ warn: (message: string) => void }} logger
 * @returns {Promise<string[]>} the files it warned about
 */
export async function checkAnalyticsProxy(root, logger) {
  const dir = typeof root === 'string' ? root : fileURLToPath(root);
  const files = await findProxyCopies(dir);
  if (files.length) {
    logger.warn(
      `${files.join(', ')} ${files.length === 1 ? 'sends' : 'send'} events to ${UPSTREAM} without the kit's proxy. ` +
        `Use createAnalyticsProxy from ${KIT_PROXY}.ts instead of an own copy: README "Usermaven proxy" of @phonicscore/astro-kit. ` +
        'This warning becomes a build failure in a later release.'
    );
  }
  return files;
}
