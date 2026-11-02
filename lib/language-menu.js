// @ts-check
/**
 * What the language menu does (components/LanguageMenu.astro, which loads this
 * module). A language chosen there goes into the `lang` cookie for a year: the
 * language Worker (worker/language.ts) reads it and opens every page in that
 * language from then on. The link keeps the page's query and hash, so a shared
 * ?url= or a filtered list stays. Escape, a click elsewhere and tabbing out
 * close the menu.
 */
const YEAR = 60 * 60 * 24 * 365;

for (const menu of /** @type {NodeListOf<HTMLDetailsElement>} */ (document.querySelectorAll('[data-language-menu]'))) {
  const summary = menu.querySelector('summary');

  menu.addEventListener('click', (e) => {
    const link = /** @type {Element} */ (e.target).closest('a[data-language]');
    if (!(link instanceof HTMLAnchorElement)) return;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `lang=${link.dataset.language}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
    link.href = link.pathname + location.search + location.hash;
  });

  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      summary?.focus();
    }
  });

  // Tabbing out of the open menu closes it, so the list doesn't cover the page.
  // Only focus that moves to an element outside counts. Safari never focuses a
  // link on a click or tap: pressing a language moves focus to nothing, and
  // closing the menu then would hide the link before the click lands on it.
  menu.addEventListener('focusout', (e) => {
    const next = /** @type {Node | null} */ (e.relatedTarget);
    if (menu.open && next && !menu.contains(next)) menu.open = false;
  });

  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(/** @type {Node} */ (e.target))) menu.open = false;
  });

  // The menu stays open until the chosen page comes, and browsers keep the page
  // as it was left for the Back button: close it on the way out.
  addEventListener('pagehide', () => {
    menu.open = false;
  });
}
