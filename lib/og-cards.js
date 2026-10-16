// @ts-check
/**
 * Share cards: a 1200×630 PNG per page, drawn by astro-og-canvas (canvaskit,
 * no browser) after the build.
 *
 * The kit cannot know a site's pages before they are built (content
 * collections, getStaticPaths), so it reads them afterwards: every built HTML
 * page whose og:image points at /og/<slug>.png gets that file, with the title
 * from og:image:alt (SeoHead sets it to the page title, without the site-name
 * suffix) and the text from the meta description. SeoHead derives the slug
 * with ogSlug(), so the file and the tag always agree. A card that already
 * exists in the output (public/og/…, or a site's own route) is kept.
 *
 * In `astro dev` the same cards render on request at /og/<slug>.png.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeHTML } from 'entities';

const require = createRequire(import.meta.url);
const KIT_FONTS = fileURLToPath(new URL('../assets/fonts/', import.meta.url));

/**
 * @typedef {import('../index.js').OgImagesOptions} OgImagesOptions
 * @typedef {import('../index.js').OgCardWeight} Weight
 * @typedef {[number, number, number]} RGB
 * @typedef {{ title: string, description: string, dir: 'ltr' | 'rtl', image?: string }} Page
 */

/** The neutral card a site gets before it sets any option. */
const DEFAULTS = {
  background: ['#1c1c1f', '#2c2c31'],
  padding: 70,
  accentWidth: 12,
  title: { size: 60, lineHeight: 1.15, font: path.join(KIT_FONTS, 'inter-latin-700.ttf') },
  text: { size: 30, lineHeight: 1.4, font: path.join(KIT_FONTS, 'inter-latin-400.ttf') },
  onDark: { title: '#f4f4f5', text: '#c4c4cc' },
  onLight: { title: '#18181b', text: '#52525b' },
  logoHeight: 96,
  labelSize: 30,
};

const WEIGHTS = /** @type {const} */ ([
  [100, 'Thin'],
  [200, 'ExtraLight'],
  [300, 'Light'],
  [400, 'Normal'],
  [500, 'Medium'],
  [600, 'SemiBold'],
  [700, 'Bold'],
  [800, 'ExtraBold'],
  [900, 'Black'],
]);

/** @param {number} value */
function weightName(value) {
  return WEIGHTS.reduce((a, b) => (Math.abs(b[0] - value) < Math.abs(a[0] - value) ? b : a))[1];
}

/** @param {Weight} name */
function weightValue(name) {
  return WEIGHTS.find(([, n]) => n === name)?.[0] ?? 400;
}

/**
 * "#902cab" or "#fff" -> [144, 44, 171].
 * @param {string} color
 * @param {string} option
 * @returns {RGB}
 */
function rgb(color, option) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) {
    throw new Error(
      `@phonicscore/astro-kit: ogImages.${option} must be a hex colour such as "#902cab", got ${JSON.stringify(color)}.`
    );
  }
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return /** @type {RGB} */ ([0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
}

/** @param {RGB} c WCAG relative luminance */
function luminance(c) {
  const [r, g, b] = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {RGB} c */
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** @param {string} s */
const xml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * Family, weight and cap height of a TrueType/OpenType file. canvaskit and
 * resvg both pick fonts by family name and weight, so a site only names the
 * file. The family is name ID 16 when present, else ID 1, as FreeType reads it.
 * @param {Buffer} buf
 * @param {string} file
 */
function fontInfo(buf, file) {
  const sig = buf.toString('latin1', 0, 4);
  if (sig === 'wOFF' || sig === 'wOF2') {
    throw new Error(
      `@phonicscore/astro-kit: ${file} is a web font (${sig === 'wOF2' ? 'WOFF2' : 'WOFF'}). ` +
        'Share-card fonts must be TTF or OTF: canvaskit cannot read web fonts.'
    );
  }
  if (!['\0\x01\0\0', 'OTTO', 'true'].includes(sig)) {
    throw new Error(`@phonicscore/astro-kit: ${file} is not a TTF or OTF font.`);
  }
  /** @type {Record<string, number>} */
  const at = {};
  for (let i = 0, n = buf.readUInt16BE(4); i < n; i++) {
    const r = 12 + i * 16;
    at[buf.toString('latin1', r, r + 4)] = buf.readUInt32BE(r + 8);
  }
  /** @type {Record<number, { rank: number, value: string }>} */
  const names = {};
  if (at.name !== undefined) {
    const count = buf.readUInt16BE(at.name + 2);
    const strings = at.name + buf.readUInt16BE(at.name + 4);
    for (let i = 0; i < count; i++) {
      const r = at.name + 6 + i * 12;
      const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((o) =>
        buf.readUInt16BE(r + o)
      );
      if (id !== 1 && id !== 16) continue;
      const bytes = buf.subarray(strings + offset, strings + offset + length);
      let value, rank;
      if (platform === 3 || platform === 0) {
        value = Buffer.from(bytes).swap16().toString('utf16le');
        rank = platform === 3 && language === 0x409 ? 0 : 1;
      } else if (platform === 1 && encoding === 0) {
        value = bytes.toString('latin1');
        rank = 2;
      } else continue;
      if (!names[id] || rank < names[id].rank) names[id] = { rank, value };
    }
  }
  const family = (names[16] ?? names[1])?.value;
  if (!family) throw new Error(`@phonicscore/astro-kit: ${file} has no family name.`);
  const os2 = at['OS/2'];
  const weight = os2 === undefined ? 400 : buf.readUInt16BE(os2 + 4);
  const unitsPerEm = at.head === undefined ? 1000 : buf.readUInt16BE(at.head + 18);
  const capHeight =
    os2 !== undefined && buf.readUInt16BE(os2) >= 2 ? buf.readInt16BE(os2 + 88) / unitsPerEm : 0.7;
  return { family, weight, capHeight };
}

/** @param {Buffer} buf natural size of a PNG or JPEG */
function rasterSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return undefined;
}

/** @type {Promise<typeof import('@resvg/resvg-wasm')> | undefined} */
let resvgReady;
/** resvg in WebAssembly: no native binary, so it builds the same on macOS, Cloudflare and Alpine. */
function resvg() {
  resvgReady ??= import('@resvg/resvg-wasm').then(async (mod) => {
    await mod.initWasm(readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    return mod;
  });
  return resvgReady;
}

/**
 * Turn the site's options into what astro-og-canvas needs. Fonts are read and
 * the logo is rasterised once per build.
 * @param {{ options: OgImagesOptions, root: URL, cacheDir: URL, siteName: string }} input
 */
export async function createCards({ options: o, root, cacheDir: cacheUrl, siteName }) {
  const rootDir = fileURLToPath(root);
  const cacheDir = fileURLToPath(new URL('phonicscore-og/', cacheUrl));
  /** @param {string} p */
  const abs = (p) => path.resolve(rootDir, p);

  const background = [o.background ?? DEFAULTS.background].flat().map((c, i) => rgb(c, `background[${i}]`));
  // Default text colours follow the ground, so a light background alone never
  // leaves white text on cream.
  const mean = /** @type {RGB} */ ([0, 1, 2].map((i) => background.reduce((s, c) => s + c[i], 0) / background.length));
  const L = luminance(mean);
  const ink = 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? DEFAULTS.onDark : DEFAULTS.onLight;

  /** @type {Map<string, { buffer: Buffer, family: string, weight: number, capHeight: number }>} */
  const fonts = new Map();
  /** @param {string} file */
  async function font(file) {
    if (!fonts.has(file)) {
      if (!existsSync(file)) throw new Error(`@phonicscore/astro-kit: share-card font not found: ${file}`);
      const buffer = await readFile(file);
      fonts.set(file, { buffer, ...fontInfo(buffer, file) });
    }
    return /** @type {NonNullable<ReturnType<typeof fonts.get>>} */ (fonts.get(file));
  }

  /**
   * @param {{ font?: string, color?: string, size?: number, weight?: Weight, lineHeight?: number }} opts
   * @param {string} file
   * @param {{ color: string, size: number, lineHeight: number }} fallback
   * @param {string} option
   */
  async function role(opts, file, fallback, option) {
    const f = await font(file);
    return {
      file,
      family: f.family,
      weight: opts.weight ?? weightName(f.weight),
      capHeight: f.capHeight,
      color: rgb(opts.color ?? fallback.color, `${option}.color`),
      size: opts.size ?? fallback.size,
      lineHeight: opts.lineHeight ?? fallback.lineHeight,
    };
  }

  const titleFile = o.title?.font ? abs(o.title.font) : DEFAULTS.title.font;
  const textFile = o.text?.font ? abs(o.text.font) : DEFAULTS.text.font;
  const title = await role(o.title ?? {}, titleFile, { color: ink.title, ...DEFAULTS.title }, 'title');
  const text = await role(o.text ?? {}, textFile, { color: ink.text, ...DEFAULTS.text }, 'text');

  const logoOpt = !o.logo ? undefined : typeof o.logo === 'string' ? { path: o.logo } : o.logo;
  // The name shows next to the logo when set explicitly, and on its own when
  // there is no logo (llms.title by default).
  const nameOpt =
    o.siteName === false
      ? undefined
      : typeof o.siteName === 'string'
        ? { text: o.siteName }
        : (o.siteName ?? (logoOpt ? undefined : {}));
  const labelText = nameOpt && (nameOpt.text ?? siteName);
  const label =
    nameOpt && labelText
      ? {
          ...(await role(
            nameOpt,
            nameOpt.font ? abs(nameOpt.font) : textFile,
            { color: hex(title.color), size: 0, lineHeight: 1 },
            'siteName'
          )),
          text: labelText,
          tracking: nameOpt.tracking ?? 0,
          // Without a size, prepareLogo sizes the name to the logo.
          size: nameOpt.size,
        }
      : undefined;

  const accent = o.accent ? rgb(o.accent, 'accent') : undefined;
  const logo = await prepareLogo({
    logoOpt: logoOpt && { ...logoOpt, path: abs(logoOpt.path) },
    label,
    fonts,
    defaultFamily: label?.family ?? title.family,
    cacheDir,
  });

  const imageOptions = {
    cacheDir,
    bgGradient: background,
    border: accent ? { color: accent, width: DEFAULTS.accentWidth, side: /** @type {const} */ ('block-end') } : {},
    padding: o.padding ?? DEFAULTS.padding,
    logo,
    font: {
      title: { color: title.color, size: title.size, weight: title.weight, lineHeight: title.lineHeight, families: [title.family] },
      description: { color: text.color, size: text.size, weight: text.weight, lineHeight: text.lineHeight, families: [text.family] },
    },
    fonts: [...new Set([title.file, text.file])],
  };

  /**
   * @param {Page} page
   * @returns {Promise<Buffer>} (astro-og-canvas types it as BodyInit; it is a Buffer)
   */
  async function render(page) {
    const { generateOpenGraphImage } = await import('astro-og-canvas');
    const png = await generateOpenGraphImage({ ...imageOptions, title: page.title, description: page.description, dir: page.dir });
    return /** @type {Buffer} */ (png);
  }

  /**
   * Write /og/<slug>.png for every built page that points at one.
   * @param {URL} dir the build output
   * @param {import('astro').AstroIntegrationLogger} logger
   */
  async function write(dir, logger) {
    const out = fileURLToPath(dir);
    const htmlFiles = (await readdir(out, { recursive: true })).filter((f) => f.endsWith('.html')).sort();
    /** @type {Map<string, Page>} */
    const jobs = new Map();
    const kept = new Set();
    for (const file of htmlFiles) {
      const page = readPage(await readFile(path.join(out, file), 'utf8'));
      const card = cardPath(page.image);
      if (!card || jobs.has(card) || kept.has(card)) continue;
      if (existsSync(path.join(out, card))) kept.add(card);
      else jobs.set(card, page);
    }
    for (const [card, page] of jobs) {
      const target = path.join(out, card);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await render(page));
    }
    if (jobs.size || kept.size) {
      logger.info(
        `${jobs.size} share card${jobs.size === 1 ? '' : 's'} written to /og/` +
          (kept.size ? `; kept ${kept.size} the site ships itself.` : '.')
      );
    }
  }

  return { render, write };
}

/**
 * What astro-og-canvas draws at the top of the card. A PNG/JPEG at its own or
 * a given width goes in unchanged; an SVG, a height, or a name next to the
 * logo goes through resvg first, rendered at the exact pixel size it is drawn.
 * Text inside a logo SVG is set in the card's fonts.
 * @param {{
 *   logoOpt?: { path: string, width?: number, height?: number },
 *   label?: { text: string, tracking: number, family: string, weight: Weight, capHeight: number, color: RGB, size?: number },
 *   fonts: Map<string, { buffer: Buffer, family: string }>,
 *   defaultFamily: string,
 *   cacheDir: string,
 * }} input
 * @returns {Promise<{ path: string, size?: [number?, number?] } | undefined>}
 */
async function prepareLogo({ logoOpt, label, fonts, defaultFamily, cacheDir }) {
  if (!logoOpt && !label) return undefined;
  const isSvg = logoOpt && /\.svg$/i.test(logoOpt.path);
  if (logoOpt && !existsSync(logoOpt.path)) {
    throw new Error(`@phonicscore/astro-kit: share-card logo not found: ${logoOpt.path}`);
  }
  if (logoOpt && !isSvg && !label && logoOpt.height === undefined) {
    return { path: logoOpt.path, size: logoOpt.width ? [logoOpt.width] : undefined };
  }

  const { Resvg } = await resvg();
  const fontBuffers = [...fonts.values()].map((f) => f.buffer);
  /** @param {string} svg @param {import('@resvg/resvg-wasm').ResvgRenderOptions['fitTo']} [fitTo] */
  const draw = (svg, fitTo) => new Resvg(svg, { fitTo, font: { fontBuffers, defaultFontFamily: defaultFamily } });

  // 1. The logo as a PNG at the size it is drawn.
  /** @type {Buffer | undefined} */
  let png;
  let logoW = 0;
  let logoH = 0;
  if (logoOpt) {
    const source = await readFile(logoOpt.path);
    let svg;
    if (isSvg) {
      svg = source.toString('utf8');
    } else {
      const size = rasterSize(source);
      if (!size) throw new Error(`@phonicscore/astro-kit: share-card logo must be SVG, PNG or JPEG: ${logoOpt.path}`);
      const mime = source[0] === 0x89 ? 'image/png' : 'image/jpeg';
      svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}">` +
        `<image width="${size[0]}" height="${size[1]}" href="data:${mime};base64,${source.toString('base64')}"/></svg>`;
    }
    const fit =
      logoOpt.height !== undefined || (isSvg && logoOpt.width === undefined)
        ? { mode: /** @type {const} */ ('height'), value: logoOpt.height ?? DEFAULTS.logoHeight }
        : logoOpt.width !== undefined
          ? { mode: /** @type {const} */ ('width'), value: logoOpt.width }
          : undefined;
    const r = draw(svg, fit).render();
    [png, logoW, logoH] = [Buffer.from(r.asPng()), r.width, r.height];
  }

  // 2. The name, measured by its ink so it lines up with the logo's edges.
  if (label) {
    const size = label.size ?? (png ? Math.round(logoH * 0.5) : DEFAULTS.labelSize);
    const textEl = (/** @type {number} */ x, /** @type {number} */ y) =>
      `<text x="${x}" y="${y}" font-family="${xml(label.family)}" font-weight="${weightValue(label.weight)}" ` +
      `font-size="${size}" letter-spacing="${label.tracking * size}" fill="${hex(label.color)}">${xml(label.text)}</text>`;
    const mw = Math.ceil(size * (label.text.length + 4) * (1.2 + label.tracking));
    const measure = draw(`<svg xmlns="http://www.w3.org/2000/svg" width="${mw}" height="${size * 3}">${textEl(size, size * 2)}</svg>`);
    const box = measure.getBBox();
    if (!box) throw new Error(`@phonicscore/astro-kit: could not set "${label.text}" in ${label.family}; check the font file.`);
    if (!png) {
      measure.cropByBBox(box);
      png = Buffer.from(measure.render().asPng());
    } else {
      const gap = Math.round(logoH * 0.25);
      // Cap height centred on the logo, so capitals sit mid-mark.
      const baseline = (logoH + label.capHeight * size) / 2;
      png = Buffer.from(
        draw(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(logoW + gap + box.width + 1)}" height="${logoH}">` +
            `<image width="${logoW}" height="${logoH}" href="data:image/png;base64,${png.toString('base64')}"/>` +
            textEl(logoW + gap - (box.x - size), baseline) +
            '</svg>'
        )
          .render()
          .asPng()
      );
    }
  }

  const bytes = /** @type {Buffer} */ (png);
  const file = path.join(cacheDir, `logo-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.png`);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, bytes);
  return { path: file };
}

const TAG = (/** @type {string} */ name) => new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** @param {string} tag */
function attributes(tag) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of tag.replace(/^<\w+/, '').matchAll(ATTR)) {
    out[m[1].toLowerCase()] = decodeHTML(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * The card's text from a built page's <head>.
 * @param {string} html
 * @returns {Page}
 */
export function readPage(html) {
  const end = html.search(/<\/head>/i);
  const head = end === -1 ? html : html.slice(0, end);
  /** @type {Record<string, string>} */
  const meta = {};
  for (const [tag] of head.matchAll(TAG('meta'))) {
    const a = attributes(tag);
    const key = a.property ?? a.name;
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const htmlTag = head.match(TAG('html'));
  const titleTag = /<title\b[^>]*>([^<]*)<\/title>/i.exec(head);
  return {
    image: meta['og:image'],
    title: meta['og:image:alt'] || meta['og:title'] || (titleTag ? decodeHTML(titleTag[1]).trim() : ''),
    description: meta.description || meta['og:description'] || '',
    dir: htmlTag && attributes(htmlTag[0]).dir === 'rtl' ? 'rtl' : 'ltr',
  };
}

/**
 * "/og/<slug>.png" if an og:image URL points at a kit card, else undefined.
 * @param {string | undefined} image
 */
export function cardPath(image) {
  if (!image) return undefined;
  try {
    const pathname = decodeURIComponent(new URL(image, 'https://site.invalid').pathname);
    // Decoding can turn %2F back into a slash: no dot segments, so the card
    // stays inside /og/.
    const segments = pathname.split('/');
    if (!/^\/og\/.+\.png$/.test(pathname) || pathname.includes('\\') || segments.some((s) => s === '..' || s === '.')) {
      return undefined;
    }
    return pathname;
  } catch {
    return undefined;
  }
}

/**
 * `astro dev`: render /og/<slug>.png on request from the page it belongs to.
 * @param {{ server: import('vite').ViteDevServer, cards: () => Promise<{ render: (page: Page) => Promise<Buffer> }>, logger: import('astro').AstroIntegrationLogger }} input
 * @returns {import('vite').Connect.NextHandleFunction}
 */
export function devMiddleware({ server, cards, logger }) {
  return async (req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return next();
    }
    const slug = /^\/og\/(.+)\.png$/.exec(pathname)?.[1];
    const origin = server.resolvedUrls?.local[0];
    if (!slug || !origin || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    try {
      for (const page of slug === 'index' ? ['/'] : [`/${slug}/`, `/${slug}`]) {
        const response = await fetch(new URL(encodeURI(page), origin), { headers: { accept: 'text/html' } });
        if (!response.headers.get('content-type')?.includes('text/html')) continue;
        const data = readPage(await response.text());
        if (cardPath(data.image) !== pathname) continue;
        const png = await (await cards()).render(data);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.end(png);
        return;
      }
    } catch (e) {
      logger.warn(`share card ${pathname}: ${e instanceof Error ? e.message : e}`);
    }
    next();
  };
}
