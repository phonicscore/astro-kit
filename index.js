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
 */

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
      'astro:config:setup': ({ config, updateConfig }) => {
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
      },
    },
  };
}
