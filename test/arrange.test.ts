import { describe, expect, it } from 'vitest';
import { arrangeOffsets, type Box } from '../src/overlay/arrange';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });
const A = box(10, 10, 100, 40);
const B = box(40, 80, 60, 20);
const C = box(200, 200, 80, 100);

describe('arrangeOffsets', () => {
  it('aligns edges to the outermost one', () => {
    expect(arrangeOffsets('left', [A, B, C])!.map((o) => o.dx)).toEqual([0, -30, -190]);
    expect(arrangeOffsets('right', [A, B, C])!.map((o) => o.dx)).toEqual([170, 180, 0]);
    expect(arrangeOffsets('top', [A, B, C])!.map((o) => o.dy)).toEqual([0, -70, -190]);
    expect(arrangeOffsets('bottom', [A, B, C])!.map((o) => o.dy)).toEqual([250, 200, 0]);
  });

  it('centres on the middle of the whole group, on one axis only', () => {
    const c = arrangeOffsets('center', [A, B, C])!;
    expect(c.every((o) => o.dy === 0)).toBe(true);
    // The group spans 10 to 280, so its centre is 145.
    expect(c[0].dx).toBe(145 - 60);
    expect(c[2].dx).toBe(145 - 240);
    const m = arrangeOffsets('middle', [A, B, C])!;
    expect(m.every((o) => o.dx === 0)).toBe(true);
    expect(m[1].dy).toBe(Math.round((10 + 300) / 2 - 90));
  });

  it('leaves boxes that are already lined up where they are', () => {
    expect(arrangeOffsets('left', [box(5, 0, 10, 10), box(5, 50, 30, 10)])).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });

  it('spaces three or more evenly between the two outer ones, whatever order they were selected in', () => {
    const boxes = [box(0, 0, 20, 10), box(250, 0, 50, 10), box(30, 0, 30, 10)]; // selected out of order
    const out = arrangeOffsets('space-x', boxes)!;
    // Left to right: 0..20, 30..60, 250..300. Free space 300 - (20+30+50) = 200, so the gap is 100.
    expect(out[0].dx).toBe(0);
    expect(out[1].dx).toBe(0);
    expect(out[2].dx).toBe(120 - 30); // the middle box moves from 30 to 120
    // Vertically: 0..20, 25..45, 100..120 leaves 60 free, so the gap is 30 and the middle box goes from 25 to 50.
    const v = arrangeOffsets('space-y', [box(0, 0, 10, 20), box(0, 25, 10, 20), box(0, 100, 10, 20)])!;
    expect(v.map((o) => o.dy)).toEqual([0, 25, 0]);
  });

  it('needs two boxes to align and three to space', () => {
    expect(arrangeOffsets('left', [A])).toBeNull();
    expect(arrangeOffsets('space-x', [A, B])).toBeNull();
  });
});
