/**
 * Slug for a page's generated Open Graph card. SeoHead derives it from the
 * pathname for og:image, and the kit's card generator (lib/og-cards.js) writes
 * the file og:image names, so every page's og:image points at its own card.
 *
 *   "/"                          -> "index"   -> /og/index.png
 *   "/de/"                       -> "de"      -> /og/de.png
 *   "/services/ai-development/"  -> "services/ai-development"
 *
 * @param {string} pathOrPermalink
 */
export function ogSlug(pathOrPermalink) {
  const s = pathOrPermalink.replace(/^\/+|\/+$/g, '');
  return s === '' ? 'index' : s;
}
