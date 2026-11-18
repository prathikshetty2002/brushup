import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Edit } from '../src/core/edit-types';
import { applyJsxEdit } from '../src/core/jsx-patch';
import { spacingToken, tailwindClasses } from '../src/core/tailwind';
import { tailwindScale } from '../src/server/dev-project';

describe('spacingToken', () => {
  it('knows the v3 steps, including halves, px and the gaps in the scale', () => {
    expect(spacingToken(16, 'v3')).toBe('4');
    expect(spacingToken(6, 'v3')).toBe('1.5');
    expect(spacingToken(1, 'v3')).toBe('px');
    expect(spacingToken(0, 'v3')).toBe('0');
    expect(spacingToken(384, 'v3')).toBe('96');
    for (const off of [3, 5, 13, 60, 100, 400]) expect(spacingToken(off, 'v3'), String(off)).toBeNull();
  });

  it('v4 accepts any multiple of half a step', () => {
    expect(spacingToken(52, 'v4')).toBe('13');
    expect(spacingToken(38, 'v4')).toBe('9.5');
    expect(spacingToken(37, 'v4')).toBeNull();
    expect(spacingToken(-4, 'v4')).toBeNull();
  });
});

describe('tailwindClasses with a scale', () => {
  const t = (cls: string, prop: string, value: string, scale?: 'v3' | 'v4') => tailwindClasses(cls, prop, value, { scale });

  it('writes on-scale spacing as plain utilities and everything else as arbitrary values', () => {
    expect(t('', 'margin-left', '40px', 'v3')).toBe('ml-10');
    expect(t('', 'margin-left', '38px', 'v3')).toBe('ml-[38px]');
    expect(t('', 'margin-left', '38px', 'v4')).toBe('ml-9.5');
    expect(t('', 'padding-top', '6px', 'v3')).toBe('pt-1.5');
    expect(t('', 'gap', '12px', 'v3')).toBe('gap-3');
    expect(t('', 'width', '256px', 'v3')).toBe('w-64');
    expect(t('', 'width', '848px', 'v3')).toBe('w-[848px]');
    expect(t('', 'height', '1px', 'v3')).toBe('h-px');
    expect(t('', 'top', '0px', 'v3')).toBe('top-0');
  });

  it('writes negative margins and offsets as -mt-4, but never a negative padding or size', () => {
    expect(t('', 'margin-top', '-16px', 'v3')).toBe('-mt-4');
    expect(t('', 'left', '-8px', 'v3')).toBe('-left-2');
    expect(t('', 'padding-left', '-8px', 'v3')).toBe('pl-[-8px]');
    expect(t('', 'margin-top', '-38px', 'v3')).toBe('mt-[-38px]');
  });

  it('replaces the utility it conflicts with and keeps variants', () => {
    expect(t('mt-4 -mt-2 text-lg', 'margin-top', '24px', 'v3')).toBe('text-lg mt-6');
    expect(t('ml-4 md:ml-8', 'margin-left', '40px', 'v3')).toBe('md:ml-8 ml-10');
  });

  it('does nothing different without a scale, and leaves non-spacing properties alone', () => {
    expect(t('', 'margin-left', '40px')).toBe('ml-[40px]');
    expect(t('', 'font-size', '48px', 'v3')).toBe('text-[48px]');
    expect(t('', 'margin-left', '2.5rem', 'v3')).toBe('ml-[2.5rem]');
  });
});

describe('applyJsxEdit snaps only when the page says 1rem is 16px', () => {
  const FILE = '/app/src/App.tsx';
  const code = `export default function A() {\n  return <div className="p-2">x</div>;\n}\n`;
  const edit = (hints?: object): Edit => ({ kind: 'style', id: 'src/App.tsx:2:9', tag: 'div', props: { 'margin-left': '40px' }, hints });
  const run = (e: Edit, scale?: 'v3' | 'v4') => applyJsxEdit({ [FILE]: code }, FILE, e, { tailwind: true, scale }).files[FILE];

  it('uses plain utilities with the 16px hint', () => {
    expect(run(edit({ rootPx: 16 }), 'v3')).toContain('className="p-2 ml-10"');
  });

  it('keeps arbitrary values with another root size, no hint, or no known scale', () => {
    expect(run(edit({ rootPx: 18 }), 'v3')).toContain('ml-[40px]');
    expect(run(edit(), 'v3')).toContain('ml-[40px]');
    expect(run(edit({ rootPx: 16 }))).toContain('ml-[40px]');
  });
});

describe('tailwindScale', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'ascend-tw-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const pkg = (deps: object) => writeFile(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: deps }));

  it('prefers the installed version', async () => {
    await pkg({ tailwindcss: '^3.4.0' });
    await mkdir(path.join(dir, 'node_modules/tailwindcss'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules/tailwindcss/package.json'), JSON.stringify({ version: '4.1.2' }));
    expect(tailwindScale(dir)).toBe('v4');
  });

  it('falls back to the declared range, the v4 plugins, then v3', async () => {
    await pkg({ tailwindcss: '^3.4.1' });
    expect(tailwindScale(dir)).toBe('v3');
    await pkg({ tailwindcss: '^4.0.0' });
    expect(tailwindScale(dir)).toBe('v4');
    await pkg({ tailwindcss: 'latest', '@tailwindcss/postcss': '^4' });
    expect(tailwindScale(dir)).toBe('v4');
    await pkg({ '@tailwindcss/typography': '^0.5.0', tailwindcss: '3.3.0' });
    expect(tailwindScale(dir)).toBe('v3');
    await rm(path.join(dir, 'package.json'));
    expect(tailwindScale(dir)).toBe('v3');
  });
});
