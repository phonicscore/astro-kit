// @ts-check
/**
 * Light or dark: the system setting, unless the visitor picks the other mode
 * with the toggle (components/ThemeToggle.astro, which loads this module). The
 * pick is kept in localStorage `theme` only while it differs from the system;
 * toggling back to the system's mode clears it, so the page follows the system
 * again. The mode is data-theme on <html>, which the site's tokens read.
 * ThemeHead's inline script sets it before the first paint; this module keeps
 * it current, with the color-scheme and theme-color metas and the pressed
 * state of every toggle on the page (any element with data-theme-toggle).
 */

/** @typedef {'light' | 'dark'} Theme */

const KEY = 'theme';
const system = window.matchMedia('(prefers-color-scheme: dark)');
const root = document.documentElement;

/** @returns {Theme | null} */
function stored() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

let choice = stored();

/** @returns {Theme} */
const systemTheme = () => (system.matches ? 'dark' : 'light');
/** @returns {Theme} */
const currentTheme = () => choice ?? systemTheme();

function apply() {
  const theme = currentTheme();
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  // ThemeHead's theme-color meta carries the page's ground for both modes.
  const bars = document.querySelector('meta[name="theme-color"]');
  const ground = bars instanceof HTMLMetaElement ? bars.dataset[theme] : undefined;
  if (bars && ground) bars.setAttribute('content', ground);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

function toggle() {
  /** @type {Theme} */
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  choice = next === systemTheme() ? null : next;
  try {
    if (choice) localStorage.setItem(KEY, choice);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice holds until the next page.
  }
  apply();
}

for (const button of document.querySelectorAll('[data-theme-toggle]')) button.addEventListener('click', toggle);
system.addEventListener('change', apply);
// The same choice in every open tab.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY && event.key !== null) return;
  choice = stored();
  apply();
});
apply();
