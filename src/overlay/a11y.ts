/**
 * Accessibility checks that need no AI: they read the page as it renders and report what is objectively wrong.
 * Automated checks find some problems, not all (axe-core's own estimate is about 57% of WCAG issues), so a clean
 * result is never a pass. Each issue may carry a fix Brushup can write as a style edit.
 */

export type A11yRule = 'contrast' | 'target-size' | 'image-alt' | 'name' | 'heading-order';

export interface A11yIssue {
  id: string;
  rule: A11yRule;
  el: HTMLElement;
  title: string;
  detail: string;
  /** A style edit that resolves it, when one is safe to write. */
  fix?: { label: string; props: Record<string, string> };
}

type Rgba = { r: number; g: number; b: number; a: number };

const MAX_ISSUES = 60;
const MIN_TARGET = 24; // WCAG 2.2 SC 2.5.8, level AA

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
      title: `Low contrast: ${ratio.toFixed(1)}:1 (needs ${required}:1)`,
      detail: `${describe(el)} is ${hex(text)} on ${hex(bg)}, ${Math.round(size)}px${large ? ' (large text)' : ''}.`,
      ...(better ? { fix: { label: `Use ${better}`, props: { color: better } } } : {}),
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
      title: `Small tap target: ${Math.round(r.width)}×${Math.round(r.height)}px`,
      detail: `${describe(el)} is smaller than ${MIN_TARGET}×${MIN_TARGET}px (WCAG 2.2, 2.5.8), which is hard to hit with a finger or pointer.`,
      fix: { label: `Make it at least ${MIN_TARGET}px`, props: { 'min-width': `${MIN_TARGET}px`, 'min-height': `${MIN_TARGET}px` } },
    });
  }

  // Images without alt.
  for (const img of doc.body.querySelectorAll<HTMLImageElement>('img')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(img) || img.hasAttribute('alt') || img.getAttribute('role') === 'presentation' || img.getAttribute('role') === 'none' || !shown(img)) continue;
    add({ rule: 'image-alt', el: img, title: 'Image has no alt attribute', detail: `${describe(img)} needs alt text describing it, or alt="" if it is only decoration.` });
  }

  // Controls with no accessible name.
  for (const el of doc.body.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea, [role=button]')) {
    if (issues.length >= MAX_ISSUES) break;
    if (skip(el) || !shown(el) || accessibleName(el)) continue;
    add({ rule: 'name', el, title: 'No accessible name', detail: `${describe(el)} has no text, label or aria-label, so a screen reader can't say what it is.` });
  }

  // Heading levels that skip.
  let last = 0;
  for (const h of doc.body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role=heading][aria-level]')) {
    if (skip(h) || !shown(h)) continue;
    const level = h.matches('[role=heading][aria-level]') ? parseInt(h.getAttribute('aria-level') ?? '', 10) : parseInt(h.tagName[1], 10);
    if (!Number.isFinite(level)) continue;
    if (last && level > last + 1) add({ rule: 'heading-order', el: h, title: `Heading level skips from ${last} to ${level}`, detail: `${describe(h)} follows an h${last}. Screen reader users navigate by heading level, so skipped levels look like missing content.` });
    last = level;
  }
  return issues;
}
