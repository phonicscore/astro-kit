// @ts-check
/**
 * The site header that stays at the top of the window while the page scrolls
 * (components/StickyHeader.astro, which calls `watchStickyHeader`).
 *
 * `--sticky-header-h` on <html> is the header's height while it sticks and
 * 0px while it doesn't: on a short screen, or where the site lets it scroll
 * away at some widths. The kit's rules use it for the page's scroll padding and
 * the open language menu's height; a site uses it for its other sticky bars.
 * `visibleTop` is for scripts that scroll something into view themselves.
 */

/** The page's sticky header, if it has one (an embed has none). */
function stickyHeader() {
  const header = document.querySelector('[data-sticky-header]');
  return header instanceof HTMLElement ? header : null;
}

/**
 * The top of the part of the window the header leaves free: the header's
 * bottom edge while any of it shows, else 0 (scrolled away, or no header).
 * For a script that brings something into view with `window.scrollBy`, such as
 * a playback cursor, which scroll padding does not reach.
 */
export function visibleTop() {
  const header = stickyHeader();
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

/**
 * Keeps `--sticky-header-h` current: now, when the header's size changes (the
 * menu wraps to another row, the language changes the words) and when the
 * window's does (whether the header sticks can depend on the screen).
 */
export function watchStickyHeader() {
  const header = stickyHeader();
  if (!header) return;
  const root = document.documentElement;
  const update = () => {
    const { position } = getComputedStyle(header);
    const sticks = position === 'sticky' || position === 'fixed';
    root.style.setProperty('--sticky-header-h', sticks ? `${header.getBoundingClientRect().height}px` : '0px');
  };
  update();
  new ResizeObserver(update).observe(header);
  addEventListener('resize', update, { passive: true });
}
