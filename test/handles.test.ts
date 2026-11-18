import { describe, expect, it } from 'vitest';
import { handleLabel, handleProps, snap, type BoxStart } from '../src/overlay/handles-math';

const start: BoxStart = { width: 240, height: 100, pad: { t: 8, r: 16, b: 8, l: 16 }, mar: { t: 0, r: 12, b: 0, l: 12 } };

describe('snap', () => {
  it('snaps to the 4px grid, or whole pixels when free', () => {
    expect(snap(17, false)).toBe(16);
    expect(snap(18, false)).toBe(20);
    expect(snap(17.4, true)).toBe(17);
  });
});

describe('resize handles', () => {
  it('east changes width only, south height only, corner both', () => {
    expect(handleProps('resize-e', start, 30, 99, false)).toEqual({ width: '272px' });
    expect(handleProps('resize-s', start, 99, -20, false)).toEqual({ height: '80px' });
    expect(handleProps('resize-se', start, 10, 10, false)).toEqual({ width: '252px', height: '112px' });
  });

  it('never goes below zero', () => {
    expect(handleProps('resize-e', start, -500, 0, false)).toEqual({ width: '0px' });
  });

  it('free mode keeps whole pixels instead of the grid', () => {
    expect(handleProps('resize-e', start, 7, 0, true)).toEqual({ width: '247px' });
  });
});

describe('padding handles grow inward', () => {
  it('right: dragging left grows it', () => {
    expect(handleProps('pad-r', start, -8, 0, false)).toEqual({ 'padding-right': '24px' });
    expect(handleProps('pad-r', start, 8, 0, false)).toEqual({ 'padding-right': '8px' });
  });
  it('left: dragging right grows it', () => {
    expect(handleProps('pad-l', start, 8, 0, false)).toEqual({ 'padding-left': '24px' });
  });
  it('top: dragging down grows it; bottom: dragging up grows it', () => {
    expect(handleProps('pad-t', start, 0, 8, false)).toEqual({ 'padding-top': '16px' });
    expect(handleProps('pad-b', start, 0, -8, false)).toEqual({ 'padding-bottom': '16px' });
  });
  it('is clamped at zero', () => {
    expect(handleProps('pad-t', start, 0, -100, false)).toEqual({ 'padding-top': '0px' });
  });
});

describe('margin handles grow outward', () => {
  it('right: dragging right grows it; left: dragging left grows it', () => {
    expect(handleProps('mar-r', start, 8, 0, false)).toEqual({ 'margin-right': '20px' });
    expect(handleProps('mar-l', start, -8, 0, false)).toEqual({ 'margin-left': '20px' });
  });
  it('top: dragging up grows it; bottom: dragging down grows it', () => {
    expect(handleProps('mar-t', start, 0, -16, false)).toEqual({ 'margin-top': '16px' });
    expect(handleProps('mar-b', start, 0, 16, false)).toEqual({ 'margin-bottom': '16px' });
  });
});

describe('label', () => {
  it('names each changed property', () => {
    expect(handleLabel({ width: '252px', height: '112px' })).toBe('width 252px · height 112px');
  });
});
