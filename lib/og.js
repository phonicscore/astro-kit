/**
 * Slug for a page's generated Open Graph card. The /og/ route keys its pages by
 * this, and SeoHead derives the same key from the pathname, so every page's
 * og:image points at the card built for it.
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
