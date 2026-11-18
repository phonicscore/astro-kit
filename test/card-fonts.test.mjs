/**
 * Tests for the default share-card fonts (assets/fonts/, lib/og-cards.js).
 *
 *   npm test
 *
 * A card's title and text are set in these two files unless the site passes
 * its own, and a letter the font lacks is drawn as an empty box. So every
 * letter of the sites' languages written in Latin script has to be in both:
 * Polish since 1.16.0. The test reads each font's character map (cmap,
 * format 4) itself, so nothing has to be installed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const FONTS = ['inter-latin-400.ttf', 'inter-latin-700.ttf'];

const LETTERS = {
  en: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  de: 'äöüßÄÖÜ',
  es: 'áéíñóúü¿¡ÁÉÍÑÓÚÜ',
  pt: 'ãâáàçéêíóôõúÃÂÁÀÇÉÊÍÓÔÕÚ',
  fr: 'àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ«»',
  it: 'àèéìòùÀÈÉÌÒÙ',
  pl: 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
  punctuation: '„“”‘’…·€',
};

/** The characters a TrueType or OpenType font maps to a glyph (cmap format 4: the Basic Multilingual Plane). */
function characters(buf) {
  const tables = buf.readUInt16BE(4);
  let cmap;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    if (buf.toString('latin1', at, at + 4) === 'cmap') cmap = buf.readUInt32BE(at + 8);
  }
  assert.ok(cmap !== undefined, 'the font has a cmap table');
  let sub;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const at = cmap + 4 + i * 8;
    const [platform, encoding, offset] = [buf.readUInt16BE(at), buf.readUInt16BE(at + 2), buf.readUInt32BE(at + 4)];
    if (platform === 3 && encoding === 1 && buf.readUInt16BE(cmap + offset) === 4) sub = cmap + offset;
  }
  assert.ok(sub !== undefined, 'the font has a Windows Unicode cmap of format 4');
  const segments = buf.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  const mapped = new Set();
  for (let s = 0; s < segments; s++) {
    const end = buf.readUInt16BE(ends + s * 2);
    const start = buf.readUInt16BE(starts + s * 2);
    const delta = buf.readUInt16BE(deltas + s * 2);
    const rangeAt = ranges + s * 2;
    const range = buf.readUInt16BE(rangeAt);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph;
      if (range === 0) glyph = (c + delta) & 0xffff;
      else {
        const g = buf.readUInt16BE(rangeAt + range + (c - start) * 2);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (glyph !== 0) mapped.add(String.fromCodePoint(c));
    }
  }
  return mapped;
}

for (const file of FONTS) {
  test(`${file} has every letter of the sites' Latin-script languages`, async () => {
    const mapped = characters(await readFile(new URL(`../assets/fonts/${file}`, import.meta.url)));
    for (const [language, letters] of Object.entries(LETTERS)) {
      const missing = [...letters].filter((c) => !mapped.has(c));
      assert.deepEqual(missing, [], `${file} lacks ${language} letters`);
    }
  });
}
