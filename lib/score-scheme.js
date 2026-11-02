// @ts-check
/**
 * Dark mode for the scores read on screen, through OSMD's own dark mode. In
 * dark mode (data-theme on <html>: ThemeHead and lib/theme.js) the music is
 * drawn in the site's ink on the site's score ground, two of its tokens,
 * instead of OSMD's white on black. The ground goes to OSMD as its page colour
 * rather than leaving the page transparent: tablature numbers sit on boxes of
 * that colour, and OSMD lifts the cursor above the music so the page doesn't
 * hide it. Scores meant for paper (print previews, downloads) leave this out
 * and stay black on white.
 *
 *   import { scoreScheme, onSchemeChange } from '@phonicscore/astro-kit/lib/score-scheme.js';
 *   const osmd = new OpenSheetMusicDisplay(container, { ...options, ...scoreScheme() });
 *   onSchemeChange(() => {
 *     osmd.setOptions(scoreScheme());
 *     osmd.render();
 *   });
 */

/**
 * OSMD's options for the page's current mode. `darkMode: false` also switches
 * a score back (setOptions). `ink` and `ground` name the site's tokens.
 *
 * @param {{ ink?: string, ground?: string }} [tokens]
 * @returns {{ darkMode: boolean, defaultColorMusic?: string, pageBackgroundColor?: string }}
 */
export function scoreScheme({ ink = '--color-ink', ground = '--color-score' } = {}) {
  const root = document.documentElement;
  if (root.dataset.theme !== 'dark') return { darkMode: false };
  const style = getComputedStyle(root);
  return {
    darkMode: true,
    defaultColorMusic: style.getPropertyValue(ink).trim(),
    pageBackgroundColor: style.getPropertyValue(ground).trim(),
  };
}

/**
 * Runs `callback` when the page switches between light and dark (the toggle or
 * the system), so an open score can follow.
 *
 * @param {() => void} callback
 */
export function onSchemeChange(callback) {
  new MutationObserver(callback).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}
