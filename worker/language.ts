/**
 * The language redirect, shared by every PhonicScore site in more than one
 * language. It shows each visitor the site in their language, before any HTML
 * goes out:
 *
 * - A language picked in the language menu (components/LanguageMenu.astro) is
 *   in the `lang` cookie and always wins: any page redirects to the same page
 *   in that language.
 * - Without that pick, a page in the default language (the unprefixed URLs)
 *   redirects to the visitor's language when it is the first one in the
 *   browser's list that the site offers. "en-US, de" stays English, "de-AT, en"
 *   gets German. A page in another language is never redirected by the
 *   browser's languages: whoever opens /de/... asked for German.
 * - Only a visitor who comes from outside the site is redirected. A click on
 *   the site itself is a choice: the "English version" of a translated legal
 *   page, or English from the language menu, stays English.
 * - Crawlers are never redirected. Googlebot sends no Accept-Language and gets
 *   every page at its own address, the default language at the root.
 * - A page that doesn't exist in the target language stays as it is: the
 *   redirect asks ASSETS for it first, so a blog in English only never moves.
 *
 * The redirect is a 302 that no cache keeps. It relies on the paths mirroring
 * each other: /viewer/ in German is /de/viewer/.
 *
 *   // worker/index.ts in a site
 *   import { createLanguageRedirect } from '@phonicscore/astro-kit/worker/language.ts';
 *   const languageRedirect = createLanguageRedirect({ locales: ['en', 'de', 'fr'] });
 *   export default {
 *     async fetch(request, env) {
 *       return (await languageRedirect(request, env)) ?? env.ASSETS.fetch(request);
 *     },
 *   };
 *
 * The Worker has to see page requests before the static assets do:
 * "run_worker_first": ["/*", "!/_astro/*", ...] in wrangler.jsonc, leaving out
 * the folders that hold only files.
 *
 * Types are kept light so sites build without @cloudflare/workers-types.
 */

export interface LanguageEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export interface LanguageOptions {
  /** Every language of the site, as its path prefix: "de" serves /de/... The default language is one of them. */
  locales: readonly string[];
  /** The language served at the root, without a prefix. Default: the first of `locales`. */
  defaultLocale?: string;
}

/** Search engines, share-card fetchers and link previews: they must see each page as it is. */
const BOT =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|inspectiontool|googleother|facebookexternalhit|facebookcatalog|embedly|quora link preview|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegram|discord|skype|slack|lighthouse|pagespeed|chrome-lighthouse|headless|preview/i;

/** The first language of the Accept-Language header that is one of `locales`, by the browser's order. */
export function preferredLanguage(header: string | null, locales: readonly string[]): string | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      let q = 1;
      for (const param of params) {
        const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
        if (m) q = Number(m[1]);
      }
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    // Highest weight first; equal weights keep the browser's order.
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const language = tag.split('-')[0];
    if (locales.includes(language)) return language;
  }
  return null;
}

/** A navigation from one of the site's own pages (Sec-Fetch-Site, else the Referer). */
function fromThisSite(request: Request, url: URL): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin';
  try {
    return new URL(request.headers.get('Referer') ?? '').origin === url.origin;
  } catch {
    return false;
  }
}

export function createLanguageRedirect(options: LanguageOptions) {
  const locales = options.locales;
  const defaultLocale = options.defaultLocale ?? locales[0];
  const prefixed = locales.filter((l) => l !== defaultLocale);

  /** The language menu's pick, if it is one of the site's. */
  function cookieLanguage(header: string | null): string | null {
    const m = /(?:^|;\s*)lang=([\w-]+)(?:;|$)/.exec(header ?? '');
    return m && locales.includes(m[1]) ? m[1] : null;
  }

  /** The redirect to the visitor's language, or null to serve the page as it is. */
  return async function languageRedirect(request: Request, env: LanguageEnv): Promise<Response | null> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const url = new URL(request.url);
    // Pages only: their addresses end in a slash. Files and slashless forms go on as they are.
    if (!url.pathname.endsWith('/')) return null;
    if (BOT.test(request.headers.get('User-Agent') ?? '')) return null;
    if (fromThisSite(request, url)) return null;

    const first = url.pathname.split('/')[1];
    const current = prefixed.includes(first) ? first : defaultLocale;
    const base = current === defaultLocale ? url.pathname : url.pathname.slice(current.length + 1);

    const chosen = cookieLanguage(request.headers.get('Cookie'));
    const target =
      chosen ?? (current === defaultLocale ? preferredLanguage(request.headers.get('Accept-Language'), locales) : null);
    if (!target || target === current) return null;

    const path = target === defaultLocale ? base : `/${target}${base}`;
    // Only to a page that exists in that language.
    const probe = await env.ASSETS.fetch(new Request(new URL(path, url), { method: 'HEAD' }));
    if (probe.status !== 200) return null;

    return new Response(null, {
      status: 302,
      headers: {
        Location: path + url.search,
        'Cache-Control': 'private, no-store',
        Vary: 'Accept-Language, Cookie',
      },
    });
  };
}
