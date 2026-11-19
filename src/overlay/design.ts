/**
 * Design checks that need no AI: measurable principles read from the page as it renders (spacing on a grid,
 * readable line length and leading, clear hierarchy, nothing clipped or stretched). They are guidelines, not laws:
 * a deliberate choice can be right, so each message says what the principle is and why, and every one can be ignored.
 */
import type { A11yIssue } from './a11y';

export type DesignRule =
  | 'spacing-grid'
  | 'line-length'
  | 'line-height'
  | 'long-centered'
  | 'heading-hierarchy'
  | 'type-scale'
  | 'cramped-button'
  | 'stretched-image'
  | 'clipped-text'
  | 'sideways-scroll'
  | 'text-edge';

/**
 * Each rule says where its number comes from, so a suggestion can be weighed rather than trusted blindly.
 * `standard`: a published accessibility requirement. `guideline`: written down by a design system or research.
 * `convention`: common practice that no standard pins to a number.
 */
export const DESIGN_RULES: { rule: DesignRule; label: string; what: string; basis: string; learn?: string; strength: 'standard' | 'guideline' | 'convention' }[] = [
  {
    rule: 'spacing-grid',
    label: 'Spacing',
    what: 'Padding, margin or gap that is off a 4px grid (such as 15px or 23px), with a fix that snaps it to the grid',
    basis: 'Figma recommends an 8-point grid for spacing with a 4-point baseline for type, and Material aligns components to an 8dp grid with type on 4dp. Both treat it as a guide, so this flags only values off the finest (4px) step.',
    learn: 'https://m2.material.io/design/layout/spacing-methods.html',
    strength: 'guideline',
  },
  {
    rule: 'line-length',
    label: 'Line length',
    what: 'Paragraphs wider than 80 characters per line, which are tiring to read',
    basis: 'WCAG 1.4.8 sets 80 characters as the ceiling (level AAA). Baymard’s research finds 50 to 75 best and sees readers tire at 100 or more.',
    learn: 'https://baymard.com/blog/line-length-readability',
    strength: 'standard',
  },
  {
    rule: 'line-height',
    label: 'Line spacing',
    what: 'Multi-line text with lines packed tighter than 1.3× the font size',
    basis: 'Figma suggests starting body text at 1.5× the font size (about 1.1× for large headings), and WCAG 1.4.12 requires text to keep working at 1.5×. This flags only clearly tight text, below 1.3×.',
    learn: 'https://www.figma.com/best-practices/typography-systems-in-figma/',
    strength: 'guideline',
  },
  {
    rule: 'long-centered',
    label: 'Alignment',
    what: 'Paragraphs of four or more lines that are centered, which makes each line start somewhere new',
    basis: 'Accessibility guidance such as BOIA’s calls long centered text a practice to avoid, though it is advice and not a WCAG requirement, and studies of reading speed are mixed. Short centered text, under four lines, is fine.',
    learn: 'https://boia.org/blog/why-justified-or-centered-text-is-bad-for-accessibility',
    strength: 'convention',
  },
  {
    rule: 'heading-hierarchy',
    label: 'Hierarchy',
    what: 'Headings that are no bigger or bolder than the text around them',
    basis: 'Figma’s typography guide describes a type “waterfall” running from the largest text to the smallest, so each level is clearly distinct from the next.',
    learn: 'https://www.figma.com/best-practices/typography-systems-in-figma/',
    strength: 'guideline',
  },
  {
    rule: 'type-scale',
    label: 'Type scale',
    what: 'A page using more than 8 different font sizes',
    basis: 'Figma’s typography guide cites getting “a lot of range from just 7 sizes” as a starting point, and warns that scale steps over 1.4 to 1.5× grow too fast. This allows a little more, flagging above 8.',
    learn: 'https://www.figma.com/best-practices/typography-systems-in-figma/',
    strength: 'guideline',
  },
  {
    rule: 'cramped-button',
    label: 'Button padding',
    what: 'Buttons and links with a box where the text is squeezed against the edge',
    basis: 'No standard gives a number. The suggested 12px on the sides and 6px above and below is a typical default, so adjust it to your design.',
    strength: 'convention',
  },
  {
    rule: 'stretched-image',
    label: 'Image',
    what: 'Images drawn at a different shape from the original, so they look stretched or squashed',
    basis: 'No standard sets this. A picture drawn at the wrong proportions looks distorted, and CSS object-fit exists to crop it to fit instead.',
    learn: 'https://developer.mozilla.org/en-US/docs/Web/CSS/object-fit',
    strength: 'convention',
  },
  {
    rule: 'clipped-text',
    label: 'Cut off',
    what: 'Text hidden by its container with no ellipsis',
    basis: 'WCAG 1.4.12 requires that no content is lost or clipped when people change text spacing, and text that is already cut off will only get worse.',
    learn: 'https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html',
    strength: 'standard',
  },
  {
    rule: 'sideways-scroll',
    label: 'Page width',
    what: 'Something wider than the screen, so the page scrolls sideways',
    basis: 'WCAG 1.4.10 (Reflow, level AA) asks that content fits a 320px-wide screen without scrolling in two directions. This checks at the current window size.',
    learn: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    strength: 'standard',
  },
  {
    rule: 'text-edge',
    label: 'Screen edge',
    what: 'Text within 8px of the edge of the screen',
    basis: 'Apple’s layout guidelines keep content inside margins and safe areas, but no standard sets this number. 8px is a floor and the suggested 16px is a typical margin.',
    learn: 'https://developer.apple.com/design/human-interface-guidelines/layout',
    strength: 'convention',
  },
];

const MAX_PER_RULE = 8;
const GRID = 4;
const HALF_STEPS = new Set([2, 6, 10, 14]); // Tailwind's half steps are deliberate, not accidents

const describe = (el: Element) => {
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return `<${el.tagName.toLowerCase()}>${text ? ` “${text}”` : ''}`;
};
const px = (v: string) => parseFloat(v);
const ownText = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
const BOX_PROPS = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'row-gap', 'column-gap'] as const;

/** Scan the page against the design checks. `ignore` skips Brushup's own UI. */
export function scanDesign(doc: Document, ignore: (el: Element) => boolean = () => false): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const counts = new Map<string, number>();
  const add = (issue: Omit<A11yIssue, 'id'>) => {
    const n = counts.get(issue.rule) ?? 0;
    if (n >= MAX_PER_RULE) return;
    counts.set(issue.rule, n + 1);
    issues.push({ ...issue, id: `${issue.rule}:${n}` });
  };
  const shown = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const skip = (el: Element) => ignore(el) || el.closest('[aria-hidden=true], [inert]') !== null || el.matches('script, style, noscript, head, html, body');
  const all = [...doc.body.querySelectorAll<HTMLElement>('*')].filter((el) => !skip(el));
  const vw = doc.defaultView?.innerWidth ?? 0;

  // Spacing off a 4px grid.
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.display === 'inline') continue; // inline boxes ignore vertical spacing
    const off: Record<string, string> = {};
    for (const prop of BOX_PROPS) {
      const raw = cs.getPropertyValue(prop);
      const v = px(raw);
      if (!Number.isFinite(v) || !Number.isInteger(v) || v === 0) continue; // fractions come from auto, %, or em maths
      const abs = Math.abs(v);
      if (abs % GRID === 0 || HALF_STEPS.has(abs) || abs < 2) continue;
      if (prop.startsWith('margin-') && (prop === 'margin-left' || prop === 'margin-right') && cs.marginLeft === cs.marginRight) continue; // centering
      off[prop] = `${Math.sign(v) * Math.max(GRID, Math.round(abs / GRID) * GRID)}px`;
    }
    if (!Object.keys(off).length || !shown(el)) continue;
    const list = Object.entries(off).map(([p]) => `${p} ${cs.getPropertyValue(p)}`);
    add({
      rule: 'spacing-grid',
      el,
      title: `Off the ${GRID}px grid: ${Object.entries(off).map(([p]) => `${p} ${cs.getPropertyValue(p)}`).join(', ')}`,
      detail: `${describe(el)} has ${list.join(', ')}. Spacing from one scale (multiples of ${GRID}px) makes a layout feel ordered; odd values such as 15px or 23px usually come from nudging by eye.`,
      fix: { label: `Snap to the grid (${Object.entries(off).map(([p, v]) => `${p.replace('padding-', 'p-').replace('margin-', 'm-')} ${v}`).join(', ')})`, props: off },
    });
  }

  // Line length, line spacing, and long centered text.
  for (const el of all) {
    const text = ownText(el);
    if (text.length < 80 || !shown(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') continue;
    const size = px(cs.fontSize);
    if (!(size > 0)) continue;
    const r = el.getBoundingClientRect();
    const lh = cs.lineHeight === 'normal' ? size * 1.2 : px(cs.lineHeight);
    const lines = lh > 0 ? Math.round(r.height / lh) : 1;
    const perLine = r.width / (size * 0.5); // an average character is about half an em wide

    if (text.length >= 150 && perLine > 80) {
      add({
        rule: 'line-length',
        el,
        title: `Lines are about ${Math.round(perLine)} characters long`,
        detail: `${describe(el)} runs wide. WCAG's ceiling is 80 characters per line and research finds 50 to 75 easiest to read; with longer lines the eye loses its place finding the start of the next one.`,
        fix: { label: 'Limit the width to 65 characters', props: { 'max-width': '65ch' } },
      });
    }
    if (lines >= 2 && size <= 22 && lh / size < 1.3) {
      add({
        rule: 'line-height',
        el,
        title: `Lines are packed tight (${(lh / size).toFixed(2)}× the font size)`,
        detail: `${describe(el)} has little space between lines. Figma suggests starting body text at 1.5× the font size.`,
        fix: { label: 'Set line spacing to 1.5', props: { 'line-height': '1.5' } },
      });
    }
    if (cs.textAlign === 'center' && text.length >= 200 && lines >= 4) {
      add({
        rule: 'long-centered',
        el,
        title: 'A long paragraph is centered',
        detail: `${describe(el)} is centered over ${lines} lines. Centered text is fine for a few lines, but over more every line starts in a new place and is harder to follow. Left-align it.`,
        fix: { label: 'Align left', props: { 'text-align': 'left' } },
      });
    }
  }

  // Hierarchy: headings should stand out from the body text.
  const bodySizes = all.filter((el) => /^(P|LI)$/.test(el.tagName) && ownText(el).length >= 40 && shown(el)).map((el) => Math.round(px(getComputedStyle(el).fontSize)));
  if (bodySizes.length >= 3) {
    const counts2 = new Map<number, number>();
    bodySizes.forEach((s) => counts2.set(s, (counts2.get(s) ?? 0) + 1));
    const body = [...counts2.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const h of all.filter((el) => /^H[1-3]$/.test(el.tagName) && ownText(el) && shown(el))) {
      const cs = getComputedStyle(h);
      const size = px(cs.fontSize);
      if (size > body * 1.15 || parseInt(cs.fontWeight, 10) >= 600) continue;
      add({
        rule: 'heading-hierarchy',
        el: h,
        title: 'Heading doesn’t stand out from the text',
        detail: `${describe(h)} is ${Math.round(size)}px at normal weight, about the same as the ${body}px body text. A heading should be clearly bigger or bolder so the page can be scanned.`,
        fix: { label: `Make it ${Math.round(body * 1.5)}px and semibold`, props: { 'font-size': `${Math.round(body * 1.5)}px`, 'font-weight': '600' } },
      });
    }
  }

  // Too many type sizes.
  const sizes = new Map<number, number>();
  for (const el of all) if (ownText(el) && shown(el)) sizes.set(Math.round(px(getComputedStyle(el).fontSize)), (sizes.get(Math.round(px(getComputedStyle(el).fontSize))) ?? 0) + 1);
  if (sizes.size > 8) {
    const list = [...sizes.keys()].sort((a, b) => a - b).join(', ');
    add({ rule: 'type-scale', el: doc.body, title: `The page uses ${sizes.size} different font sizes`, detail: `Sizes in use: ${list}px. Figma's guide suggests about 7 give plenty of range. Many close sizes (13, 14, 15px) read as mistakes, not as a hierarchy. Pick a scale and use only its steps.` });
  }

  // Cramped buttons: a box with the text pressed against its edge.
  for (const el of all.filter((e) => e.matches('button, a[href], [role=button]') && ownText(e) && shown(e))) {
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') continue;
    const bg = cs.backgroundColor;
    const hasBox = (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || px(cs.borderTopWidth) > 0;
    if (!hasBox) continue;
    // Measure the real gap between the text and the edge of its box: a button can have no padding and still be roomy
    // (a fixed height with the label centered), so padding alone would be a false alarm.
    const range = doc.createRange();
    range.selectNodeContents(el);
    const text = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    const r = el.getBoundingClientRect();
    const measured = text && text.width > 0 && text.height > 0;
    const gap = measured
      ? { x: Math.min(text.left - r.left, r.right - text.right), y: Math.min(text.top - r.top, r.bottom - text.bottom) }
      : { x: Math.min(px(cs.paddingLeft), px(cs.paddingRight)), y: Math.min(px(cs.paddingTop), px(cs.paddingBottom)) };
    const props: Record<string, string> = {};
    if (gap.x < 8) Object.assign(props, { 'padding-left': '12px', 'padding-right': '12px' });
    if (gap.y < 4) Object.assign(props, { 'padding-top': '6px', 'padding-bottom': '6px' });
    if (!Object.keys(props).length) continue;
    add({
      rule: 'cramped-button',
      el,
      title: 'The text is squeezed inside its button',
      detail: `${describe(el)} has a box but almost no space between the text and its edge. Buttons feel clickable and look finished with room around the label: about 12px on the sides and 6px above and below.`,
      fix: { label: 'Add padding', props },
    });
  }

  // Stretched images.
  for (const img of all.filter((e): e is HTMLImageElement => e instanceof HTMLImageElement)) {
    const r = shown(img);
    if (!r || !img.naturalWidth || !img.naturalHeight || (getComputedStyle(img).objectFit || 'fill') !== 'fill') continue;
    const drawn = r.width / r.height;
    const natural = img.naturalWidth / img.naturalHeight;
    if (Math.abs(drawn / natural - 1) < 0.06) continue;
    add({
      rule: 'stretched-image',
      el: img,
      title: 'The image is stretched out of shape',
      detail: `${describe(img)} is drawn at ${Math.round(r.width)}×${Math.round(r.height)} but the picture is ${img.naturalWidth}×${img.naturalHeight}, so everything in it looks stretched or squashed. Crop it to fit instead.`,
      fix: { label: 'Crop to fit (object-fit: cover)', props: { 'object-fit': 'cover' } },
    });
  }

  // Text cut off by its container.
  for (const el of all) {
    if (!ownText(el) || !shown(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || cs.getPropertyValue('-webkit-line-clamp') !== '' && cs.getPropertyValue('-webkit-line-clamp') !== 'none') continue;
    const cutX = /^(hidden|clip)$/.test(cs.overflowX) && el.scrollWidth - el.clientWidth > 2;
    const cutY = /^(hidden|clip)$/.test(cs.overflowY) && el.scrollHeight - el.clientHeight > 2;
    if (!cutX && !cutY) continue;
    add({ rule: 'clipped-text', el, title: 'Text is cut off', detail: `${describe(el)} hides part of its content (${cutX ? `${el.scrollWidth - el.clientWidth}px sideways` : `${el.scrollHeight - el.clientHeight}px vertically`}) without an ellipsis, so people can't tell something is missing. Give it room, or truncate it visibly.` });
  }

  // The page scrolls sideways.
  const scroller = doc.scrollingElement ?? doc.documentElement;
  if (scroller.scrollWidth - scroller.clientWidth > 1 && vw) {
    const offender = all.find((el) => {
      if (getComputedStyle(el).position === 'fixed' || !shown(el)) return false;
      for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) if (/^(hidden|auto|scroll|clip)$/.test(getComputedStyle(p).overflowX)) return false;
      return el.getBoundingClientRect().right > vw + 1;
    });
    add({
      rule: 'sideways-scroll',
      el: offender ?? doc.body,
      title: 'The page scrolls sideways',
      detail: offender ? `${describe(offender)} sticks out ${Math.round(offender.getBoundingClientRect().right - vw)}px past the right edge of the screen. Sideways scrolling is a common bug on phones; shrink or wrap it.` : 'Something on the page is wider than the screen, so it scrolls sideways.',
    });
  }

  // Text against the edge of the screen.
  for (const el of all) {
    if (!ownText(el) || !shown(el) || !vw || typeof document.createRange !== 'function') continue;
    const range = doc.createRange();
    range.selectNodeContents(el);
    const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    if (!r || !r.width || !r.height) continue;
    if (r.left >= 8 && r.right <= vw - 8) continue;
    if (getComputedStyle(el).position === 'fixed') continue;
    add({
      rule: 'text-edge',
      el,
      title: `Text is ${Math.max(0, Math.round(Math.min(r.left, vw - r.right)))}px from the edge of the screen`,
      detail: `${describe(el)} almost touches the side of the screen. Leave a margin of at least 16px so text isn't clipped by rounded corners or hard to read against the edge.`,
      fix: { label: 'Add 16px side padding', props: { 'padding-left': '16px', 'padding-right': '16px' } },
    });
  }
  return issues;
}
