# Changelog

Versions are git tags, and follow semver: patch = fixes, minor = features
(new integrations and safe defaults included), major = a site has to change its
own code. Sites depend on `#semver:^1.0.0`, so every patch and minor reaches
them on `npm update` and no major ever does by surprise.

## 1.10.0 — 2026-10-31

- **`FromVienna` links to https://phonicscore.com** on every site (Thomas,
  2026-10-31). `class` now goes on the link instead of the image: a site sizes
  it as before (`w-24`) and the artwork fills it, and a light/dark switch
  (uben.music shows both inks) hides the link itself, so no invisible link
  takes keyboard focus. The rules have no specificity, so a site's classes
  win; without a class the link is `width` px wide. The alt text names the
  company: "PhonicScore: From Vienna with music". Each site links "PhonicScore
  GmbH" in its own footer to the same address.

## 1.9.0 — 2026-10-29

- **`track()` sends custom events to Usermaven** (`lib/track.js`), for goals
  and funnels: a file opened, a result downloaded. It calls the
  `window.usermaven` queue that `Analytics` sets up, so events take the page
  views' way (a site's own-domain proxy included), and it does nothing in the
  dev server, previews and local builds. Properties stay values from a short,
  fixed list, never personal data. musicxml.tools counts six steps in its
  tools with it.

## 1.8.0 — 2026-10-26

- **`Analytics` works with Usermaven's current script.** The script now reads
  its settings from data attributes on its own tag and starts itself; the kit's
  `usermaven("init", …)` call went nowhere, so no site could have counted a
  visit (none had a key set yet). The loader sets `data-key`,
  `data-tracking-host`, `data-autocapture`, cookieless
  `data-privacy-policy="strict"` and `data-ip-policy="strict"` (Usermaven
  drops the last part of the IP address before processing).
- **`Analytics` takes `src` and `trackingHost`** for a proxy on the site's own
  domain, so the browser makes no third-party request: musicxml.tools serves
  `/um/lib.js` and `/um/api/…` from its Worker. Defaults are Usermaven's hosts.

## 1.7.0 — 2026-10-26

Accessibility defaults. axe-core (WCAG 2.2 AA and best practice) on every
page of musicxml.tools, uben.music, phonicscore.com and osmd-wp.com found the
same problems on each site, and they came from the kit or from the Tailwind
reset the kit sets up. These are safe defaults rather than options because
each one only changes what fails WCAG today.

- **`styles/base.css`: links in running text are underlined.** Tailwind's
  preflight sets `text-decoration: inherit` on every link, so a link inside a
  paragraph stood out by its color alone, at 1.07:1 to 2.9:1 against the text
  around it where WCAG asks for 3:1 or a second cue (axe:
  `link-in-text-block`, 34 links on uben.music, 23 on osmd-wp.com). The new
  rule underlines links without a class attribute,
  `a:where([href]:not([class]))`: Markdown writes text links that way, while
  buttons, menus and cards carry classes. It has the preflight rule's
  specificity and comes after it, so a site's own `a` rules still win.
- **`styles/base.css`: long words break.** `html { overflow-wrap: break-word }`:
  a word wider than its line, such as an email address or a German compound
  at heading size on a phone, breaks instead of pushing the page sideways
  (WCAG reflow: no horizontal scrolling at 320px). Only a word that cannot
  fit a line on its own is broken.
- **`styles/base.css`: the media split holds its phone column to the page.**
  Below 768px `.prose .media-split` had no column template, and the implicit
  column grew to the longest word in it: "OpenSheetMusicDisplay" in a heading
  pushed phonicscore.com's /solutions/ 14px past a 320px screen. It now has
  `grid-template-columns: minmax(0, 1fr)`; where nothing overflowed, nothing
  moves.
- **`components/Breadcrumbs.astro`: links at full contrast by default.** The
  default dimmed the site's link color with `opacity-70`: osmd-wp.com's purple
  came out at 3.63:1 and musicxml.tools' blue at 2.77:1, where text needs
  4.5:1. Ancestors now keep the site's link color at full strength and
  underline on hover (`no-underline hover:underline`). A site that passes
  `classes` sees no change.

What a site sees on update:
- uben.music: underlines under the text links of its legal pages and its 404
  page. Its breadcrumbs: none on the site.
- osmd-wp.com: underlines under its text links (legal pages, account, pricing,
  welcome, the demo's credits), and the breadcrumbs on imprint, privacy and
  terms in the full purple (#902cab, 6.7:1) instead of 70% of it.
- phonicscore.com: its prose links were underlined already; the link on the
  404 page gets one. Its breadcrumbs pass their own classes and stay. On
  /solutions/ and /de/produkte/ at 320px, the media split stops overflowing.
- musicxml.tools: no visible change. It underlines every link itself and
  passes its own breadcrumb classes.
- The starter: underlines under classless links in text, breadcrumbs in the
  full link color.
- Long words break only where they overflowed before.

Verified with axe-core 4.14 on production builds, each site on this version
plus its own fixes (branch `accessibility-pass` in each repo): 0 violations on
all 27 pages of uben.music (Paper and Night, 1280 and 375px) and on all 9 of
osmd-wp.com (1280, 800 and 375px, the score demo loaded as well). On
phonicscore.com's 64 pages the one rule left is heading order on six service
pages, which needs a design call. No page of the three scrolls sideways at
the widths checked, from 320 to 1280px.

The uben theme puts labels on green in white, on a darker green, as the UBEN
Design System does since its version 13 and the iOS app since its Vienna step 1
(Thomas: "dunkleres grün mit weißer schrift passt", and for the site's
primary button "grün sieht bei beiden super aus").

- **`styles/themes/uben.css`**: new `--color-brand-deep` (`#5c694c`) for green
  fills that carry a label, so `bg-brand-deep` and its kin exist.
  `--color-on-brand` turns from black to white: 5.9:1 on `brand-deep`, the
  same in Paper and Night. `--color-brand` (`#6c7c59`, RAL 6011) stays for
  patterns, the grid and states; black (4.7:1) and white (4.5:1) only just
  pass on it, so nothing small sits there.

What a site sees on update: only sites that import `themes/uben.css`, which
today is uben.music alone. Nothing on its pages used `on-brand`, so nothing
moves until a rule asks for the new tokens; its primary button does, in its
own global.css.

## 1.5.1 — 2026-10-16

llms.txt now leaves out the pages a site keeps out of its sitemap. Its filter
dropped only the 404 page, so `sitemapExclude` stopped at the sitemap and
noindex utility pages were still listed for generative engines: osmd-wp.com's
/welcome/ (after the Freemius checkout) and /update-payment/ (failed-payment
recovery).

- **`index.js`**: the llms.txt filter drops the 404 page and every URL
  `sitemapExclude` returns true for. It hands `sitemapExclude` the URL in the
  form the sitemap filter gets (`new URL(…).href`, which percent-encodes a
  path such as `/de/über/`), so one rule matches a page in both places.
- README, `index.d.ts` and the JSDoc: `sitemapExclude` covers llms.txt too.

What a site sees on update: llms.txt loses the pages its sitemap already
leaves out. osmd-wp.com: /welcome/ and /update-payment/. phonicscore.com: the
four contact-form pages (/message/, /message/sent/, /de/message/,
/de/message/gesendet/). uben.music: nothing, because its own `seo.llmsTxt`
replaces the kit's; with 1.5.1 its `sitemapExclude` alone drops the same
pages, so that override can go. The starter: nothing, it has no /message pages.

Verified: osmd-wp.com built with this version lists 6 pages in llms.txt
instead of 8, without /welcome/ and /update-payment/: the same six as its
sitemap. Sitemap and built files unchanged, `astro check` clean. On
uben.music's 20 built pages, the kit's filter with its `sitemapExclude` keeps
exactly the 16 its override keeps.

## 1.5.0 — 2026-10-16

The sign-off now reads "From Vienna with music" (Thomas: "change the footer
claim from From Vienna with Love to FROM VIENNA WITH MUSIC … on all sites").

- **`assets/from-vienna-with-music.svg`** and **`-dim.svg`** replace the
  "with love" files. The cathedral is untouched. The caption is outlined again
  from DIN Condensed Bold with the font's kerning; that setting reproduces
  the old caption to within 0.005 units. "WITH MUSIC" is one letter longer, so
  the line is set at 12.31 instead of 13 units to keep the old width, edges and
  baseline. The artwork stays 100 × 83, so no site's layout moves.
- **`components/FromVienna.astro`**: new files, alt text "From Vienna with
  music". Every site that places `<FromVienna />` shows the new caption after
  `npm update`.

## 1.4.0 — 2026-10-16

Share cards for every site, on by default. Thomas: "move the card generator
into the kit … I even prefer to add it as default, so every site gets it".

- **`lib/og-cards.js`**: after the build the kit reads every page, and where
  `og:image` points at `/og/<slug>.png`, as `SeoHead`'s does, it writes that
  card: 1200×630, drawn by astro-og-canvas (canvaskit, no browser), the title
  from `og:image:alt` (the page title without the site-name suffix) and the
  meta description below it. Ported from phonicscore.com's own route
  (`src/pages/og/[...route].png.ts`): same renderer, same layout and sizes.
  What changed is how pages are found: from the built HTML instead of a list
  in each site, so collection entries and standalone `.astro` pages all get a
  card with nothing to maintain, and no tag points at a missing file.
  `astro dev` renders the same card on request.
- **`ogImages` option** themes it: `background` (one colour or a gradient),
  `accent` (bar along the bottom), `logo` (SVG rasterised by resvg-wasm, its
  text set in the card fonts; or PNG/JPEG), `siteName`, `title` and `text`
  (TTF/OTF; family and weight are read from the file), `padding`. With nothing
  set: graphite, Inter (OFL, in `assets/fonts/`, latin subset), the name from
  `llms.title`. `ogImages: false` switches the generator off.
- A card the site ships itself (`public/og/…`, or its own route) is kept, so
  phonicscore.com's route and the kit can't fight over a file.
- New dependencies: astro-og-canvas, @resvg/resvg-wasm (WebAssembly, no native
  binary, so the build is the same on macOS, Cloudflare and Alpine), entities.
- What a site sees on update: cards for every page whose `og:image` points at
  `/og/`. Sites made from the starter so far pass `ogImages={false}` to
  `SeoHead`; they get no cards until they drop that prop, since no card is
  drawn that no page points at.
- README: the "Share cards" section; the rule "nothing reaches a site unasked"
  now names this exception.

Verified: phonicscore.com with its route removed and the kit drawing its cards:
57 of 62 PNGs byte-identical to its own build; the other five (404 and the
four contact-form pages) now carry those pages' own title and description,
where the route had hand-written text. osmd-wp.com (7 pages), uben.music (20)
and the starter (5): every page's og:image points at a 1200×630 PNG that
exists, `astro check` clean. Cards from `astro dev` are byte-identical to the
built ones.

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
