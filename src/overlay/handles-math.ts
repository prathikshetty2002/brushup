/**
 * The arithmetic behind the drag handles, kept free of the DOM so it can be tested.
 *
 *   resize-e / resize-s / resize-se  change width / height
 *   pad-{t,r,b,l}                    padding on one side; dragging inward grows it
 *   mar-{t,r,b,l}                    margin on one side; dragging outward grows it
 */
export type Side = 't' | 'r' | 'b' | 'l';
export type HandleKind = 'resize-e' | 'resize-s' | 'resize-se' | `pad-${Side}` | `mar-${Side}`;

export const GRID = 4;
export const SIDES: Side[] = ['t', 'r', 'b', 'l'];
export const HANDLE_KINDS: HandleKind[] = ['resize-e', 'resize-s', 'resize-se', ...SIDES.map((s) => `pad-${s}` as const), ...SIDES.map((s) => `mar-${s}` as const)];

export type Sides = Record<Side, number>;

/** The element's box when the drag began: its width/height as CSS sees them, and its spacing. */
export interface BoxStart {
  width: number;
  height: number;
  pad: Sides;
  mar: Sides;
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
    if (kind === 'resize-e' || kind === 'resize-se') out.width = px(Math.max(0, snap(start.width + dx, free)));
    if (kind === 'resize-s' || kind === 'resize-se') out.height = px(Math.max(0, snap(start.height + dy, free)));
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
