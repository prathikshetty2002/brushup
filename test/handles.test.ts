import { describe, expect, it } from 'vitest';
import { explainSize, handleLabel, handleProps, sizeProperty, sizeProps, snap, type BoxStart, type SizeStyle } from '../src/overlay/handles-math';

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

describe('what really sizes an element', () => {
  const plain: SizeStyle = { display: 'block', flexBasis: 'auto', flexGrow: '0', maxWidth: 'none', minWidth: '0px', maxHeight: 'none', minHeight: '0px', parentDisplay: 'block', parentFlexDirection: 'row' };
  const flexItem = (extra: Partial<SizeStyle> = {}): SizeStyle => ({ ...plain, parentDisplay: 'flex', ...extra });

  it('is width / height for ordinary elements and flex items with no flex-basis', () => {
    expect(sizeProperty('width', plain)).toBe('width');
    expect(sizeProperty('width', flexItem())).toBe('width');
    expect(sizeProperty('width', flexItem({ flexBasis: 'content' }))).toBe('width');
  });

  it('is flex-basis for the main axis of a flex item that sets one', () => {
    expect(sizeProperty('width', flexItem({ flexBasis: '200px' }))).toBe('flex-basis');
    expect(sizeProperty('height', flexItem({ flexBasis: '200px' }))).toBe('height'); // the cross axis is still height
    expect(sizeProperty('height', flexItem({ flexBasis: '30%', parentFlexDirection: 'column' }))).toBe('flex-basis');
    expect(sizeProps({ width: '240px', height: '80px' }, flexItem({ flexBasis: '200px' }))).toEqual({ 'flex-basis': '240px', height: '80px' });
    expect(sizeProps({ 'padding-left': '8px' }, flexItem({ flexBasis: '200px' }))).toEqual({ 'padding-left': '8px' });
  });

  it('explains why a size did not land', () => {
    expect(explainSize('width', 300, { ...plain, maxWidth: '240px' })).toBe('max-width caps it at 240px');
    expect(explainSize('width', 100, { ...plain, minWidth: '160px' })).toBe('min-width keeps it at 160px');
    expect(explainSize('height', 100, { ...plain, display: 'inline' })).toBe('inline elements ignore width and height');
    expect(explainSize('width', 300, flexItem({ flexGrow: '1' }))).toBe('flex-grow stretches it to fill the row');
    expect(explainSize('height', 300, flexItem({ flexGrow: '1' }))).toBeNull(); // grow only acts on the main axis
    expect(explainSize('width', 300, { ...plain, parentDisplay: 'grid' })).toBe('its grid track sets the size');
    expect(explainSize('width', 300, plain)).toBeNull();
  });
});
