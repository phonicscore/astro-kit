/**
 * Locale helpers shared by every site. Astro's built-in i18n does the routing;
 * these cover UI strings and reading the locale from a path.
 */

/**
 * A translator factory for a site's UI-string table. Missing keys fall back to
 * the default locale, so a half-translated locale never renders a blank.
 *
 * @template {string} K
 * @param {Record<string, Partial<Record<K, string>>>} ui
 * @param {string} defaultLocale
 */
export function createTranslator(ui, defaultLocale) {
  return (/** @type {string} */ locale) =>
    (/** @type {K} */ key) => ui[locale]?.[key] ?? ui[defaultLocale]?.[key] ?? key;
}

/**
 * The locale of a path: its first segment when that is a non-default locale,
 * otherwise the default (the default locale is served unprefixed).
 *
 * @param {string} pathname
 * @param {readonly string[]} locales
 * @param {string} defaultLocale
 */
export function localeFromPath(pathname, locales, defaultLocale) {
  const first = pathname.split('/').filter(Boolean)[0];
  return first && first !== defaultLocale && locales.includes(first) ? first : defaultLocale;
}
