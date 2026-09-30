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
| Base styles | `…/styles/base.css` | focus rings, the flyout hover bridge, layout for the content transforms |
| Content transforms | `…/lib/rehype-content.mjs` | rebuilds image grids, stat rows, cards, media splits and process steps from flat Markdown (applied by the preset) |
| Helpers | `…/lib/og.js`, `…/lib/i18n.js` | OG-card slugs; UI-string translator and locale-from-path |
| Contact Worker | `…/worker/contact.ts` + `schema.sql` | POST handler: honeypot, Turnstile, rate limit, D1 log, Resend delivery |

Deliberately **not** in the kit: anything that carries a brand — headers,
footers, page templates, design tokens, copy. Each site owns its look; the kit
owns the plumbing.

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

- **No site-specific values.** A URL, a brand color or a product name in here
  would ship to every site. Take it as an option instead.
- **No Tailwind Plus code — ever.** This repository is public. The Tailwind Plus
  licence covers using its components in our own projects, not redistributing
  them — and a public package is redistribution. Components built from a
  Tailwind Plus block live in the (private) site repos; the raw export stays on
  the developer's machine and is gitignored here as a second line of defence.
- **Keep the preset's defaults safe to receive unattended.** Anything that could
  change a site's output in a surprising way should be opt-in.
