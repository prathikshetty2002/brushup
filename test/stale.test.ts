import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditError, StaleElement, type Edit } from '../src/core/edit-types';
import { fileHash, fingerprint, instrument, parseSource, parseVer } from '../src/core/jsx';
import { applyJsxEdit } from '../src/core/jsx-patch';
import { DevProject } from '../src/server/dev-project';

const FILE = '/app/src/page.tsx';
const REL = 'src/page.tsx';

/** The `data-brushup-sv` / `-uv` token the build stamped on the tag at `ref`, as the browser would hand it to the canvas. */
const tokenAt = (stamped: string, ref: string) => new RegExp(`data-brushup-src="${ref}" data-brushup-sv="([^"]+)"`).exec(stamped)?.[1];
/** `file:line:col` of the nth `<needle` in `code`. */
const refOf = (code: string, needle: string, nth = 0) => {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = code.indexOf(needle, at + 1);
  const lines = code.slice(0, at).split('\n');
  return `${REL}:${lines.length}:${lines[lines.length - 1].length}`;
};

const page = `export default function P({ on }) {
  return (
    <div>
      <p className={cn(base('a'), on && 'b')}>Hello</p>
      <p className={on ? 'x' : 'y'}>World</p>
    </div>
  );
}
`;
// The agent adds two lines above: every recorded position is now two lines too high, and the element that used
// to be at the first <p>'s position is the line `const y`... so pad inside the JSX instead, which lands another <p> there.
const shifted = page.replace('    <div>\n', '    <div>\n      <p className={on ? "z" : "w"}>Intruder</p>\n');

const edit = (code: string, needle: string, extra: Partial<Edit> = {}, nth = 0): Edit =>
  ({ kind: 'style', id: refOf(code, needle, nth), tag: 'p', props: { 'margin-left': '8px' }, ...extra }) as Edit;

describe('version tokens in the build tags', () => {
  const stamped = instrument(page, FILE, REL)!.code;

  it('stamp every tag with the file hash, a fingerprint and which twin it is', () => {
    const tok = parseVer(tokenAt(stamped, refOf(page, '<p className={cn')));
    expect(tok).toMatchObject({ file: fileHash(page), occ: 0, total: 1 });
    expect(tok!.fp).toMatch(/^[0-9a-z]+$/);
  });

  it('give identical elements the same fingerprint and number them in order', () => {
    const twins = '<ul><li>a</li><li>a</li><li>b</li></ul>';
    const out = instrument(`const x = ${twins};`, FILE, 'a.tsx')!.code;
    const toks = [...out.matchAll(/<li data-brushup-src="[^"]+" data-brushup-sv="([^"]+)"/g)].map((m) => parseVer(m[1])!);
    expect(toks.map((t) => [t.occ, t.total])).toEqual([[0, 2], [1, 2], [0, 1]]);
    expect(toks[0].fp).toBe(toks[1].fp);
    expect(toks[0].fp).not.toBe(toks[2].fp);
  });

  it('do not change when Brushup rewrites classes, styles or whitespace, and do change with the element itself', () => {
    const fp = (code: string) => {
      const ast = parseSource(code, FILE);
      let found = '';
      const visit = (n: any) => {
        if (n && typeof n === 'object') {
          if (n.type === 'JSXElement' && !found) found = fingerprint(code, n);
          for (const k of Object.keys(n)) if (k !== 'loc' && !found) visit(n[k]);
        }
      };
      visit(ast.program);
      return found;
    };
    const base = fp('const x = <p className="a" id="k">Hi</p>;');
    expect(fp('const x = <p className="a b ml-[8px]" id="k">Hi</p>;')).toBe(base);
    expect(fp('const x = <p style={{ margin: 0 }} id="k">Hi</p>;')).toBe(base);
    expect(fp('const x = <p   id="k">\n   Hi\n  </p>;')).toBe(base);
    expect(fp('const x = <p id="other">Hi</p>;')).not.toBe(base);
    expect(fp('const x = <p id="k">Bye</p>;')).not.toBe(base);
  });

  it('ignore a BOM and CRLF when hashing a file', () => {
    expect(fileHash('﻿a\r\nb')).toBe(fileHash('a\nb'));
  });
});

describe('finding an element after an outside edit', () => {
  const stamped = instrument(page, FILE, REL)!.code;
  const hello = tokenAt(stamped, refOf(page, '<p className={cn'))!;
  const world = tokenAt(stamped, refOf(page, '<p className={on ?'))!;
  const run = (code: string, e: Edit) => applyJsxEdit({ [FILE]: code }, FILE, e, { tailwind: true }).files[FILE];

  it('uses the fingerprint, not the position, so a look-alike that took the old position is left alone', () => {
    // The first <p>'s old position now holds the Intruder, whose className is computed too: nothing visible tells them apart.
    const out = run(shifted, edit(page, '<p className={cn', { ver: hello, stale: 'external' }));
    expect(out.split('\n').find((l) => l.includes('>Hello<'))).toContain('marginLeft: 8');
    expect(out.split('\n').find((l) => l.includes('Intruder'))).not.toContain('marginLeft');
    expect(out.match(/marginLeft/g)).toHaveLength(1);
  });

  it('without the check, the same stale position edits the wrong element', () => {
    const out = run(shifted, edit(page, '<p className={cn', { ver: hello })); // no stale flag: the older, position-trusting path
    expect(out.split('\n').find((l) => l.includes('Intruder'))).toContain('marginLeft');
  });

  it('refuses when the element itself changed, and says so as a stale reference', () => {
    const edited = shifted.replace('>Hello<', '>Hello there<');
    expect(() => run(edited, edit(page, '<p className={cn', { ver: hello, stale: 'external' }))).toThrow(StaleElement);
    expect(() => run(edited, edit(page, '<p className={cn', { ver: hello, stale: 'external' }))).toThrow(EditError);
  });

  it('trusts the position when the file is unchanged or only we changed it', () => {
    expect(run(page, edit(page, '<p className={on ?', { ver: world, stale: 'none' }))).toContain('>World</p>');
    expect(run(page, edit(page, '<p className={on ?', { ver: world, stale: 'own' })).split('\n').find((l) => l.includes('World'))).toContain('marginLeft');
  });

  describe('identical twins', () => {
    const twins = `export default function T() {\n  return <ul><li>a</li><li>a</li><li>a</li></ul>;\n}\n`;
    const toks = [...instrument(twins, FILE, REL)!.code.matchAll(/<li data-brushup-src="[^"]+" data-brushup-sv="([^"]+)"/g)].map((m) => m[1]);
    const second = { kind: 'style', id: refOf(twins, '<li>', 1), tag: 'li', props: { width: '40px' } } as Edit;

    it('keeps their order when none was added or removed', () => {
      const moved = twins.replace('export default', '// note\nexport default');
      const out = run(moved, { ...second, ver: toks[1], stale: 'external' } as Edit);
      const rows = out.split('\n')[2].match(/<li[^>]*>a<\/li>/g)!;
      expect(rows.map((r) => /w-\[40px\]/.test(r))).toEqual([false, true, false]);
    });

    it('refuses when one was added or removed, because nothing can tell them apart', () => {
      const added = twins.replace('<li>a</li>', '<li>a</li><li>a</li>');
      expect(() => run(added, { ...second, ver: toks[1], stale: 'external' } as Edit)).toThrow(StaleElement);
    });
  });
});

describe('DevProject decides how far to trust a position', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-stale-'));
    await mkdir(path.join(dir, 'src'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const file = () => path.join(dir, REL);
  const read = () => readFile(file(), 'utf8');
  /** What the page was rendered from: the tokens as the browser would see them. */
  const render = async () => instrument(await read(), file(), REL)!.code;
  const edit2 = (code: string, needle: string, tok: string | undefined, extra: Partial<Edit> = {}): Edit => ({ ...edit(code, needle), ver: tok, ...extra }) as Edit;

  it('accepts an edit on an unchanged file', async () => {
    await writeFile(file(), page);
    const stamped = await render();
    const project = new DevProject(dir, { style: 'tailwind' });
    await project.edit(edit2(page, '<p className={on ?', tokenAt(stamped, refOf(page, '<p className={on ?'))));
    expect((await read()).split('\n').find((l) => l.includes('>World<'))).toContain('marginLeft: 8');
  });

  it('after the agent edits the file, finds the element by fingerprint instead of position', async () => {
    await writeFile(file(), page);
    const stamped = await render();
    const tok = tokenAt(stamped, refOf(page, '<p className={cn'));
    await writeFile(file(), shifted);
    const project = new DevProject(dir, { style: 'tailwind' });
    await project.edit(edit2(page, '<p className={cn', tok));
    const out = await read();
    expect(out.split('\n').find((l) => l.includes('>Hello<'))).toContain('marginLeft: 8');
    expect(out.split('\n').find((l) => l.includes('Intruder'))).not.toContain('marginLeft');
  });

  it('refuses instead of guessing when the element changed, and writes nothing', async () => {
    await writeFile(file(), page);
    const tok = tokenAt(await render(), refOf(page, '<p className={cn'));
    const changed = shifted.replace('>Hello<', '>Howdy<');
    await writeFile(file(), changed);
    const project = new DevProject(dir, { style: 'tailwind' });
    await expect(project.edit(edit2(page, '<p className={cn', tok))).rejects.toThrow(StaleElement);
    expect(await read()).toBe(changed);
  });

  it('lets a quick second edit through when only Brushup changed the file in between', async () => {
    await writeFile(file(), page);
    const stamped = await render();
    const tok = tokenAt(stamped, refOf(page, '<p className={on ?'));
    const project = new DevProject(dir, { style: 'tailwind' });
    await project.edit(edit2(page, '<p className={on ?', tok)); // the page hasn't hot-reloaded yet: same stale token again
    await project.edit({ ...edit2(page, '<p className={on ?', tok), props: { 'margin-top': '4px' } } as Edit);
    expect(await read()).toContain('marginLeft: 8');
    expect(await read()).toContain('marginTop: 4');
  });

  it('is strict again once someone else edits between two of ours', async () => {
    await writeFile(file(), page);
    const tok = tokenAt(await render(), refOf(page, '<p className={cn'));
    const project = new DevProject(dir, { style: 'tailwind' });
    await project.edit(edit2(page, '<p className={cn', tok));
    await writeFile(file(), (await read()).replace('>Hello<', '>Hi<')); // the agent rewrites that element's text
    await expect(project.edit({ ...edit2(page, '<p className={cn', tok), props: { 'margin-top': '4px' } } as Edit)).rejects.toThrow(StaleElement);
  });

  it('ignores a client that claims the file is unchanged', async () => {
    await writeFile(file(), page);
    const tok = tokenAt(await render(), refOf(page, '<p className={cn'));
    await writeFile(file(), shifted);
    const project = new DevProject(dir, { style: 'tailwind' });
    await project.edit(edit2(page, '<p className={cn', tok, { stale: 'none' }));
    expect((await read()).split('\n').find((l) => l.includes('Intruder'))).not.toContain('marginLeft');
  });

  it('keeps the old position-trusting behaviour with strict: false, and without a token', async () => {
    await writeFile(file(), page);
    const tok = tokenAt(await render(), refOf(page, '<p className={cn'));
    await writeFile(file(), shifted);
    await new DevProject(dir, { style: 'tailwind', strict: false }).edit(edit2(page, '<p className={cn', tok));
    expect((await read()).split('\n').find((l) => l.includes('Intruder'))).toContain('marginLeft');
    await writeFile(file(), shifted);
    await new DevProject(dir, { style: 'tailwind' }).edit(edit2(page, '<p className={cn', undefined));
    expect((await read()).split('\n').find((l) => l.includes('Intruder'))).toContain('marginLeft');
  });

  it('accepts a root that is not spelled the way paths built from it are (forward slashes on Windows, a trailing dot segment)', async () => {
    await writeFile(file(), page);
    const tok = tokenAt(await render(), refOf(page, '<p className={on ?'));
    const project = new DevProject(`${dir}${path.sep}src${path.sep}..`, { style: 'tailwind' });
    expect(project.root).toBe(path.resolve(dir));
    await project.edit(edit2(page, '<p className={on ?', tok));
    expect((await read()).split('\n').find((l) => l.includes('>World<'))).toContain('marginLeft: 8');
  });

  it('keeps the edit log free of the tokens', async () => {
    await writeFile(file(), page);
    const tok = tokenAt(await render(), refOf(page, '<p className={cn'));
    await new DevProject(dir, { style: 'tailwind' }).edit(edit2(page, '<p className={cn', tok));
    const log = await readFile(path.join(dir, '.brushup/edits.jsonl'), 'utf8');
    expect(log).not.toMatch(/"ver"|"stale"|fallbackVer/);
  });
});
