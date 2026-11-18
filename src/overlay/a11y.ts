/**
 * Accessibility checks that need no AI: they read the page as it renders and report what is objectively wrong.
 * Automated checks find some problems, not all (axe-core's own estimate is about 57% of WCAG issues), so a clean
 * result is never a pass. Each issue may carry a fix Brushup can write as a style edit.
 */

import type { DesignRule } from './design';

export type A11yRule =
  | 'contrast'
  | 'target-size'
  | 'small-text'
  | 'image-alt'
  | 'name'
  | 'link-text'
  | 'heading-order'
  | 'keyboard'
  | 'tab-order'
  | 'language'
  | 'page-title'
  | 'zoom'
  | 'duplicate-id'
  | 'autoplay'
  | 'page-structure';

const WCAG = 'https://www.w3.org/WAI/WCAG22/Understanding/';

/** Every check, in the order the tab lists them: what it looks for, and where the standard explains why. */
export const RULES: { rule: A11yRule; label: string; what: string; learn?: string }[] = [
  { rule: 'contrast', label: 'Contrast', what: 'Text that is hard to read against its background (4.5:1, or 3:1 for large text)', learn: `${WCAG}contrast-minimum.html` },
  { rule: 'target-size', label: 'Tap size', what: 'Buttons, links and inputs smaller than 24×24px', learn: `${WCAG}target-size-minimum.html` },
  { rule: 'small-text', label: 'Small text', what: 'Text under 12px, which many people cannot read comfortably' },
  { rule: 'image-alt', label: 'Image', what: 'Images with no alt attribute', learn: `${WCAG}non-text-content.html` },
  { rule: 'name', label: 'Name', what: 'Buttons, links and inputs a screen reader cannot name', learn: `${WCAG}name-role-value.html` },
  { rule: 'link-text', label: 'Link text', what: 'Links that only say “click here” or “read more”', learn: `${WCAG}link-purpose-in-context.html` },
  { rule: 'heading-order', label: 'Headings', what: 'Headings that skip a level or are empty', learn: `${WCAG}info-and-relationships.html` },
  { rule: 'keyboard', label: 'Keyboard', what: 'Things that look clickable, or have a button role, but a keyboard cannot reach', learn: `${WCAG}keyboard.html` },
  { rule: 'tab-order', label: 'Tab order', what: 'A custom tab order (tabindex above 0) that jumps around the page', learn: `${WCAG}focus-order.html` },
  { rule: 'language', label: 'Language', what: 'A page with no language set on <html>', learn: `${WCAG}language-of-page.html` },
  { rule: 'page-title', label: 'Page title', what: 'A page with no <title>', learn: `${WCAG}page-titled.html` },
  { rule: 'zoom', label: 'Zoom', what: 'A viewport setting that stops people zooming in', learn: `${WCAG}resize-text.html` },
  { rule: 'duplicate-id', label: 'Duplicate id', what: 'The same id used twice, which breaks labels and aria references', learn: `${WCAG}name-role-value.html` },
  { rule: 'autoplay', label: 'Autoplay', what: 'Audio or video that starts playing by itself', learn: `${WCAG}audio-control.html` },
  { rule: 'page-structure', label: 'Page structure', what: 'No main landmark, or no h1', learn: `${WCAG}info-and-relationships.html` },
];

export interface A11yIssue {
  id: string;
  /** An accessibility rule, or a design rule (scanned by `design.ts`, which shares this shape). */
  rule: A11yRule | DesignRule;
  el: HTMLElement;
  title: string;
  detail: string;
  /** A style edit that resolves it, when one is safe to write. */
  fix?: { label: string; props: Record<string, string> };
}

type Rgba = { r: number; g: number; b: number; a: number };

const MAX_ISSUES = 60;
const MIN_TARGET = 24; // WCAG 2.2 SC 2.5.8, level AA
const MIN_TEXT = 12;
const VAGUE_LINKS = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this', 'this link', 'details', 'more info', 'more details', 'view more', 'see more']);

/* ---------- colour ---------- */

const cache = new Map<string, Rgba | null>();
let canvas: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour (rgb, hex, oklch, color(display-p3 …)) as sRGB, or null if it can't be read. */
export function parseColor(value: string): Rgba | null {
  const key = value.trim();
  if (cache.has(key)) return cache.get(key)!;
  let out: Rgba | null = null;
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(key);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    out = { r: +m[1], g: +m[2], b: +m[3], a };
  } else if (key === 'transparent') out = { r: 0, g: 0, b: 0, a: 0 };
  else {
    // Computed colours keep modern colour spaces (oklch, color()), so let the browser convert them.
    try {
      if (canvas === undefined) canvas = document.createElement('canvas').getContext?.('2d', { willReadFrequently: true }) ?? null;
      if (canvas) {
        canvas.clearRect(0, 0, 1, 1);
        canvas.fillStyle = '#000';
        canvas.fillStyle = key;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
        out = { r, g, b, a: a / 255 };
      }
    } catch {
      out = null;
    }
  }
  cache.set(key, out);
  return out;
}

const over = (top: Rgba, under: Rgba): Rgba => {
  const a = top.a + under.a * (1 - top.a);
  if (!a) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
};

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: { r: number; g: number; b: number }) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

export function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (c: { r: number; g: number; b: number }) => '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

function toHsl({ r, g, b }: { r: number; g: number; b: number }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function fromHsl(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** The closest colour to `fg` (same hue and saturation, lighter or darker) that reaches `required` against `bg`. */
export function nearestPassing(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }, required: number): string | null {
  const { h, s, l } = toHsl(fg);
  const darker = contrastRatio({ r: 0, g: 0, b: 0 }, bg) >= contrastRatio({ r: 255, g: 255, b: 255 }, bg);
  for (let step = 0; step <= 200; step++) {
    const next = darker ? l - step * 0.005 : l + step * 0.005;
    if (next < 0 || next > 1) break;
    const c = fromHsl(h, s, next);
    if (contrastRatio(c, bg) >= required) return hex(c);
  }
  return null;
}

/** What is actually behind an element's text, or null when it can't be known (an image or gradient). */
function backdrop(el: Element): { r: number; g: number; b: number } | null {
  const layers: Rgba[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0) layers.push(c);
    if (c && c.a >= 1) break;
  }
  let acc: Rgba = { r: 255, g: 255, b: 255, a: 1 }; // the page canvas
  for (const layer of layers.reverse()) acc = over(layer, acc);
  return acc;
}

/* ---------- the checks ---------- */

const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());

function accessibleName(el: Element): string {
  const attr = (n: string) => (el.getAttribute(n) ?? '').trim();
  if (attr('aria-label')) return attr('aria-label');
  const by = attr('aria-labelledby');
  if (by) {
    const text = by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
    if (text) return text;
  }
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) && el.value) return el.value;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && el.labels?.length && [...el.labels].some((l) => l.textContent?.trim())) return 'label';
  if (el.textContent?.trim()) return el.textContent.trim();
  const img = el.querySelector('img[alt]:not([alt=""]), svg[aria-label], svg title');
  if (img) return img.getAttribute('alt') || img.getAttribute('aria-label') || img.textContent?.trim() || 'image';
  if (attr('title')) return attr('title');
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) if (el.placeholder.trim()) return el.placeholder.trim();
  return '';
}

const describe = (el: Element) => {
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return `<${el.tagName.toLowerCase()}>${text ? ` “${text}”` : ''}`;
};

const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=tab], [role=switch], [role=menuitem]';

/** Scan the page. `ignore` skips Brushup's own UI. */
export function scanPage(doc: Document, ignore: (el: Element) => boolean = () => false): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const add = (issue: Omit<A11yIssue, 'id'>) => issues.length < MAX_ISSUES && issues.push({ ...issue, id: `${issue.rule}:${issues.length}` });
  const shown = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const skip = (el: Element) => ignore(el) || el.closest('[aria-hidden=true], [inert]') !== null;

  // Text contrast.
  for (const el of doc.body.querySelectorAll<HTMLElement>('*')) {
    if (issues.length >= MAX_ISSUES) break;
    if (!hasOwnText(el) || skip(el) || el.matches('script, style, noscript, option') || (el as HTMLButtonElement).disabled || !shown(el)) continue;
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    const bg = backdrop(el);
    if (!fg || !bg || fg.a === 0) continue;
    const text = over(fg, { ...bg, a: 1 });
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    const required = large ? 3 : 4.5;
    const ratio = contrastRatio(text, bg);
    if (ratio >= required) continue;
    const better = nearestPassing(text, bg, required);
    add({
      rule: 'contrast',
      el,
      title: `Text is hard to read: contrast ${ratio.toFixed(1)}:1, needs ${required}:1`,
      detail: `${describe(el)} is ${hex(text)} on ${hex(bg)} at ${Math.round(size)}px${large ? ' (large text)' : ''}. Low contrast is hard to read for many people, especially in bright light or with low vision.`,
      ...(better ? { fix: { label: `Change color to ${better}`, props: { color: better } } } : {}),
    });
  }

  // Tap targets.
  for (const el of doc.body.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(el) || (el as HTMLButtonElement).disabled) continue;
    const r = shown(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline') continue; // inline links in running text are exempt
    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type) && el.closest('label')) continue; // the label is the target
    if (r.width >= MIN_TARGET && r.height >= MIN_TARGET) continue;
    add({
      rule: 'target-size',
      el,
      title: `Hard to tap: only ${Math.round(r.width)}×${Math.round(r.height)}px`,
      detail: `${describe(el)} is smaller than ${MIN_TARGET}×${MIN_TARGET}px, the minimum WCAG 2.2 asks for. Small targets are easy to miss with a finger or a shaky hand.`,
      fix: { label: `Make it at least ${MIN_TARGET}×${MIN_TARGET}px`, props: { 'min-width': `${MIN_TARGET}px`, 'min-height': `${MIN_TARGET}px` } },
    });
  }

  // Images without alt.
  for (const img of doc.body.querySelectorAll<HTMLImageElement>('img')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(img) || img.hasAttribute('alt') || img.getAttribute('role') === 'presentation' || img.getAttribute('role') === 'none' || !shown(img)) continue;
    add({ rule: 'image-alt', el: img, title: 'Image is missing alt text', detail: `${describe(img)} has no alt attribute, so a screen reader can't say what it shows. Add a short description, or alt="" if it is only decoration.` });
  }

  // Controls with no accessible name.
  for (const el of doc.body.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea, [role=button]')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(el) || !shown(el) || accessibleName(el)) continue;
    add({ rule: 'name', el, title: 'Control has no name for screen readers', detail: `${describe(el)} has no text, label or aria-label, so a screen reader can only say "button" or "link". Give it a visible label or an aria-label.` });
  }

  // Heading levels that skip.
  let last = 0;
  for (const h of doc.body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role=heading][aria-level]')) {
    if (skip(h) || !shown(h)) continue;
    const level = h.matches('[role=heading][aria-level]') ? parseInt(h.getAttribute('aria-level') ?? '', 10) : parseInt(h.tagName[1], 10);
    if (!Number.isFinite(level)) continue;
    if (last && level > last + 1) add({ rule: 'heading-order', el: h, title: `Heading jumps from level ${last} to ${level}`, detail: `${describe(h)} follows an h${last}. People using a screen reader move around by heading level, so a skipped level looks like missing content.` });
    last = level;
  }

  // Text that is too small to read comfortably (a legibility rule, not a WCAG failure).
  for (const el of doc.body.querySelectorAll<HTMLElement>('*')) {
    if (issues.length >= MAX_ISSUES) break;
    if (!hasOwnText(el) || skip(el) || el.matches('script, style, noscript, option') || !shown(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(size) || size >= MIN_TEXT) continue;
    add({
      rule: 'small-text',
      el,
      title: `Text is very small: ${Math.round(size * 10) / 10}px`,
      detail: `${describe(el)} is under ${MIN_TEXT}px. Small text is hard to read on a phone and for anyone with low vision.`,
      fix: { label: `Make it ${MIN_TEXT}px`, props: { 'font-size': `${MIN_TEXT}px` } },
    });
  }

  // Links that say nothing about where they go.
  for (const a of doc.body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(a) || !shown(a) || a.hasAttribute('aria-label') || a.hasAttribute('aria-labelledby') || a.hasAttribute('title')) continue;
    const words = (a.textContent ?? '').toLowerCase().replace(/[\s→»›>.…!]+/g, ' ').trim();
    if (!VAGUE_LINKS.has(words)) continue;
    add({ rule: 'link-text', el: a, title: `Link only says “${words}”`, detail: `Screen reader users often browse a list of all the links on a page, where “${words}” means nothing. Say what the link is for, or add an aria-label such as “Read more about pricing”.` });
  }

  // Empty headings.
  for (const h of doc.body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(h) || !shown(h) || accessibleName(h)) continue;
    add({ rule: 'heading-order', el: h, title: 'Heading is empty', detail: `${describe(h)} has no text, so a screen reader announces a heading with nothing in it.` });
  }

  // Keyboard: roles that promise a control, and things that look clickable but aren't focusable.
  const NATIVE = 'a[href], button, input, select, textarea, summary, label, area[href], [contenteditable=""], [contenteditable=true]';
  const FOCUSABLE = `${NATIVE}, [tabindex]`;
  for (const el of doc.body.querySelectorAll<HTMLElement>('[role=button], [role=link], [role=checkbox], [role=tab], [role=switch], [role=menuitem], [role=option]')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(el) || !shown(el) || el.matches(FOCUSABLE) || el.getAttribute('aria-disabled') === 'true') continue;
    add({ rule: 'keyboard', el, title: 'Has a button role but a keyboard can’t reach it', detail: `${describe(el)} says it is a ${el.getAttribute('role')} but has no tabindex, so people who don’t use a mouse can’t tab to it or press it. Use a real <button>, or add tabindex="0" and key handlers.` });
  }
  for (const el of doc.body.querySelectorAll<HTMLElement>('div, span, li, p, img, svg, h1, h2, h3, h4, h5, h6, td, section, article')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(el) || el.closest(`${FOCUSABLE}, [role]`) || !shown(el)) continue;
    const parent = el.parentElement;
    if (getComputedStyle(el).cursor !== 'pointer' || (parent && getComputedStyle(parent).cursor === 'pointer')) continue; // cursor is inherited: only the element that sets it
    add({ rule: 'keyboard', el, title: 'Looks clickable but a keyboard can’t use it', detail: `${describe(el)} shows a pointer cursor, which suggests a click handler, but it isn't a button or link and can't be focused. Make it a <button> (or <a>) so keyboard and screen reader users can use it too. Ignore this if it is only decoration.` });
  }

  // A custom tab order.
  for (const el of doc.body.querySelectorAll<HTMLElement>('[tabindex]')) {
    if (issues.length >= MAX_ISSUES) break;
    const n = parseInt(el.getAttribute('tabindex') ?? '', 10);
    if (skip(el) || !(n > 0)) continue;
    add({ rule: 'tab-order', el, title: `Custom tab order (tabindex ${n})`, detail: `${describe(el)} jumps ahead in the tab order, which makes the focus path hard to predict. Use tabindex="0" and put the element in the right place in the page instead.` });
  }

  // Media that starts by itself.
  for (const el of doc.body.querySelectorAll<HTMLMediaElement>('audio[autoplay], video[autoplay]')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(el) || (el instanceof HTMLVideoElement && (el.muted || el.hasAttribute('muted')))) continue;
    add({ rule: 'autoplay', el, title: 'Media starts playing on its own', detail: `${describe(el)} autoplays with sound. Sound that starts by itself talks over a screen reader and can't be stopped easily. Mute it, or remove autoplay.` });
  }

  // Duplicate ids.
  const seenIds = new Map<string, Element>();
  const reported = new Set<string>();
  for (const el of doc.body.querySelectorAll('[id]')) {
    if (issues.length >= MAX_ISSUES) break;
    const id = el.id;
    if (!id) continue;
    if (!seenIds.has(id)) seenIds.set(id, el);
    else if (!reported.has(id) && !skip(el)) {
      reported.add(id);
      add({ rule: 'duplicate-id', el: el as HTMLElement, title: `The id “${id}” is used more than once`, detail: `${describe(el)} shares its id with ${describe(seenIds.get(id)!)}. Labels, aria references and links by id only ever find the first one.` });
    }
  }

  // Page-level checks.
  const root = doc.documentElement;
  if (!root.getAttribute('lang')?.trim()) add({ rule: 'language', el: root, title: 'The page language isn’t set', detail: 'Add lang="en" (or your language) to the <html> tag so screen readers pronounce the text correctly and browsers translate it properly.' });
  if (!doc.title.trim()) add({ rule: 'page-title', el: root, title: 'The page has no title', detail: 'A <title> is the first thing a screen reader reads and what shows in browser tabs and history. Add one that says what this page is.' });
  const viewport = doc.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '';
  const maxScale = /maximum-scale\s*=\s*([\d.]+)/i.exec(viewport);
  if (/user-scalable\s*=\s*(no|0)/i.test(viewport) || (maxScale && parseFloat(maxScale[1]) < 2)) {
    add({ rule: 'zoom', el: root, title: 'Zooming is turned off', detail: `The viewport setting “${viewport}” stops people from pinching to zoom. Many people with low vision rely on zoom. Remove user-scalable=no and any low maximum-scale.` });
  }
  if (doc.body && !doc.querySelector('main, [role=main]')) add({ rule: 'page-structure', el: doc.body, title: 'The page has no main landmark', detail: 'Wrap the main content in <main> so screen reader users can jump straight to it past the navigation.' });
  if (doc.body && ![...doc.querySelectorAll('h1, [role=heading][aria-level="1"]')].some((h) => !skip(h) && shown(h))) {
    add({ rule: 'page-structure', el: doc.body, title: 'The page has no h1', detail: 'An h1 tells screen reader users what the page is about. Add one heading that names the page.' });
  }
  return issues;
}
