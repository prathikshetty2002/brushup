/**
 * The arithmetic behind the drag handles, kept free of the DOM so it can be tested.
 *
 *   resize-{e,s,se,w,n,nw,ne,sw}     change width / height; west and north edges also shift the element
 *   pad-{t,r,b,l}                    padding on one side; dragging inward grows it
 *   mar-{t,r,b,l}                    margin on one side; dragging outward grows it
 */
export type Side = 't' | 'r' | 'b' | 'l';
export type ResizeKind = 'resize-e' | 'resize-s' | 'resize-se' | 'resize-w' | 'resize-n' | 'resize-nw' | 'resize-ne' | 'resize-sw';
export type HandleKind = ResizeKind | `pad-${Side}` | `mar-${Side}`;

export const GRID = 4;
export const SIDES: Side[] = ['t', 'r', 'b', 'l'];
export const RESIZE_KINDS: ResizeKind[] = ['resize-e', 'resize-s', 'resize-se', 'resize-w', 'resize-n', 'resize-nw', 'resize-ne', 'resize-sw'];
export const HANDLE_KINDS: HandleKind[] = [...RESIZE_KINDS, ...SIDES.map((s) => `pad-${s}` as const), ...SIDES.map((s) => `mar-${s}` as const)];

export type Sides = Record<Side, number>;

/** The element's box when the drag began: its width/height as CSS sees them, and its spacing. */
export interface BoxStart {
  width: number;
  height: number;
  pad: Sides;
  mar: Sides;
  /** How the element moves (left/top if positioned, margins otherwise) and where those start: a west or north drag also shifts the element. */
  move?: { props: [string, string]; start: [number, number] };
}

const SIDE_NAME: Record<Side, string> = { t: 'top', r: 'right', b: 'bottom', l: 'left' };

/** Snap to the 4px grid (Tailwind's spacing step); `free` (Shift held) rounds to whole pixels instead. */
export const snap = (value: number, free: boolean) => (free ? Math.round(value) : Math.round(value / GRID) * GRID);

const px = (v: number) => `${v}px`;

/** Which way a side's handle moves as it grows: +1 follows the pointer, -1 opposes it. */
const SPACING_SIGN: Record<'pad' | 'mar', Record<Side, [axis: 'x' | 'y', sign: 1 | -1]>> = {
  // padding handles sit just inside the edge: dragging toward the centre grows the padding
  pad: { t: ['y', 1], b: ['y', -1], l: ['x', 1], r: ['x', -1] },
  // margin handles sit just outside the edge: dragging away from the centre grows the margin
  mar: { t: ['y', -1], b: ['y', 1], l: ['x', -1], r: ['x', 1] },
};

/** CSS declarations produced by dragging `kind` by (dx, dy) from `start`. Sizes and spacing never go below 0. */
export function handleProps(kind: HandleKind, start: BoxStart, dx: number, dy: number, free: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (kind.startsWith('resize')) {
    const east = kind === 'resize-e' || kind === 'resize-se' || kind === 'resize-ne';
    const south = kind === 'resize-s' || kind === 'resize-se' || kind === 'resize-sw';
    const west = kind === 'resize-w' || kind === 'resize-nw' || kind === 'resize-sw';
    const north = kind === 'resize-n' || kind === 'resize-nw' || kind === 'resize-ne';
    if (east) out.width = px(Math.max(0, snap(start.width + dx, free)));
    if (south) out.height = px(Math.max(0, snap(start.height + dy, free)));
    // Dragging the left or top edge resizes from that side: the size changes and the element shifts by the same amount.
    if (west) {
      const width = Math.max(0, snap(start.width - dx, free));
      out.width = px(width);
      if (start.move) out[start.move.props[0]] = px(start.move.start[0] + (start.width - width));
    }
    if (north) {
      const height = Math.max(0, snap(start.height - dy, free));
      out.height = px(height);
      if (start.move) out[start.move.props[1]] = px(start.move.start[1] + (start.height - height));
    }
    return out;
  }
  const [type, side] = kind.split('-') as ['pad' | 'mar', Side];
  const [axis, sign] = SPACING_SIGN[type][side];
  const base = (type === 'pad' ? start.pad : start.mar)[side];
  const delta = axis === 'x' ? dx : dy;
  out[`${type === 'pad' ? 'padding' : 'margin'}-${SIDE_NAME[side]}`] = px(Math.max(0, snap(base + sign * delta, free)));
  return out;
}

/** Short text shown beside the cursor while dragging, e.g. "width 240px". */
export const handleLabel = (props: Record<string, string>) =>
  Object.entries(props)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

/** The few things about an element's CSS that decide whether `width` / `height` can size it. */
export interface SizeStyle {
  display: string;
  flexBasis: string;
  flexGrow: string;
  maxWidth: string;
  minWidth: string;
  maxHeight: string;
  minHeight: string;
  parentDisplay: string;
  parentFlexDirection: string;
}

const isFlex = (display: string) => display === 'flex' || display === 'inline-flex';
const isRow = (direction: string) => !direction.startsWith('column');
const length = (v: string) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : null);

/**
 * The property that really sizes the element on this axis. A flex item whose `flex-basis` is set takes its main-axis
 * size from that and ignores `width` / `height`, so dragging a handle has to write `flex-basis` for it to do anything.
 */
export function sizeProperty(axis: 'width' | 'height', s: SizeStyle): string {
  const main = isRow(s.parentFlexDirection) ? 'width' : 'height';
  if (isFlex(s.parentDisplay) && axis === main && s.flexBasis !== '' && s.flexBasis !== 'auto' && s.flexBasis !== 'content') return 'flex-basis';
  return axis;
}

/** Re-point the size a handle wrote (`width`, `height`) at the property that actually sizes the element. */
export function sizeProps(props: Record<string, string>, s: SizeStyle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) out[key === 'width' || key === 'height' ? sizeProperty(key, s) : key] = value;
  return out;
}

/** Why an element didn't reach the size asked for on this axis, or null if the CSS gives no clear reason. */
export function explainSize(axis: 'width' | 'height', wanted: number, s: SizeStyle): string | null {
  if (s.display === 'inline') return 'inline elements ignore width and height';
  const max = length(axis === 'width' ? s.maxWidth : s.maxHeight);
  if (max !== null && wanted > max) return `max-${axis} caps it at ${Math.round(max)}px`;
  const min = length(axis === 'width' ? s.minWidth : s.minHeight);
  if (min !== null && wanted < min) return `min-${axis} keeps it at ${Math.round(min)}px`;
  const main = isRow(s.parentFlexDirection) ? 'width' : 'height';
  if (isFlex(s.parentDisplay) && axis === main && Number(s.flexGrow) > 0) return 'flex-grow stretches it to fill the row';
  if (s.parentDisplay === 'grid' || s.parentDisplay === 'inline-grid') return 'its grid track sets the size';
  return null;
}
