/**
 * Turning a visual move into CSS that suits the element's layout context:
 * positioned elements move via top/left; everything else (flow, flex, grid
 * children) is offset with margin so it doesn't leave its layout.
 */
export interface MoveBase {
  props: [string, string];
  start: [number, number];
}

const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);

export function moveBase(el: HTMLElement): MoveBase {
  const cs = getComputedStyle(el);
  const positioned = cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'relative';
  if (positioned) return { props: ['left', 'top'], start: [num(cs.left), num(cs.top)] };
  return { props: ['margin-left', 'margin-top'], start: [num(cs.marginLeft), num(cs.marginTop)] };
}

export function moveProps(base: MoveBase, dx: number, dy: number): Record<string, string> {
  const px = (v: number) => `${Math.round(v)}px`;
  const out: Record<string, string> = {};
  // Only write axes that moved, so a horizontal nudge doesn't add a pointless `top: 0px`.
  if (Math.round(dx) !== 0) out[base.props[0]] = px(base.start[0] + dx);
  if (Math.round(dy) !== 0) out[base.props[1]] = px(base.start[1] + dy);
  return out;
}
