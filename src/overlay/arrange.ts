/**
 * Lining up a selection: how far each box has to move so the group is aligned or evenly spaced. The moves are then written the
 * way a drag is (margins in flow, top/left when positioned), so nothing new is needed to save them.
 */
export type Arrange = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'space-x' | 'space-y';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Offset {
  dx: number;
  dy: number;
}

/** Aligning needs two boxes and spacing needs three (the two outer ones stay where they are). */
export const needs = (kind: Arrange): number => (kind === 'space-x' || kind === 'space-y' ? 3 : 2);

/** How far each box moves, in the order given, or null when there are too few boxes for `kind`. Whole pixels. */
export function arrangeOffsets(kind: Arrange, boxes: Box[]): Offset[] | null {
  if (boxes.length < needs(kind)) return null;
  const right = (b: Box) => b.left + b.width;
  const bottom = (b: Box) => b.top + b.height;
  const minLeft = Math.min(...boxes.map((b) => b.left));
  const maxRight = Math.max(...boxes.map(right));
  const minTop = Math.min(...boxes.map((b) => b.top));
  const maxBottom = Math.max(...boxes.map(bottom));
  const round = (n: number) => Math.round(n) || 0; // no -0
  switch (kind) {
    case 'left':
      return boxes.map((b) => ({ dx: round(minLeft - b.left), dy: 0 }));
    case 'right':
      return boxes.map((b) => ({ dx: round(maxRight - right(b)), dy: 0 }));
    case 'center':
      return boxes.map((b) => ({ dx: round((minLeft + maxRight) / 2 - (b.left + b.width / 2)), dy: 0 }));
    case 'top':
      return boxes.map((b) => ({ dx: 0, dy: round(minTop - b.top) }));
    case 'bottom':
      return boxes.map((b) => ({ dx: 0, dy: round(maxBottom - bottom(b)) }));
    case 'middle':
      return boxes.map((b) => ({ dx: 0, dy: round((minTop + maxBottom) / 2 - (b.top + b.height / 2)) }));
    case 'space-x':
    case 'space-y': {
      const x = kind === 'space-x';
      const start = (b: Box) => (x ? b.left : b.top);
      const size = (b: Box) => (x ? b.width : b.height);
      const order = boxes.map((_, i) => i).sort((a, b) => start(boxes[a]) - start(boxes[b]));
      const first = boxes[order[0]];
      const last = boxes[order[order.length - 1]];
      const span = start(last) + size(last) - start(first);
      const gap = (span - order.reduce((sum, i) => sum + size(boxes[i]), 0)) / (order.length - 1);
      const out: Offset[] = boxes.map(() => ({ dx: 0, dy: 0 }));
      let at = start(first) + size(first) + gap;
      for (const i of order.slice(1, -1)) {
        const move = round(at - start(boxes[i]));
        out[i] = x ? { dx: move, dy: 0 } : { dx: 0, dy: move };
        at += size(boxes[i]) + gap;
      }
      return out;
    }
  }
}
