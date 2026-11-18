/**
 * Map "set this CSS property to this value" onto Tailwind utility classes.
 * Always uses arbitrary-value utilities (`ml-[38px]`) so it needs no theme
 * knowledge and works on Tailwind v3 and v4. Existing utilities for the same
 * property are removed; variants (`md:ml-4`) are left alone since they only
 * apply conditionally.
 */
interface Mapping {
  remove: RegExp;
  make: string;
}

const arb = (v: string) => `[${v.trim().replace(/\s+/g, '_')}]`;

const PREFIX: Record<string, string> = {
  'margin-top': 'mt',
  'margin-right': 'mr',
  'margin-bottom': 'mb',
  'margin-left': 'ml',
  'padding-top': 'pt',
  'padding-right': 'pr',
  'padding-bottom': 'pb',
  'padding-left': 'pl',
  gap: 'gap',
  'flex-basis': 'basis',
  width: 'w',
  height: 'h',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
};

// Optional `/leading` suffix: `text-lg/7`, `text-[40px]/tight`.
const FONT_SIZE = /^!?text-(xs|sm|base|lg|xl|\d+xl|\[(?:length:|size:)?-?[\d.]+(?:px|rem|em|%)?\])(?:\/\S+)?$/;
// Named sizes bundle a line-height; the arbitrary `text-[40px]` form does not.
const NAMED_SIZE = /^!?text-(xs|sm|base|lg|xl|\d+xl)(?:\/\S+)?$/;
const COLOR = /^!?text-(white|black|inherit|current|transparent|\[(?:color:)?(?:#|rgb|hsl|oklch|oklab|var\()[^\]]*\]|[a-z]+-\d{2,3}(?:\/\d+)?)$/;
const WEIGHT_NAMES: Record<string, string> = {
  '100': 'thin',
  '200': 'extralight',
  '300': 'light',
  '400': 'normal',
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  '800': 'extrabold',
  '900': 'black',
};
const WEIGHT = /^!?font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/;

function mapping(prop: string, value: string, scale?: Scale): Mapping {
  const prefix = PREFIX[prop];
  if (prefix) {
    const lookahead = prefix === 'gap' ? '(?!x-|y-)' : '';
    return { remove: new RegExp(`^!?-?${prefix}-${lookahead}`), make: (scale && snapped(prefix, value, scale)) || `${prefix}-${arb(value)}` };
  }
  if (prop === 'font-size') return { remove: FONT_SIZE, make: `text-${arb(value)}` };
  if (prop === 'color') return { remove: COLOR, make: `text-${arb(value)}` };
  if (prop === 'font-weight') return { remove: WEIGHT, make: WEIGHT_NAMES[value] ? `font-${WEIGHT_NAMES[value]}` : `font-${arb(value)}` };
  if (prop === 'line-height') return { remove: /^!?leading-/, make: `leading-${arb(value)}` };
  const escaped = prop.replace(/[^\w-]/g, '');
  return { remove: new RegExp(`^!?\\[${escaped}:`), make: `[${escaped}:${value.trim().replace(/\s+/g, '_')}]` };
}

/** Which Tailwind's default spacing scale to snap to: v3 lists its steps, v4 takes any multiple of half a step. */
export type Scale = 'v3' | 'v4';

export interface ClassHints {
  lineHeight?: string;
  /** Set (by the server, after checking the page's root font size) to write on-scale values as plain utilities. */
  scale?: Scale;
}

const V3_STEPS = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);
// Utilities where a negative value is written `-mt-4`.
const NEGATABLE = new Set(['mt', 'mr', 'mb', 'ml', 'top', 'right', 'bottom', 'left']);

/** The spacing-scale token for `px` (`4` for 16px, `1.5` for 6px, `px` for 1px), or null when it isn't on the scale. */
export function spacingToken(px: number, scale: Scale): string | null {
  if (px === 1) return 'px';
  const step = px / 4;
  if (!Number.isFinite(step) || step < 0 || step > 400) return null;
  const onScale = scale === 'v4' ? Number.isInteger(step * 2) : V3_STEPS.has(step);
  return onScale ? String(step) : null;
}

/** `margin-left: 40px` -> `ml-10`, `margin-top: -16px` -> `-mt-4`; null when the value is off the scale. */
function snapped(prefix: string, value: string, scale: Scale): string | null {
  const m = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  if (!m) return null;
  const px = parseFloat(m[1]);
  const negative = px < 0;
  if (negative && !NEGATABLE.has(prefix)) return null;
  const token = spacingToken(Math.abs(px), scale);
  return token === null ? null : `${negative ? '-' : ''}${prefix}-${token}`;
}

/** Returns the new class string, or null if the value can't be expressed as a class. */
export function tailwindClasses(classes: string, prop: string, value: string, hints: ClassHints = {}): string | null {
  if (/[\]\[{}"';\\]/.test(value) || (hints.lineHeight && !/^[\d.]+$/.test(hints.lineHeight))) return null;
  const { remove, make } = mapping(prop.toLowerCase(), value, hints.scale);
  const tokens = classes.split(/\s+/).filter(Boolean);
  const isRemoved = (c: string) => !c.includes(':') && remove.test(c);
  const out = [...tokens.filter((c) => !isRemoved(c)), make];
  // Replacing `text-5xl` also drops its built-in line-height; pin the one the page was showing.
  const lostLineHeight = prop === 'font-size' && tokens.some((c) => isRemoved(c) && NAMED_SIZE.test(c));
  if (lostLineHeight && hints.lineHeight && !out.some((c) => !c.includes(':') && /^!?leading-/.test(c))) out.push(`leading-[${hints.lineHeight}]`);
  return out.join(' ');
}

/**
 * Variant utilities (`md:ml-4`, `hover:w-full`) in `text` that set the same property as `prop`. They keep
 * applying under their condition and win over a plain class or an inline style, so an edit made at the
 * current screen size can look ignored (class) or leak to every size (inline).
 */
export function variantConflicts(text: string, prop: string): string[] {
  const { remove } = mapping(prop.toLowerCase(), '0');
  const found = new Set<string>();
  for (const token of text.split(/[\s'"`,(){}]+/)) {
    const at = token.lastIndexOf(':');
    if (at > 0 && /^[\w-]+(:[\w-]+)*$/.test(token.slice(0, at)) && remove.test(token.slice(at + 1))) found.add(token);
  }
  return [...found];
}
