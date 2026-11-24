/**
 * Tests for the proxy note (lib/analytics-check.js).
 *
 *   npm test
 *
 * Each test writes a small site folder to a temporary directory and runs the
 * check over it. The note is a warning: it never throws.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkAnalyticsProxy, findProxyCopies } from '../lib/analytics-check.js';

/** A site folder with `files` ({ relative path: text }), removed after `run`. */
async function withSite(files, run) {
  const root = await mkdtemp(path.join(tmpdir(), 'kit-analytics-check-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), text);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const logger = () => {
  const lines = [];
  return { lines, warn: (line) => lines.push(line) };
};

const OWN_COPY = `const EVENTS = 'https://events.usermaven.com';\nexport async function analytics(request) { return fetch(EVENTS); }\n`;
const KIT_PROXY = `import { createAnalyticsProxy } from '@phonicscore/astro-kit/worker/analytics.ts';\nexport const { isAnalyticsPath, analytics } = createAnalyticsProxy({ key: 'UMsitekey0' });\n`;

test('a Worker file with its own proxy gets one warning that names it and the README section', async () => {
  await withSite({ 'worker/analytics.ts': OWN_COPY, 'worker/index.ts': "import { analytics } from './analytics';\n" }, async (root) => {
    const log = logger();
    const files = await checkAnalyticsProxy(pathToFileURL(root + '/'), log);
    assert.deepEqual(files, ['worker/analytics.ts']);
    assert.equal(log.lines.length, 1);
    assert.match(log.lines[0], /^worker\/analytics\.ts sends events to events\.usermaven\.com/);
    assert.match(log.lines[0], /README "Usermaven proxy"/);
    assert.match(log.lines[0], /becomes a build failure in a later release/);
  });
});

test('a Worker that uses the kit\'s proxy is silent', async () => {
  await withSite({ 'worker/analytics.ts': KIT_PROXY, 'worker/index.ts': "import { analytics } from './analytics';\n" }, async (root) => {
    const log = logger();
    assert.deepEqual(await checkAnalyticsProxy(pathToFileURL(root + '/'), log), []);
    assert.deepEqual(log.lines, []);
  });
});

test('a file that imports the kit\'s proxy and names the host in a comment is silent', async () => {
  await withSite({ 'worker/analytics.ts': `// events go to events.usermaven.com through the kit\n${KIT_PROXY}` }, async (root) => {
    assert.deepEqual(await findProxyCopies(root), []);
  });
});

test('a site without a Worker folder, or without Usermaven in it, is silent', async () => {
  await withSite({ 'src/pages/index.astro': '<h1>x</h1>' }, async (root) => {
    const log = logger();
    assert.deepEqual(await checkAnalyticsProxy(root, log), []);
    assert.deepEqual(log.lines, []);
  });
  await withSite({ 'worker/index.ts': "export default { fetch: () => new Response('ok') };\n" }, async (root) => {
    assert.deepEqual(await findProxyCopies(root), []);
  });
});

test('copies in sub-folders are found, several in one warning; node_modules, dot folders and other files are not read', async () => {
  await withSite(
    {
      'worker/routes/um.ts': OWN_COPY,
      'worker/analytics.js': OWN_COPY,
      'worker/node_modules/x/index.js': OWN_COPY,
      'worker/.cache/old.ts': OWN_COPY,
      'worker/notes.md': 'events.usermaven.com',
      'src/lib/analytics.ts': OWN_COPY,
    },
    async (root) => {
      const log = logger();
      const files = await checkAnalyticsProxy(root, log);
      assert.deepEqual(files, ['worker/analytics.js', 'worker/routes/um.ts']);
      assert.equal(log.lines.length, 1);
      assert.match(log.lines[0], /^worker\/analytics\.js, worker\/routes\/um\.ts send events/);
    }
  );
});
