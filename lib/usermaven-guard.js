// @ts-check
/**
 * Keeps Usermaven's script from storing anything in the visitor's browser.
 * `Analytics` puts this text into its inline script, right before the loader,
 * so it runs before Usermaven's script executes.
 *
 * The script keeps a retry queue for events it could not send in localStorage
 * (`usermaven_offline_queue_default_data`), and every event passes through it.
 * Its own switch, `disableEventPersistence`, reaches its main store only, not
 * that queue, and it cannot be set through a data attribute on the script tag.
 * So the guard drops every write whose key starts with `usermaven_` (the queue,
 * and any other store of the script) and lets every other key through: the
 * site's own `theme` is stored as before. The script survives that by design:
 * its queue lives in memory and the storage only mirrors it. An event that
 * cannot be sent stays queued for the rest of the page and is lost on leaving
 * it. Entries from earlier visits (`usermaven_offline_queue_*`) are removed
 * once. Storage is allowed without consent by § 165 (3) TKG 2021 only where it
 * is strictly necessary for what the visitor asked for; a buffer for
 * statistics is not (Thomas, 2026-11-17).
 *
 * It wraps `Storage.prototype.setItem` and never assigns to `localStorage`
 * itself: on a Storage object that would store an item. It never throws, so a
 * missing or blocked storage (private mode, blocked site data) changes
 * nothing, and it runs once per page however often `Analytics` is rendered.
 * It names no minified part of the script, so it outlives its versions.
 *
 * It is a string, not a function turned into text: the site's bundler rewrites
 * a function's source, but never the content of a string, so the page gets
 * exactly the code the tests run (test/usermaven-guard.test.mjs).
 */
export const usermavenGuard = [
  '(function(w){try{',
  'if(w.__usermavenInMemory)return;w.__usermavenInMemory=!0;',
  // Every write of the script's stores is dropped; all other keys go through.
  'var p=w.Storage&&w.Storage.prototype,set=p&&p.setItem;',
  'if(typeof set==="function")p.setItem=function(k){',
  'if(String(k).indexOf("usermaven_")===0)return;',
  'return set.apply(this,arguments)};',
  // The retry queue of earlier visits is removed.
  'var s=w.localStorage;for(var i=s.length-1;i>=0;i--){var k=s.key(i);',
  'if(k&&k.indexOf("usermaven_offline_queue_")===0)s.removeItem(k)}',
  '}catch(e){}})(window);',
].join('');
