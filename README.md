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
| `SeoHead` | `…/components/SeoHead.astro` | title, description, canonical, hreflang, Open Graph + Twitter cards, schema.org graph, favicons |
| `Analytics` | `…/components/Analytics.astro` | Usermaven, cookieless (no banner), production-only |
| `Breadcrumbs`, `Prose` | `…/components/*.astro` | visible breadcrumb trail; the wrapper for rendered Markdown |
| `FromVienna` | `…/components/FromVienna.astro` | the "From Vienna with love" sign-off for the bottom of every page: `<FromVienna />` on dark grounds, `<FromVienna ink="original" />` on light ones |
| Base styles | `…/styles/base.css` | focus rings, the flyout hover bridge, layout for the content transforms |
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

## How changes reach the sites

1. Change the kit, add a line to `CHANGELOG.md`, bump `version` in `package.json`.
2. Commit, then tag: `git tag v1.2.0 && git push --follow-tags`.
3. In each site: `npm update @phonicscore/astro-kit`, build, commit the lockfile.

Sites depend on a **semver range of tags**, so step 3 takes fixes and features
automatically but never jumps a breaking release:

```json
"@phonicscore/astro-kit": "github:phonicscore/astro-kit#semver:^1.0.0"
```

Versioning rule (semver): **patch** for fixes; **minor** for features — a new
integration, a new component, a safe new default; **major** when any site has
to edit its own code to keep working. Write the migration step for a major
into the changelog. We started at 1.0.0 on purpose: on 0.x, npm reads `^0.1.0`
as "0.1.x only", so a site would never receive 0.2.0.

## Rules for this repo

- **Nothing reaches a site unasked.** A URL, a brand colour or a product name
  in the preset or `base.css` would ship to every site; take it as an option
  instead. The family palette is the exception, and it only applies where a
  site imports it.
- **No Tailwind Plus code — ever.** This repository is public. The Tailwind Plus
  licence covers using its components in our own projects, not redistributing
  them — and a public package is redistribution. Components built from a
  Tailwind Plus block live in the (private) site repos; the raw export stays on
  the developer's machine and is gitignored here as a second line of defence.
- **Keep the preset's defaults safe to receive unattended.** Anything that could
  change a site's output in a surprising way should be opt-in.
