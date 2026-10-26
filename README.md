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
| `Breadcrumbs`, `Prose` | `…/components/*.astro` | visible breadcrumb trail; the wrapper for rendered Markdown |
| `FromVienna` | `…/components/FromVienna.astro` | the "From Vienna with music" sign-off for the bottom of every page: `<FromVienna />` on dark grounds, `<FromVienna ink="original" />` on light ones |
| Base styles | `…/styles/base.css` | underlined text links, long words that break, focus rings, the flyout hover bridge, layout for the content transforms |
| Content transforms | `…/lib/rehype-content.mjs` | rebuilds image grids, stat rows, cards, media splits and process steps from flat Markdown (applied by the preset) |
| Helpers | `…/lib/og.js`, `…/lib/i18n.js` | OG-card slugs; UI-string translator and locale-from-path |
| Contact Worker | `…/worker/contact.ts` + `schema.sql` | POST handler: honeypot, Turnstile, rate limit, D1 log, Resend delivery |
| Family palette | `…/styles/family.css`, `…/styles/themes/<product>.css` | opt-in: the stage every .music site shares, the four product keys, and each product's curtain and light |

Deliberately **not** in the kit: headers, footers, page templates and copy.
Each site owns its pages; the kit owns the plumbing. The one look that lives
here is the .music family palette, because several sites share it: a change
to it should reach phonicscore.com and the product site together. It reaches
a site only through an explicit import.

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
- **No Tailwind Plus code — ever.** This repository is public. The Tailwind Plus
  licence covers using its components in our own projects, not redistributing
  them — and a public package is redistribution. Components built from a
  Tailwind Plus block live in the (private) site repos; the raw export stays on
  the developer's machine and is gitignored here as a second line of defence.
- **Keep the preset's defaults safe to receive unattended.** Anything that could
  change a site's output in a surprising way should be opt-in.
