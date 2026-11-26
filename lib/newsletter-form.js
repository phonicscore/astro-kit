// @ts-check
/**
 * What the newsletter form does (components/NewsletterForm.astro, which loads
 * this module). The form's own submit is replaced by a fetch to the Worker
 * (worker/newsletter.ts), which answers {"ok":true} or {"ok":false,"error":…}.
 *
 * - ok: the field and the button go, the notice (confirm with the link in the
 *   mail, look in the spam folder) takes their place and gets the focus, so a
 *   screen reader reads it at once, and Usermaven gets
 *   `newsletter_signup_sent` with the page's language.
 * - not ok: the status line below the field says why ("invalid": check the
 *   address; anything else, the network included: try again), and the
 *   button works again.
 *
 * The button is off while a request is on its way, so a double click signs
 * up once.
 */
import { track } from './track.js';

for (const form of /** @type {NodeListOf<HTMLFormElement>} */ (document.querySelectorAll('form[data-newsletter]'))) {
  const row = /** @type {HTMLElement | null} */ (form.querySelector('[data-newsletter-row]'));
  const status = /** @type {HTMLElement | null} */ (form.querySelector('[data-newsletter-status]'));
  const sent = /** @type {HTMLElement | null} */ (form.querySelector('[data-newsletter-sent]'));
  const button = /** @type {HTMLButtonElement | null} */ (form.querySelector('button[type="submit"]'));
  if (!row || !status || !sent || !button) continue;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = '';
    /** @type {{ ok?: boolean, error?: string }} */
    let answer;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      answer = await res.json();
    } catch {
      answer = { ok: false, error: 'failed' };
    }
    if (answer?.ok) {
      row.hidden = true;
      sent.hidden = false;
      sent.focus();
      track('newsletter_signup_sent', { lang: form.dataset.lang ?? '' });
    } else {
      status.textContent = (answer?.error === 'invalid' ? form.dataset.invalid : form.dataset.failed) ?? '';
      button.disabled = false;
    }
  });
}
