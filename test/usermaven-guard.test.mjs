/**
 * Tests for the Usermaven storage guard (lib/usermaven-guard.js).
 *
 *   npm test
 *
 * Each test builds a small window with a Storage that behaves like the
 * browser's: `setItem` and the rest live on Storage.prototype, items are kept
 * in a Map. The guard runs as the text `Analytics` puts in the page, in a
 * fresh context, the way a browser runs an inline script.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { usermavenGuard } from '../lib/usermaven-guard.js';

/** A window with a working localStorage, prefilled with `items`. */
function makeWindow(items = {}) {
  class Storage {
    constructor() {
      this.items = new Map(Object.entries(items));
    }
    get length() {
      return this.items.size;
    }
    key(i) {
      return [...this.items.keys()][i] ?? null;
    }
    getItem(key) {
      return this.items.has(String(key)) ? this.items.get(String(key)) : null;
    }
    setItem(key, value) {
      this.items.set(String(key), String(value));
    }
    removeItem(key) {
      this.items.delete(String(key));
    }
  }
  return { Storage, localStorage: new Storage(), sessionStorage: new Storage() };
}

/** The guard as the page runs it: the inline script's text, in its own context. */
function run(win) {
  vm.runInNewContext(usermavenGuard, { window: win });
}

test('a usermaven_ write is dropped, other keys are stored', () => {
  const win = makeWindow();
  run(win);
  win.localStorage.setItem('usermaven_offline_queue_default_data', '[{"payload":{}}]');
  win.localStorage.setItem('usermaven_usermaven_KEY_data', '{}');
  win.sessionStorage.setItem('usermaven_x', '1');
  win.localStorage.setItem('theme', 'dark');
  win.localStorage.setItem('um_exclusion', 'true');
  win.localStorage.setItem('my_usermaven_note', 'kept');
  assert.deepEqual([...win.localStorage.items.keys()], ['theme', 'um_exclusion', 'my_usermaven_note']);
  assert.equal(win.localStorage.getItem('theme'), 'dark');
  assert.equal(win.sessionStorage.length, 0);
});

test('old queue entries are removed, everything else stays', () => {
  const win = makeWindow({
    usermaven_offline_queue_default_data: '[{"payload":{"event_type":"pageview"}}]',
    usermaven_offline_queue_other_data: '[]',
    theme: 'light',
    um_exclusion: 'true',
    usermaven_usermaven_KEY_data: '{}',
  });
  run(win);
  assert.deepEqual([...win.localStorage.items.keys()], ['theme', 'um_exclusion', 'usermaven_usermaven_KEY_data']);
});

test('a value written with a non-string key still goes through', () => {
  const win = makeWindow();
  run(win);
  win.localStorage.setItem(42, 'x');
  assert.equal(win.localStorage.getItem('42'), 'x');
});

test('a second run does not wrap twice', () => {
  const win = makeWindow();
  run(win);
  const once = win.Storage.prototype.setItem;
  run(win);
  run(win);
  assert.equal(win.Storage.prototype.setItem, once);
});

test('missing storage does not throw', () => {
  assert.doesNotThrow(() => run({}));
  // Storage exists, localStorage does not (an old or unusual browser).
  const { Storage } = makeWindow();
  const win = { Storage };
  assert.doesNotThrow(() => run(win));
  assert.notEqual(win.Storage.prototype.setItem.name, 'setItem', 'setItem is wrapped all the same');
});

test('blocked storage does not throw', () => {
  // Blocked site data: reading window.localStorage throws a SecurityError.
  const { Storage } = makeWindow();
  const blocked = {
    Storage,
    get localStorage() {
      throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });
    },
  };
  assert.doesNotThrow(() => run(blocked));
  // A storage whose every call throws (Safari private mode used to throw on setItem).
  const win = makeWindow({ usermaven_offline_queue_default_data: '[]' });
  for (const name of ['key', 'removeItem', 'setItem']) {
    win.Storage.prototype[name] = () => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    };
  }
  assert.doesNotThrow(() => run(win));
  // The browser's own error still reaches the caller for a key the guard lets through.
  assert.throws(() => win.localStorage.setItem('theme', 'dark'), { name: 'QuotaExceededError' });
  assert.doesNotThrow(() => win.localStorage.setItem('usermaven_x', '1'));
});

test('a Storage without setItem is left alone', () => {
  const win = { Storage: function Storage() {}, localStorage: { length: 0, key: () => null } };
  assert.doesNotThrow(() => run(win));
  assert.equal(win.Storage.prototype.setItem, undefined);
});

test('the inline script is one statement that can never close its tag', () => {
  assert.doesNotMatch(usermavenGuard, /</);
  assert.match(usermavenGuard, /^\(function\(w\)\{[^]*\}\)\(window\);$/);
  assert.doesNotThrow(() => new vm.Script(usermavenGuard));
});
