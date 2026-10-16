import type { AstroIntegration } from 'astro';

/** A canvaskit font weight. Defaults to the weight of the font file itself. */
export type OgCardWeight =
  | 'Thin'
  | 'ExtraLight'
  | 'Light'
  | 'Normal'
  | 'Medium'
  | 'SemiBold'
  | 'Bold'
  | 'ExtraBold'
  | 'Black';

export interface OgCardText {
  /** TTF or OTF file, relative to the project root (canvaskit cannot read WOFF/WOFF2). */
  font?: string;
  /** Hex colour, e.g. "#ffffff". Defaults follow the background: light text on dark, dark on light. */
  color?: string;
  /** Pixel size: title 60, text 30. */
  size?: number;
  weight?: OgCardWeight;
  /** Title 1.15, text 1.4. */
  lineHeight?: number;
}

/** The look of the share cards. Leave everything out for the neutral default. */
export interface OgImagesOptions {
  /** One hex colour, or a top-to-bottom gradient of several. Default: graphite. */
  background?: string | string[];
  /** Hex colour of the 12px bar along the bottom edge. Default: none. */
  accent?: string | false;
  /**
   * Logo at the top left: SVG (rasterised at build time, its text set in the
   * card fonts), PNG or JPEG, relative to the project root. An SVG is drawn
   * 96px high unless `width` or `height` says otherwise; a PNG/JPEG at its own size.
   */
  logo?: string | { path: string; width?: number; height?: number } | false;
  /**
   * The site's name, in the text font. Shown on its own when there is no logo
   * (default: `llms.title`), next to the logo only when set here. `tracking`
   * is letter-spacing in em; `size` defaults to half the logo's height.
   */
  siteName?:
    | string
    | false
    | {
        text?: string;
        font?: string;
        color?: string;
        size?: number;
        weight?: OgCardWeight;
        tracking?: number;
      };
  /** The page title: og:image:alt (SeoHead sets it to the page title), else og:title. Default: Inter Bold. */
  title?: OgCardText;
  /** The meta description under it. Default: Inter Regular. */
  text?: OgCardText;
  /** Space around the content, in px. Default 70. */
  padding?: number;
}

export interface KitOptions {
  /** Header of the generated llms.txt — what the site is, for generative engines. */
  llms: { title: string; summary: string };
  /**
   * Return true to leave a page out of the sitemap and llms.txt (e.g. noindex
   * utility pages). Receives the page's full URL.
   */
  sitemapExclude?: (page: string) => boolean;
  /** Overrides merged into the astro-seo-graph options. */
  seo?: Record<string, unknown>;
  /** Extra rehype plugins, run after the kit's content transforms. */
  rehypePlugins?: unknown[];
  /** Generate /robots.txt (default true; skipped if public/robots.txt exists). */
  robots?: boolean;
  /** Write baseline security + caching headers (default true; skipped if public/_headers exists). */
  headers?: boolean;
  /**
   * Share cards at /og/<slug>.png for every page whose og:image points there.
   * On by default (neutral look); theme them here, or `false` to switch off.
   */
  ogImages?: false | OgImagesOptions;
}

/** The PhonicScore toolchain as one Astro integration. */
export default function phonicscore(options: KitOptions): AstroIntegration;
