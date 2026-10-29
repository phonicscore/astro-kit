/**
 * Custom events for Usermaven, for goals and funnels: what a visitor did on a
 * page, such as opening a file or downloading a result. `Analytics` sets up
 * `window.usermaven` (a queue until Usermaven's script has loaded) only in a
 * production build with a key, so in the dev server, previews and local builds
 * this does nothing. Events take the page views' way, through a site's
 * own-domain proxy when it has one.
 *
 * Properties are counted, not read: keep them to values from a short, fixed
 * list (a tool, a file format), never personal data such as a file name or
 * text a visitor typed.
 *
 * @param {string} event
 * @param {Record<string, string | number | boolean>} [properties]
 */
export function track(event, properties = {}) {
  globalThis.usermaven?.('track', event, properties);
}
