/**
 * Tests for the sticky header's helpers (lib/sticky-header.js).
 *
 *   npm test
 *
 * Each test sets up the few browser globals the helpers read: a document with
 * one header (or none), getComputedStyle, ResizeObserver and the window's
 * resize listener, so a test can change the header's size or position and
 * fire what the browser would fire.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleTop, watchStickyHeader } from '../lib/sticky-header.js';

/** A page with a header `height` px high whose bottom edge is at `bottom`, positioned `position`. */
function setUp({ header = true, height = 120, bottom = 120, position = 'sticky' } = {}) {
  const page = { height, bottom, position, observers: [], resize: [] };
  class FakeElement {
    getBoundingClientRect() {
      return { top: page.bottom - page.height, bottom: page.bottom, height: page.height };
    }
  }
  const props = new Map();
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    querySelector: (selector) => (header && selector === '[data-sticky-header]' ? new FakeElement() : null),
    documentElement: { style: { setProperty: (name, value) => props.set(name, value) } },
  };
  globalThis.getComputedStyle = () => ({ position: page.position });
  globalThis.ResizeObserver = class {
    constructor(callback) {
      page.observers.push(callback);
    }
    observe() {}
  };
  globalThis.addEventListener = (type, callback) => type === 'resize' && page.resize.push(callback);
  return { page, props };
}

test('visibleTop is the header bottom edge while it shows', () => {
  setUp({ bottom: 96 });
  assert.equal(visibleTop(), 96);
});

test('visibleTop is 0 once the header has scrolled away', () => {
  setUp({ bottom: -40, position: 'static' });
  assert.equal(visibleTop(), 0);
});

test('visibleTop is 0 on a page without the header (an embed)', () => {
  setUp({ header: false });
  assert.equal(visibleTop(), 0);
});

test('--sticky-header-h is the height while the header sticks', () => {
  const { props } = setUp({ height: 141.5 });
  watchStickyHeader();
  assert.equal(props.get('--sticky-header-h'), '141.5px');
});

test('--sticky-header-h is 0px while the header scrolls with the page', () => {
  const { props } = setUp({ position: 'static' });
  watchStickyHeader();
  assert.equal(props.get('--sticky-header-h'), '0px');
});

test('--sticky-header-h follows the header size and the window', () => {
  const { page, props } = setUp({ height: 120 });
  watchStickyHeader();
  page.height = 167; // the menu wrapped to a second row
  page.observers.forEach((callback) => callback());
  assert.equal(props.get('--sticky-header-h'), '167px');
  page.position = 'static'; // a narrower window, where the site lets it go
  page.resize.forEach((callback) => callback());
  assert.equal(props.get('--sticky-header-h'), '0px');
});

test('nothing happens on a page without the header', () => {
  const { props } = setUp({ header: false });
  watchStickyHeader();
  assert.equal(props.size, 0);
});
