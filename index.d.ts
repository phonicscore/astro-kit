import type { AstroIntegration } from 'astro';

export interface KitOptions {
  /** Header of the generated llms.txt — what the site is, for generative engines. */
  llms: { title: string; summary: string };
  /** Return true to leave a page out of the sitemap (e.g. noindex utility pages). */
  sitemapExclude?: (page: string) => boolean;
  /** Overrides merged into the astro-seo-graph options. */
  seo?: Record<string, unknown>;
  /** Extra rehype plugins, run after the kit's content transforms. */
  rehypePlugins?: unknown[];
}

/** The PhonicScore toolchain as one Astro integration. */
export default function phonicscore(options: KitOptions): AstroIntegration;
