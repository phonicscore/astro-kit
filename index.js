// @ts-check
/**
 * @phonicscore/astro-kit — the foundation every PhonicScore site builds on.
 *
 * One integration brings the whole toolchain: icons, the i18n-aware sitemap,
 * the SEO/GEO checks + llms.txt, Tailwind v4 and the content transforms. A site
 * lists only `phonicscore({...})` in astro.config.mjs. Adding an integration
 * HERE reaches every site on its next `npm update @phonicscore/astro-kit` —
 * that is the whole point of this package, so keep site-specific values out.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import icon from 'astro-icon';
import sitemap from '@astrojs/sitemap';
import seoGraph from '@jdevalk/astro-seo-graph/integration';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import rehypeContent from './lib/rehype-content.mjs';

/**
 * @typedef {object} KitOptions
 * @property {{ title: string, summary: string }} llms
 *   Header of the generated llms.txt (what the site is, for generative engines).
 * @property {(page: string) => boolean} [sitemapExclude]
 *   Return true to leave a page out of the sitemap (e.g. noindex utility pages).
 * @property {Record<string, unknown>} [seo]
 *   Overrides merged into the astro-seo-graph options.
 * @property {any[]} [rehypePlugins]
 *   Extra rehype plugins, run after the kit's content transforms. Pass them
 *   here rather than in the site's config: the kit owns the Markdown processor.
 * @property {boolean} [robots]
 *   Generate /robots.txt pointing at the sitemap. Default true; skipped
 *   automatically when the site ships its own public/robots.txt.
 * @property {boolean} [headers]
 *   Write the baseline security + caching `_headers`. Default true; skipped
 *   automatically when the site ships its own public/_headers.
 */

/**
 * Baseline response headers for Cloudflare static assets.
 *
 * microphone=(self), not (): PhonicScore builds listening products. Denying the
 * microphone here would silently break any page that runs a live demo, and a
 * Permissions-Policy header is the last place anyone looks. `self` still lets
 * no third-party frame near it, and the browser still asks the visitor.
 */
const BASELINE_HEADERS = `# @phonicscore/astro-kit baseline. Ship public/_headers to replace it.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=(self)
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=31536000; includeSubDomains

# Hashed build assets never change: cache them hard.
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`;

/**
 * Astro's i18n locales are strings or `{ path, codes }`; the sitemap wants a
 * `{ pathSegment: hreflang }` map. Derived here so sites configure i18n once.
 * @param {Array<string | { path: string, codes: string[] }>} locales
 */
function sitemapLocales(locales) {
  return Object.fromEntries(
    locales.map((l) => (typeof l === 'string' ? [l, l] : [l.path, l.codes[0]]))
  );
}

/**
 * @param {KitOptions} options
 * @returns {import('astro').AstroIntegration}
 */
export default function phonicscore(options) {
  return {
    name: '@phonicscore/astro-kit',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, injectRoute, logger }) => {
        if (!config.site) {
          throw new Error('@phonicscore/astro-kit: set `site` in astro.config.mjs');
        }
        const siteUrl = config.site.replace(/\/$/, '');
        const exclude = options.sitemapExclude ?? (() => false);
        const i18n = config.i18n
          ? {
              i18n: {
                defaultLocale: config.i18n.defaultLocale,
                locales: sitemapLocales(config.i18n.locales),
              },
            }
          : {};

        updateConfig({
          integrations: [
            // Inline SVG icons: Iconify sets plus the site's own src/icons/.
            icon(),
            sitemap({ ...i18n, filter: (page) => !exclude(page) }),
            // Build-time SEO validation (warnings, never failures) + llms.txt.
            seoGraph({
              validateH1: true,
              validateUniqueMetadata: true,
              validateImageAlt: true,
              validateMetadataLength: true,
              validateInternalLinks: true,
              llmsTxt: {
                title: options.llms.title,
                siteUrl,
                summary: options.llms.summary,
                filter: (url) => !/\/404\/?$/.test(new URL(url).pathname),
              },
              ...options.seo,
            }),
          ],
          // Astro 7 made Sätteri the default Markdown processor and deprecated
          // `markdown.rehypePlugins`: added from an integration they are
          // dropped with only a one-time warning, because the default processor
          // is already chosen. Set the unified processor itself — Astro replaces
          // `markdown.processor` wholesale rather than merging it.
          markdown: {
            processor: unified({
              rehypePlugins: [rehypeContent, ...(options.rehypePlugins ?? [])],
            }),
          },
          vite: { plugins: [tailwindcss()] },
        });

        if (options.robots !== false) {
          if (existsSync(new URL('robots.txt', config.publicDir))) {
            logger.info('public/robots.txt found — using it instead of the generated one.');
          } else {
            injectRoute({
              pattern: '/robots.txt',
              entrypoint: '@phonicscore/astro-kit/routes/robots.txt.js',
            });
          }
        }
      },

      'astro:build:done': async ({ dir, logger }) => {
        if (options.headers === false) return;
        const file = new URL('_headers', dir);
        // A site that ships its own _headers keeps full control of it: merging
        // would double headers such as X-Frame-Options, which Cloudflare then
        // joins into an invalid value.
        if (existsSync(file)) {
          const own = await readFile(file, 'utf8');
          if (!own.includes('@phonicscore/astro-kit baseline')) {
            logger.info('public/_headers found — keeping it; the kit baseline is not added.');
          }
          return;
        }
        await writeFile(file, BASELINE_HEADERS);
      },
    },
  };
}
