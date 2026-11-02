# @phonicscore/astro-kit

The shared foundation under every PhonicScore website. A site depends on this
package; when the kit changes, every site picks the change up on its next
`npm update` — no copying, no merging.

New site? Don't start here — start from PhonicScore's internal template,
[`phonicscore/astro-starter`](https://github.com/phonicscore/astro-starter), which is
already wired to the kit.

## What's in it

| Part | Import | What it gives a site |
|---|---|---|
| Integration preset | `@phonicscore/astro-kit` | astro-icon, the i18n-aware sitemap, SEO/GEO build checks + `llms.txt`, Tailwind v4, the content transforms — one line in `astro.config.mjs` |
| Share cards | `ogImages` option of the preset | a 1200×630 link-preview PNG for every page at `/og/<slug>.png`, themed per site; on by default |
| `SeoHead` | `…/components/SeoHead.astro` | title, description, canonical, hreflang, Open Graph + Twitter cards, schema.org graph, favicons |
| `Analytics` | `…/components/Analytics.astro` | Usermaven, cookieless (no banner), production-only; `src` and `trackingHost` for a proxy on the site's own domain |
| `track()` | `…/lib/track.js` | Usermaven custom events for goals and funnels (a file opened, a result downloaded); does nothing without `Analytics` |
| `Breadcrumbs`, `Prose` | `…/components/*.astro` | visible breadcrumb trail; the wrapper for rendered Markdown |
| `FromVienna` | `…/components/FromVienna.astro` | the "From Vienna with music" sign-off for the bottom of every page, a link to https://phonicscore.com: `<FromVienna />` on dark grounds, `<FromVienna ink="original" />` on light ones; `class` sizes the link |
| Base styles | `…/styles/base.css` | underlined text links, long words that break, focus rings, the flyout hover bridge, layout for the content transforms |
| Content transforms | `…/lib/rehype-content.mjs` | rebuilds image grids, stat rows, cards, media splits and process steps from flat Markdown (applied by the preset) |
| Helpers | `…/lib/og.js`, `…/lib/i18n.js` | OG-card slugs; UI-string translator and locale-from-path |
| Contact Worker | `…/worker/contact.ts` + `schema.sql` | POST handler: honeypot, Turnstile, rate limit, D1 log, Resend delivery |
| Family palette | `…/styles/family.css`, `…/styles/themes/<product>.css` | opt-in: the stage every .music site shares, the four product keys, and each product's curtain and light |
| Dark mode | `…/components/ThemeHead.astro`, `ThemeToggle.astro`, `…/lib/score-scheme.js` | opt-in: light or dark before the first paint (the visitor's pick, else the system), the header toggle, OSMD scores in the site's dark tokens |
| Languages | `…/components/LanguageMenu.astro`, `…/worker/language.ts` | opt-in: the header's language menu (a pick is kept in the `lang` cookie) and the Worker that sends each visitor to their language |

Deliberately **not** in the kit: headers, footers, page templates and copy.
Each site owns its pages; the kit owns the plumbing. The one look that lives
here is the .music family palette, because several sites share it: a change
to it should reach phonicscore.com and the product site together. It reaches
a site only through an explicit import. The dark mode and language parts are
the behaviour and markup of two header controls; how they look is the site's.

## Using it

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import phonicscore from '@phonicscore/astro-kit';

export default defineConfig({
  site: 'https://example.music',
  trailingSlash: 'always',
  build: { format: 'directory' },
  i18n: { defaultLocale: 'en', locales: ['en', 'de'], routing: { prefixDefaultLocale: false } },
  integrations: [
    phonicscore({
      llms: { title: 'Example', summary: 'One sentence on what the site is.' },
      // Out of the sitemap and llms.txt: the contact form's pages.
      sitemapExclude: (page) => page.includes('/message'),
    }),
  ],
});
```

```css
/* src/styles/global.css */
@import 'tailwindcss';
@import '@phonicscore/astro-kit/styles/base.css';

@theme {
  --color-accent: #f78764; /* the kit's one required token: focus rings */
  /* …the site's own palette and type */
}
```

The preset reads `site` and `i18n` from your config, so the sitemap's language
alternates need no extra setup.

`sitemapExclude` receives each page's full URL
(`https://example.music/message/sent/`). A page it returns true for stays out
of the sitemap and out of `llms.txt`: use it for noindex utility pages such as
a form's "message sent" page. The 404 page is left out of both anyway.

### A .music product site

The family palette is "same stage, own curtain": every product keeps
phonicscore.com's stage (the warm dark ground, Bricolage Grotesque and Fragment
Mono, the same token names) and brings its own curtain (`grad-a` → `grad-b`)
and its own light (`accent`). Gold (`highlight`) is the call to action on every
curtain. One import gives a product site all of it:

```css
/* src/styles/global.css */
@import 'tailwindcss';
@import '@phonicscore/astro-kit/styles/base.css';
@import '@phonicscore/astro-kit/styles/themes/stimmt.css'; /* or spielbar, meistern, uben */
```

| Theme | Curtain | Light |
|---|---|---|
| `spielbar` · Berry | `#5c2149` → `#a94f74` | `#e49ac1` |
| `stimmt` · Petrol | `#15444d` → `#2b8482` | `#61c4c1` |
| `meistern` · Navy | `#1f2f5e` → `#4875a4` | `#91b7ea` |
| `uben` | its own Vienna system (Paper, and Night via `data-theme="night"`) | |

In a site made from the starter, the theme replaces the starter's `@theme`
block and the `color`/`background` lines of its `html` rule. The site still
loads its fonts itself (Fontsource, as phonicscore.com does). phonicscore.com
imports `styles/family.css` on its own: the stage and the four keys, which
its family band uses as `text-spielbar`, `text-uben`, `text-stimmt` and
`text-meistern`.

The rules that keep it one family are at the top of `styles/family.css`.
Every contrast pair was checked when the palette was set (2026-09-30): cream
copy is 7:1 or better on the first quarter of each curtain, and each light is
8.4:1 or better on `panel`.

## Share cards

Every page gets a link-preview card: a 1200×630 PNG at `/og/<slug>.png`, which
is where `SeoHead` points `og:image` (X falls back to it). The kit draws the
cards after the build with [astro-og-canvas](https://github.com/delucis/astro-og-canvas)
(canvaskit in WebAssembly, no browser). It reads every built page, and where
`og:image` points at `/og/…png` it writes that file: the title from
`og:image:alt` (SeoHead sets it to `seoTitle ?? title`, without the site-name
suffix), the meta description below it. So new pages, collection entries and
standalone `.astro` pages all get a card with nothing to list, and a card can
never point at a missing file. A card the site ships itself (`public/og/…`, or
its own route) is kept. In `astro dev` the same cards render on request.

On by default (Thomas, 2026-10-16: "every site gets it"), in a neutral look —
graphite, Inter, the site's name from `llms.title` — until the site themes it:

```js
phonicscore({
  llms: { title: 'OSMD for WordPress', summary: '…' },
  ogImages: {
    background: ['#9b32b8', '#902cab', '#6a1b7f'],
    logo: './src/assets/og-mark.svg',
    siteName: { text: 'OSMD for WordPress', font: './src/assets/fonts/poppins-latin-700.ttf' },
    title: { font: './src/assets/fonts/poppins-latin-700.ttf', color: '#ffffff' },
    text: { font: './src/assets/fonts/inter-latin-400.ttf', color: '#f3e1f8' },
  },
}),
```

| Option | Default | |
|---|---|---|
| `background` | `['#1c1c1f', '#2c2c31']` | one hex colour, or several for a top-to-bottom gradient |
| `accent` | none | hex colour of the 12px bar along the bottom edge |
| `logo` | none | `'./path'` or `{ path, width, height }`. SVG is rasterised by resvg at the exact size it is drawn (96px high by default) and its text is set in the card fonts; PNG/JPEG at its own size or `width` |
| `siteName` | `llms.title` when there is no logo | a string, `false`, or `{ text, font, color, size, weight, tracking }`. Next to a logo only when set; its size then defaults to half the logo's height. `tracking` is letter-spacing in em |
| `title` | Inter Bold, 60px, line height 1.15 | `{ font, color, size, weight, lineHeight }` |
| `text` | Inter Regular, 30px, line height 1.4 | the same |
| `padding` | `70` | px around the content |

- Colours left out follow the background: light text on a dark ground, dark
  text on a light one.
- **Fonts must be TTF or OTF**: canvaskit cannot read WOFF or WOFF2. Keep them
  in `src/assets/fonts/` (build time only, never shipped). Fontsource ships web
  fonts only; fontTools turns one into a TTF without changing it
  (`pip install fonttools brotli`, then
  `python3 -c "from fontTools.ttLib import TTFont as T; f=T('in.woff2'); f.flavor=None; f.save('out.ttf')"`).
  The weight defaults to the file's own. A variable font draws its default
  instance unless `weight` says otherwise: phonicscore.com names both weights,
  because Bricolage Grotesque's default instance is ExtraBold.
- `ogImages: false` switches the generator off. Pass `ogImages={false}` to
  `SeoHead` as well, or the pages point at cards nobody draws. The reverse is
  safe: a page whose `SeoHead` has `ogImages={false}` gets no card drawn.

## Dark mode and languages

Every new PhonicScore site gets the dark mode and the language menu of
musicxml.tools (Thomas, 2026-11-02), so these live here once: one
implementation and one Safari fix for musicxml.tools, opensheetmusicdisplay.org
and opensheetmusiceducation.org. All parts are opt-in, by import. The kit owns
what makes them work; the site passes everything that varies: the labels in
the page's language, its languages and the link to each, the paper colour per
mode, its tokens and the look of the two controls.

### Dark mode

The mode is `data-theme` on `<html>`: the visitor's pick from the toggle,
kept in localStorage `theme` only while it differs from the system, else the
system setting. `ThemeHead` sets it before the first paint, so put it in
`<head>` right after the viewport meta:

```astro
---
import ThemeHead from '@phonicscore/astro-kit/components/ThemeHead.astro';
---
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<ThemeHead themeColor={{ light: '#fbf9f6', dark: '#181614' }} />
```

`themeColor` is the page's ground in each mode, for the browser's own bars
(`theme-color`). The site's global.css holds both modes on the same attribute,
plus a `dark:` variant that follows it:

```css
@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));

@layer base {
  :root[data-theme='dark'] {
    color-scheme: dark;
    --color-paper: #181614;
    --color-ink: #efe9e0;
    --color-score: #211e1b; /* the ground under scores on screen */
  }
}
```

The toggle goes in the header, in the site's look:

```astro
---
import ThemeToggle from '@phonicscore/astro-kit/components/ThemeToggle.astro';
---
<ThemeToggle label={t('theme.label')} classes={{ button: 'pill w-[2.2rem] justify-center p-0', icon: 'size-[1.1rem]' }} />
```

| Prop | | |
|---|---|---|
| `label` | required | "Dark mode" in the page's language. The button is a switch: pressed in dark mode |
| `classes.button` | none | the button's look |
| `classes.icon` | 1.1rem | the size of the moon and the sun. Which one shows is the kit's |

Scores on screen follow with `lib/score-scheme.js`: in dark mode OSMD draws
in the site's `--color-ink` on its `--color-score` (other token names as
`scoreScheme({ ink, ground })`), and `onSchemeChange` calls back when the mode
changes, so an open score can draw again. Scores for paper (print previews,
downloads) leave it out.

```ts
import { scoreScheme, onSchemeChange } from '@phonicscore/astro-kit/lib/score-scheme.js';

const osmd = new OpenSheetMusicDisplay(container, { ...options, ...scoreScheme() });
onSchemeChange(() => {
  osmd.setOptions(scoreScheme());
  osmd.render();
});
```

### Language menu

English (or the site's default language) at the root, every other language
under its own prefix with the same paths: `/viewer/` in German is
`/de/viewer/`. The site knows its paths, so it passes each language with the
link to the same page in it, or to that language's home page where the page
doesn't exist (a blog in English only):

```astro
---
import LanguageMenu from '@phonicscore/astro-kit/components/LanguageMenu.astro';

const languages = locales.map((l) => ({
  code: l, // the path prefix and the `lang` cookie's value: "de"
  name: localeInfo[l].name, // in itself: "Deutsch"
  lang: localeInfo[l].htmlLang, // "de", "zh-Hans"
  hreflang: localeInfo[l].hreflang,
  href: localizePath(pageLanguages.includes(l) ? basePath(Astro.url.pathname) : '/', l),
}));
---
<LanguageMenu
  languages={languages}
  current={locale}
  label={t('lang.label')}
  classes={{
    summary: 'pill gap-1.5 max-sm:w-[2.2rem] max-sm:justify-center max-sm:p-0',
    icon: 'size-[1.05rem] shrink-0',
    name: 'max-sm:sr-only',
    list: 'mt-2 min-w-[10.5rem] rounded-xl border border-line-strong bg-surface p-1.5 shadow-lg',
    link: 'rounded-lg px-3 py-2 text-[0.85rem] text-ink hover:bg-surface-deep aria-[current]:font-semibold',
  }}
/>
```

| Prop | | |
|---|---|---|
| `languages` | required | `{ code, name, lang, hreflang, href }` per language, in the menu's order |
| `current` | required | the page's language: its name shows in the summary, its link is `aria-current` |
| `label` | required | "Language" in the page's language, read out before the current one |
| `classes` | none | `menu`, `summary`, `icon` (1.05rem without it), `name` (the current language's name; `max-sm:sr-only` leaves only the globe on phones), `list`, `link` |

The kit's own rules only make it a menu: the list drops down at the right
edge over the page, the summary has no disclosure triangle, the links are
blocks without an underline. They sit in the components layer and have no
specificity, so any class the site passes wins.

A pick goes into the `lang` cookie for a year, and the link keeps the page's
query and hash. Escape, a click elsewhere and tabbing out close the menu.
**Safari never focuses a link on a click or tap**: pressing one moves focus to
nothing (`focusout` with `relatedTarget` null). So the menu closes only when
focus moves to an element outside it; closing on "focus left" hid the link
before the click landed, and the menu was dead in Safari from 2026-10-29 to
2026-10-31 on musicxml.tools. Chrome focuses the link, so check click and tap
changes in Playwright's WebKit too, not only in Chrome.

### Language Worker

`worker/language.ts` sends each visitor to their language before any HTML
goes out: the `lang` cookie always wins; without one, a page in the default
language redirects to the first language of the browser's Accept-Language
that the site has; a page under a prefix is never redirected by the browser's
languages. Clicks within the site (Sec-Fetch-Site same-origin, else the
Referer), crawlers and link previews are never redirected, and neither is a
page that doesn't exist in the target language (it asks ASSETS first). The
redirect is a 302 that no cache keeps.

```ts
// worker/index.ts
import { createLanguageRedirect } from '@phonicscore/astro-kit/worker/language.ts';
import { locales, defaultLocale } from '../src/i18n/locales';

const languageRedirect = createLanguageRedirect({ locales, defaultLocale });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // …the site's own routes first
    return (await languageRedirect(request, env)) ?? env.ASSETS.fetch(request);
  },
};
```

`locales` is every language with the default one; `defaultLocale` (served at
the root) defaults to the first. The Worker has to see pages before the static
assets do: `"run_worker_first": ["/*", "!/_astro/*", …]` in `wrangler.jsonc`,
leaving out the folders that hold only files. `astro dev` runs no Worker:
test the redirect with `wrangler dev` on a build. Headless Chrome's user agent
says "HeadlessChrome" and counts as a bot, so give it a normal one when
testing redirects.

The site's privacy policy names both: `theme` in localStorage (only while the
pick differs from the system) and the `lang` cookie (a year, set only by a
pick in the menu). musicxml.tools has wording Thomas approved (2026-10-29).

## How changes reach the sites

1. Change the kit, add a line to `CHANGELOG.md`, bump `version` in `package.json`.
2. Commit, then tag: `git tag v1.2.0 && git push --follow-tags`.
3. In each site: `npm update @phonicscore/astro-kit`, build, commit the lockfile.

Sites depend on a **semver range of tags**, so step 3 takes fixes and features
automatically but never jumps a breaking release:

```json
"@phonicscore/astro-kit": "github:phonicscore/astro-kit#semver:^1.0.0"
```

Step 3 also happens on its own: the weekly dependency update below takes new
kit tags along with everything else.

Versioning rule (semver): **patch** for fixes; **minor** for features — a new
integration, a new component, a safe new default; **major** when any site has
to edit its own code to keep working. Write the migration step for a major
into the changelog. We started at 1.0.0 on purpose: on 0.x, npm reads `^0.1.0`
as "0.1.x only", so a site would never receive 0.2.0.

## Weekly dependency update

Every Monday at 05:00 UTC each site runs `npm update`, which takes every patch
and minor release its ranges allow (Astro, Tailwind, Wrangler, this kit, and
everything they depend on), never a major. The steps live in
`.github/workflows/dependency-update.yml`; a site calls them with a short
workflow of its own (the starter ships it):

```yaml
on:
  schedule:
    - cron: '0 5 * * 1'
  workflow_dispatch:
permissions:
  contents: write
  issues: write
jobs:
  update:
    uses: phonicscore/astro-kit/.github/workflows/dependency-update.yml@main
```

The run installs the site before and after the update with `npm ci`, the way
the hosts do, and builds both. `npm install` only warns about a peer conflict
that makes `npm ci` fail, so a lockfile has to pass `npm ci` here before it
can ship. Then `ci/visual-diff.mjs` compares the two builds:

- every page as a full-page screenshot at 1280 px and 390 px, pixel by pixel,
  rendered offline with motion reduced;
- every page's metadata (title, meta tags, canonical and alternate links,
  JSON-LD);
- console errors and exceptions that only the new build throws;
- every other file outside `_astro/` (sitemaps, robots.txt, llms.txt,
  `_headers`, share cards), byte for byte.

If nothing differs, the update is committed to `main`, which deploys the site.
If anything differs, or the new lockfile does not install or build, the
update waits on a branch `deps/<date>` and an issue, "Dependency update needs
a look", is assigned to `bukaznik` with the report; the before, after and
diff screenshots are the run's artifact. Merge the branch to ship it, or delete it to skip the week.

The run happens on GitHub's servers; no machine of ours needs to be on.

**Majors never ship on their own.** Most of what a major breaks (type checks,
the contact Worker, the deploy) does not show in a screenshot, and an Astro
major has to reach the kit's `peerDependencies` first. So the same run tries
each major the ranges hold back, alone on top of `main`, compares it the same
way, and leaves it on a branch `deps/major-<package>-<line>` with an issue,
"Major update: astro 7 → 8", holding the comparison and the release notes
link. Each major is asked about once: closing its issue skips it.

A major that another package's peer range rules out waits without an issue:
TypeScript 7 next to `@astrojs/check` 0.9, which accepts TypeScript 5 and 6
only, would not even install on the hosts, and there is nothing to decide
until `@astrojs/check` moves. The run tries again each week and asks once it
installs. If the kit's own peer range is what rules a major out, it asks
right away, because the kit has to move first.
To take one, read the release notes (for Astro: the upgrade guide, then
`npx @astrojs/upgrade`), then merge the branch or redo it by hand.

A run takes 2 to 5 minutes per site.

To try the comparison locally, with both checkouts installed:

```sh
ci/compare.sh <site>/before <site>/after out
```

## Rules for this repo

- **Nothing reaches a site unasked.** A URL, a brand colour or a product name
  in the preset or `base.css` would ship to every site; take it as an option
  instead. The family palette is the exception, and it only applies where a
  site imports it. The share cards are the other exception, by Thomas's
  decision (2026-10-16): the generator runs in every site unless it opts out,
  in a neutral look until the site themes it. It only writes the cards a
  page's `og:image` names, and never replaces a file the site ships.
  Accessibility defaults reach every site too (1.7.0: underlined text links,
  long words that break), as long as each one only changes what fails WCAG.
  The "From Vienna with music" sign-off links to https://phonicscore.com on
  every site, by Thomas's decision (2026-10-31), and so does "PhonicScore
  GmbH" in each site's own footer.
- **No Tailwind Plus code — ever.** This repository is public. The Tailwind Plus
  licence covers using its components in our own projects, not redistributing
  them — and a public package is redistribution. Components built from a
  Tailwind Plus block live in the (private) site repos; the raw export stays on
  the developer's machine and is gitignored here as a second line of defence.
- **Keep the preset's defaults safe to receive unattended.** Anything that could
  change a site's output in a surprising way should be opt-in.
- **Words in `components/` are Tailwind classes for every site.** `base.css`
  scans `../components` so the kit's own utilities get generated, and the
  scanner reads every word there, comments and CSS included: "flex-shrink" in
  a style block or "inline" in a comment adds a rule to every site's CSS,
  whether it uses the component or not. A component's own CSS goes in its
  `<style is:global>`, in the components layer with `:where()`, so only pages
  that render it get it and any site class beats it. Before a release, list
  what the change adds: Tailwind's `Scanner` (`@tailwindcss/oxide`) over the
  old and new `components/`, then the new candidates through each site's
  design system (`__unstable__loadDesignSystem` from `@tailwindcss/node` with
  its global.css, `candidatesToCss`). 1.11.0 adds only `sr-only`, which every
  site uses already.
