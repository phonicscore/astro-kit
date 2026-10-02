# Changelog

Versions are git tags, and follow semver: patch = fixes, minor = features
(new integrations and safe defaults included), major = a site has to change its
own code. Sites depend on `#semver:^1.0.0`, so every patch and minor reaches
them on `npm update` and no major ever does by surprise.

## 1.3.0 — 2026-10-02

The "From Vienna with love" sign-off, for the bottom of every PhonicScore page.

- **`components/FromVienna.astro`** with `assets/from-vienna-with-love-dim.svg`
  and `assets/from-vienna-with-love.svg`: St. Stephen's Cathedral in a circle
  over the caption, rebuilt from the 2021 artwork on opensheetmusicdisplay.org.
  The caption was live text in DIN Condensed, which only Apple devices have;
  elsewhere it fell back to a wide serif and was cut off after "VIENNA". It is
  now outlined at the original positions. The light shape that painted over
  the circle behind the cathedral is now a mask, so the badge sits on any
  ground. Two inks: dim for dark grounds (the default), the original warm grey
  for light ones; 11 KB each, lazy-loaded through `astro:assets`.
- Nothing changes for a site until it places the component.

## 1.2.0 — 2026-10-01

The .music family palette: same stage, own curtain. Opt-in, so no site
changes unless it imports a file.

- **`styles/family.css`**: the stage every family site shares (phonicscore.com's
  night, panel, panel-2, edge, chalk, dim, cream and gold, plus Bricolage
  Grotesque and Fragment Mono), three new shared tokens (`miss`, `score`,
  `score-ink`), the four product keys (`spielbar`, `uben`, `stimmt`,
  `meistern`) and the curtain utility `.bg-brand-gradient`.
- **`styles/themes/spielbar.css`, `stimmt.css`, `meistern.css`**: the stage plus
  each product's curtain (`grad-a` → `grad-b`) and light (`accent`,
  `accent-hover`, `on-accent`); one import per product site.
- **`styles/themes/uben.css`**: the UBEN Design System v2 colours and families,
  Paper and Night. Night redeclares the alias tokens (`link`, `affirm`,
  `negate`), which would otherwise keep their Paper colours inside a Night
  section; the focus ring is signal blue, because the kit's default takes
  `--color-accent` and Klimt gold is 2.5:1 on cream.
- README: the rule on brand values now reads "nothing reaches a site unasked";
  the family palette is the one look kept here, as opt-in files.

Verified: each theme built with Tailwind 4.3 from a local copy of the kit,
then checked in Chrome (ground, curtain, light, gold, focus ring; UBEN's Night
links, check marks and focus ring).

## 1.1.2 — 2026-09-30

A fix every site should take before analytics goes live.

- **Analytics never ran.** The Usermaven loader was written as `{`…`}` inside
  `<script is:inline>`. Astro emits script content as raw text, so the browser
  got a block holding an unused string: `window.usermaven` stayed undefined and
  the library never loaded — in every build since the snippet was first written,
  before the kit existed. The loader is now a plain string injected with
  `set:html`, and the key goes in through `JSON.stringify` with `<` escaped.
  Verified by executing the rendered script: the library is injected, and the
  cookieless `init` and the `pageview` are queued; a key containing
  `</script><script>` stays inert data. No data was lost — no site had a
  Usermaven key set yet.

## 1.1.1 — 2026-09-30

Documentation and repository hygiene only; no change to what sites build.

- README: corrected the Tailwind Plus rule. The licence is per person or team
  and covers any number of our own projects; what it forbids is redistributing
  the components, which a public package would be. This repository is public,
  so it must never contain Tailwind Plus code.
- .gitignore: `.tailwindplus/` is excluded, so the licensed export cannot be
  committed here by accident.

## 1.1.0 — 2026-09-24

Two things every site should have, now on by default. No site needs to change
anything to receive them.

- **robots.txt**, generated from the site's `site` URL and pointing at its
  sitemap. Skipped when a site ships its own `public/robots.txt`; opt out with
  `robots: false`.
- **Baseline `_headers`**: nosniff, referrer policy, permissions policy, frame
  options, HSTS, and immutable caching for hashed `/_astro/*` assets. Skipped
  when a site ships its own `public/_headers` — merging would double headers
  that Cloudflare then joins into invalid values. Opt out with `headers: false`.
  The permissions policy allows the microphone for the site itself
  (`microphone=(self)`): denying it would silently break listening demos.

## 1.0.0 — 2026-09-24

Extracted from phonicscore.com, the first site on the stack (decision 9 of the
phonicscore.com plan: "a shared package is extracted when the second site
starts").

- Integration preset: astro-icon, @astrojs/sitemap (i18n from the Astro config),
  @jdevalk/astro-seo-graph with all validators and llms.txt, Tailwind v4,
  rehype-content. The kit sets `markdown.processor: unified({...})` itself:
  Astro 7's default processor (Sätteri) ignores `markdown.rehypePlugins` when
  an integration adds them. Extra plugins go through the `rehypePlugins` option.
- Components: SeoHead, Analytics (Usermaven, cookieless), Breadcrumbs, Prose.
  Breadcrumbs colors itself only from inherited text and --color-accent, with a
  `classes` prop to match a site's own tokens.
- styles/base.css: focus rings, the flyout hover bridge, layout for the content
  transforms; `@source` so Tailwind generates the kit components' classes.
- lib: rehype-content, ogSlug, createTranslator, localeFromPath.
- Type declarations (`.d.ts`) beside the JavaScript, so sites type-check under
  `astro check` without the kit needing a build step.
- worker/contact.ts: createContactWorker — honeypot, Turnstile, D1 rate limit
  and log, Resend. The rate-limit window is now a bound parameter rather than
  interpolated into the SQL.
