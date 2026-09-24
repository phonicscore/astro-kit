/**
 * Rehype transforms for migrated WordPress content. The export flattens UAGB
 * blocks to plain Markdown; these re-derive the two most common structured
 * patterns from the rendered HTML so they don't read as a stack of loose items:
 *
 *  - A run of >= 3 consecutive image-only paragraphs (client logos, toolset
 *    logos) becomes a `.image-grid` row.
 *  - A run of >= 2 consecutive "numeric heading + caption" pairs (12+, 100%,
 *    2000+, 3 Countries) becomes a `.stat-grid`.
 *  - A run of >= 2 image+heading+text+link tuples becomes a `.card-grid`.
 *  - A run of >= 2 image+h2+paragraph(s)+link sections becomes `.media-split`
 *    rows: image in the left column, text and CTA in the right (the solutions
 *    and products pages). Checked before the card pattern, which would
 *    otherwise swallow the single-paragraph case.
 *  - A run of >= 2 text-only "h3 + paragraph + link" triples becomes a
 *    `.card-grid` of text cards (the services pillar sections).
 *  - A run of >= 3 "number paragraph + heading + description" triples (the
 *    01..07 "How do we build your product?" steps) becomes a `.process`.
 *
 * Everything else is left as-is.
 */

const isWhitespace = (n) => n.type === 'text' && !n.value.trim();

function toText(node) {
  if (node.type === 'text') return node.value;
  if (node.children) return node.children.map(toText).join('');
  return '';
}

function isImagePara(node) {
  if (node?.type !== 'element' || node.tagName !== 'p') return false;
  const kids = node.children.filter((c) => !isWhitespace(c));
  return kids.length === 1 && kids[0].type === 'element' && kids[0].tagName === 'img';
}

const imgOf = (node) => node.children.find((c) => c.type === 'element' && c.tagName === 'img');

function isLinkPara(node) {
  if (node?.type !== 'element' || node.tagName !== 'p') return false;
  const kids = node.children.filter((c) => !isWhitespace(c));
  return kids.length === 1 && kids[0].type === 'element' && kids[0].tagName === 'a';
}

/** Match a card starting at `start`: image paragraph, heading, description
 *  paragraph, and a trailing link paragraph (required, so only real cards match).
 *  Returns { card, next } or null. */
function matchCard(children, start) {
  let i = start;
  const skipWs = () => {
    while (i < children.length && isWhitespace(children[i])) i++;
  };
  skipWs();
  if (!isImagePara(children[i])) return null;
  const img = imgOf(children[i]);
  i++;
  skipWs();
  const heading = children[i];
  if (!heading || heading.type !== 'element' || !/^h[234]$/.test(heading.tagName)) return null;
  i++;
  skipWs();
  const desc = children[i];
  if (!desc || desc.type !== 'element' || desc.tagName !== 'p' || isLinkPara(desc)) return null;
  i++;
  skipWs();
  const link = children[i];
  if (!isLinkPara(link)) return null;
  i++;
  return {
    card: el('div', 'card', [el('div', 'card-media', [img]), heading, desc, link]),
    next: i,
  };
}

/** Match a media-split section starting at `start`: image paragraph, h2,
 *  one to four description paragraphs, and a trailing link paragraph (which
 *  becomes the styled CTA). Returns { split, next } or null. */
function matchSplit(children, start) {
  let i = start;
  const skipWs = () => {
    while (i < children.length && isWhitespace(children[i])) i++;
  };
  skipWs();
  if (!isImagePara(children[i])) return null;
  const img = imgOf(children[i]);
  i++;
  skipWs();
  const heading = children[i];
  if (!heading || heading.type !== 'element' || heading.tagName !== 'h2') return null;
  i++;
  const paras = [];
  let link = null;
  while (paras.length < 4) {
    skipWs();
    const p = children[i];
    if (!p || p.type !== 'element' || p.tagName !== 'p') return null;
    if (isLinkPara(p)) {
      link = p;
      i++;
      break;
    }
    paras.push(p);
    i++;
  }
  if (!link || paras.length === 0) return null;
  link.properties = { ...link.properties, className: ['split-cta'] };
  return {
    split: el('div', 'media-split', [
      el('div', 'media-split-media', [img]),
      el('div', 'media-split-body', [heading, ...paras, link]),
    ]),
    next: i,
  };
}

/** Match a text-only card starting at `start`: non-numeric h3, one description
 *  paragraph, and a trailing link paragraph. Returns { card, next } or null. */
function matchTextCard(children, start) {
  let i = start;
  const skipWs = () => {
    while (i < children.length && isWhitespace(children[i])) i++;
  };
  skipWs();
  const heading = children[i];
  if (
    !heading ||
    heading.type !== 'element' ||
    heading.tagName !== 'h3' ||
    isNumericHeading(heading)
  )
    return null;
  i++;
  skipWs();
  const desc = children[i];
  if (!desc || desc.type !== 'element' || desc.tagName !== 'p' || isLinkPara(desc)) return null;
  i++;
  skipWs();
  const link = children[i];
  if (!isLinkPara(link)) return null;
  i++;
  return {
    card: el('div', 'card', [heading, desc, link]),
    next: i,
  };
}

function isNumericHeading(node) {
  if (node.type !== 'element' || node.tagName !== 'h3') return false;
  const text = toText(node).trim();
  return /^\d/.test(text) && text.length <= 24;
}

/** A paragraph whose entire text is a 1-2 digit step number (01..07). */
function isNumberPara(node) {
  if (node?.type !== 'element' || node.tagName !== 'p') return false;
  return /^\d{1,2}$/.test(toText(node).trim());
}

/** Match a process step: number paragraph, heading, description paragraph.
 *  Returns { step, next } or null. */
function matchStep(children, start) {
  let i = start;
  const skipWs = () => {
    while (i < children.length && isWhitespace(children[i])) i++;
  };
  skipWs();
  if (!isNumberPara(children[i])) return null;
  const num = toText(children[i]).trim();
  i++;
  skipWs();
  const heading = children[i];
  if (!heading || heading.type !== 'element' || !/^h[234]$/.test(heading.tagName)) return null;
  i++;
  skipWs();
  const desc = children[i];
  if (!desc || desc.type !== 'element' || desc.tagName !== 'p') return null;
  i++;
  return {
    step: el('div', 'process-step', [
      el('div', 'process-num', [{ type: 'text', value: num }]),
      heading,
      desc,
    ]),
    next: i,
  };
}

function el(tagName, className, children) {
  return { type: 'element', tagName, properties: { className: [className] }, children };
}

function transformChildren(children) {
  const out = [];
  let i = 0;
  while (i < children.length) {
    const node = children[i];

    // Process: gather consecutive (number para, heading, description) triples.
    if (isNumberPara(node)) {
      const steps = [];
      let k = i;
      for (;;) {
        const m = matchStep(children, k);
        if (!m) break;
        steps.push(m.step);
        k = m.next;
      }
      if (steps.length >= 3) {
        out.push(el('div', 'process', steps));
        i = k;
        continue;
      }
    }

    // Media split: >= 2 consecutive image + h2 + paragraph(s) + link sections
    // (solutions/products). Checked before the image-grid and card patterns.
    if (isImagePara(node)) {
      const splits = [];
      let k = i;
      for (;;) {
        const m = matchSplit(children, k);
        if (!m) break;
        splits.push(m.split);
        k = m.next;
      }
      if (splits.length >= 2) {
        out.push(...splits);
        i = k;
        continue;
      }
    }

    // Image grid: gather consecutive image-only paragraphs (ignoring whitespace).
    if (isImagePara(node)) {
      const imgs = [];
      let j = i;
      while (j < children.length && (isImagePara(children[j]) || isWhitespace(children[j]))) {
        if (isImagePara(children[j])) imgs.push(imgOf(children[j]));
        j++;
      }
      if (imgs.length >= 3) {
        out.push(el('div', 'image-grid', imgs));
        i = j;
        continue;
      }
      // Card grid: >= 2 consecutive image + heading + text + link tuples.
      const cards = [];
      let k = i;
      for (;;) {
        const m = matchCard(children, k);
        if (!m) break;
        cards.push(m.card);
        k = m.next;
      }
      if (cards.length >= 2) {
        out.push(el('div', 'card-grid', cards));
        i = k;
        continue;
      }
    }

    // Text card grid: >= 2 consecutive (h3, paragraph, link) triples without
    // images — the services pillar sections become a column grid.
    if (node?.type === 'element' && node.tagName === 'h3' && !isNumericHeading(node)) {
      const cards = [];
      let k = i;
      for (;;) {
        const m = matchTextCard(children, k);
        if (!m) break;
        cards.push(m.card);
        k = m.next;
      }
      if (cards.length >= 2) {
        out.push(el('div', 'card-grid', cards));
        i = k;
        continue;
      }
    }

    // Stat grid: gather consecutive (numeric heading, caption paragraph) pairs.
    if (isNumericHeading(node)) {
      const stats = [];
      let j = i;
      for (;;) {
        while (j < children.length && isWhitespace(children[j])) j++;
        const h = children[j];
        if (!h || !isNumericHeading(h)) break;
        let m = j + 1;
        while (m < children.length && isWhitespace(children[m])) m++;
        const p = children[m];
        if (!p || !(p.type === 'element' && p.tagName === 'p')) break;
        stats.push(
          el('div', 'stat', [el('div', 'stat-num', h.children), el('div', 'stat-label', p.children)])
        );
        j = m + 1;
      }
      if (stats.length >= 2) {
        out.push(el('div', 'stat-grid', stats));
        i = j;
        continue;
      }
    }

    out.push(node);
    i++;
  }
  return out;
}

function walk(node) {
  if (node.children) {
    node.children = transformChildren(node.children);
    for (const child of node.children) walk(child);
  }
}

/**
 * Rewrite a non-descriptive CTA into descriptive, per-language text using the
 * section heading, or null to leave it. The link language is inferred from the
 * original phrase (page copy is monolingual), so no locale is needed:
 *   "Learn More"/"more"        -> "Learn more about <heading>"
 *   "Read More"                -> "Read more about <heading>"
 *   "Mehr lesen"/"Erfahren …"  -> "Mehr über <heading>"
 * Links that already carry context ("Learn More on Sawti.app") don't match the
 * anchored patterns and are left alone.
 */
function descriptiveCta(txt, heading) {
  const t = txt.trim().toLowerCase();
  if (/^read more$/.test(t)) return `Read more about ${heading}`;
  if (/^(learn more|more|click here)$/.test(t)) return `Learn more about ${heading}`;
  if (/^(mehr lesen|erfahren sie mehr|mehr erfahren)$/.test(t)) return `Mehr über ${heading}`;
  return null;
}

/**
 * Make generic CTA links descriptive (a11y/SEO: WCAG 2.4.4 and Lighthouse's
 * link-text audit, which reads the visible text). Walks in document order so
 * each link picks up the heading above it — including the heading inside its own
 * card. Only links whose whole text is a generic phrase are rewritten; the URL
 * and everything else are untouched.
 */
function describeLinks(node, state) {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    if (/^h[1-6]$/.test(child.tagName)) state.heading = toText(child).trim();
    if (child.tagName === 'a' && state.heading) {
      const better = descriptiveCta(toText(child), state.heading);
      if (better) child.children = [{ type: 'text', value: better }];
    }
    describeLinks(child, state);
  }
}

export default function rehypeContent() {
  return (tree) => {
    walk(tree);
    describeLinks(tree, { heading: '' });
  };
}
