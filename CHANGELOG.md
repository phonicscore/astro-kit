# Changelog

Versions are git tags, and follow semver: patch = fixes, minor = features
(new integrations and safe defaults included), major = a site has to change its
own code. Sites depend on `#semver:^1.0.0`, so every patch and minor reaches
them on `npm update` and no major ever does by surprise.

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
