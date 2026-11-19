import { describe, expect, it } from 'vitest';
import { EditError, type Edit } from '../src/core/edit-types';
import { applyJsxEdit } from '../src/core/jsx-patch';
import { applyEdit } from '../src/core/patch';
import { duplicateSpan, removeSpan } from '../src/core/structure';

const FILE = '/app/src/App.tsx';

/** `file:line:col` of the element whose opening tag contains `marker`. */
const idAt = (code: string, marker: string, name?: string) => {
  const at = code.lastIndexOf('<', code.indexOf(marker));
  const before = code.slice(0, at).split('\n');
  return `src/App.tsx:${before.length}:${before[before.length - 1].length}${name ? `#${name}` : ''}`;
};
const edit = (code: string, marker: string, kind: 'delete' | 'duplicate', tag: string, name?: string): Edit => ({ kind, id: idAt(code, marker, name), tag });
const go = (code: string, e: Edit) => applyJsxEdit({ [FILE]: code }, FILE, e, { tailwind: false });
const page = (body: string) => `export default function App() {\n  return (\n    <main>\n${body}\n    </main>\n  );\n}\n`;

describe('removeSpan and duplicateSpan', () => {
  it('remove a span alone on its lines together with those lines, and just the span otherwise', () => {
    const code = 'a\n  <b>x</b>\nc\n';
    expect(removeSpan(code, 4, 12)).toBe('a\nc\n');
    expect(removeSpan('x <b>y</b> z', 2, 10)).toBe('x  z');
    expect(removeSpan('  <b>x</b>', 2, 10)).toBe(''); // the last line of the file
  });

  it('copy it on a new line at the same indentation, or right beside it when it shares a line', () => {
    expect(duplicateSpan('a\n  <b>x</b>\nc\n', 4, 12)).toBe('a\n  <b>x</b>\n  <b>x</b>\nc\n');
    expect(duplicateSpan('x <b>y</b> z', 2, 10)).toBe('x <b>y</b><b>y</b> z');
  });
});

describe('deleting an element from JSX', () => {
  const body = '      <h1 id="a">Title</h1>\n      <p id="b">Gone</p>\n      <footer id="c">End</footer>';

  it('removes it and its lines, leaving no gap', () => {
    const code = page(body);
    const out = go(code, edit(code, 'id="b"', 'delete', 'p')).files[FILE];
    expect(out).toBe(page('      <h1 id="a">Title</h1>\n      <footer id="c">End</footer>'));
    expect(go(code, edit(code, 'id="b"', 'delete', 'p')).target).toBe('structure');
  });

  it('removes a multi-line element and everything inside it', () => {
    const code = page('      <section id="s">\n        <p>one</p>\n        <p>two</p>\n      </section>\n      <p id="after">x</p>');
    expect(go(code, edit(code, 'id="s"', 'delete', 'section')).files[FILE]).toBe(page('      <p id="after">x</p>'));
  });

  it('removes a self-closing element, and one sharing a line with text', () => {
    const code = page('      <img id="i" src="a.png" />\n      <p>Hello <b id="inline">there</b> you</p>');
    expect(go(code, edit(code, 'id="i"', 'delete', 'img')).files[FILE]).toBe(page('      <p>Hello <b id="inline">there</b> you</p>'));
    expect(go(code, edit(code, 'id="inline"', 'delete', 'b')).files[FILE]).toContain('<p>Hello  you</p>');
  });

  it('removes a component usage where it is written', () => {
    const code = page('      <Card id="u" title="x" />\n      <p>keep</p>');
    expect(go(code, edit(code, 'id="u"', 'delete', 'div', 'Card')).files[FILE]).toBe(page('      <p>keep</p>'));
  });

  it('works inside a fragment', () => {
    const code = 'export default () => (\n  <>\n    <p id="a">a</p>\n    <p id="b">b</p>\n  </>\n);\n';
    expect(go(code, edit(code, 'id="a"', 'delete', 'p')).files[FILE]).toBe('export default () => (\n  <>\n    <p id="b">b</p>\n  </>\n);\n');
  });
});

describe('duplicating an element in JSX', () => {
  it('writes the copy right after it at the same indentation, multi-line inner indentation intact', () => {
    const code = page('      <section>\n        <p>one</p>\n      </section>');
    const out = go(code, edit(code, '<section', 'duplicate', 'section')).files[FILE];
    expect(out).toBe(page('      <section>\n        <p>one</p>\n      </section>\n      <section>\n        <p>one</p>\n      </section>'));
  });

  it('warns when the copy would repeat an id', () => {
    const code = page('      <p id="dup">x</p>');
    const r = go(code, edit(code, 'id="dup"', 'duplicate', 'p'));
    expect(r.warning).toMatch(/same id/);
    expect(go(page('      <p>x</p>'), edit(page('      <p>x</p>'), '<p', 'duplicate', 'p')).warning).toBeUndefined();
  });
});

describe('what it refuses, and why', () => {
  const refuse = (code: string, marker: string, tag: string, kind: 'delete' | 'duplicate' = 'delete') => {
    let message = '';
    try {
      go(code, edit(code, marker, kind, tag));
    } catch (err) {
      expect(err).toBeInstanceOf(EditError);
      message = (err as Error).message;
    }
    return message;
  };

  it('a list item drawn by .map, since one line makes many elements', () => {
    const code = page('      {items.map((i) => (\n        <li id="li" key={i}>{i}</li>\n      ))}');
    expect(refuse(code, 'id="li"', 'li')).toMatch(/drawn from a list \(\.map\)/);
    expect(refuse(code, 'id="li"', 'li', 'duplicate')).toMatch(/list/);
  });

  it('something shown conditionally, with && or a ternary', () => {
    expect(refuse(page('      {open && <p id="c">x</p>}'), 'id="c"', 'p')).toMatch(/conditionally/);
    expect(refuse(page('      {open ? <p id="t">a</p> : <p>b</p>}'), 'id="t"', 'p')).toMatch(/conditionally/);
  });

  it('but not an element inside one of those: a plain child of a conditional or listed element is ordinary markup', () => {
    const code = page('      {open && (\n        <div>\n          <p id="deep">x</p>\n          <p>keep</p>\n        </div>\n      )}');
    const out = go(code, edit(code, 'id="deep"', 'delete', 'p')).files[FILE];
    expect(out).toContain('<p>keep</p>');
    expect(out).not.toContain('deep');
    const listed = page('      {items.map((i) => (\n        <li key={i}>\n          <b id="badge">new</b>\n          {i}\n        </li>\n      ))}');
    expect(go(listed, edit(listed, 'id="badge"', 'delete', 'b')).files[FILE]).not.toContain('badge'); // removes it from every item, as editing the template should
  });

  it('the element a component returns, and an element passed as a prop', () => {
    expect(refuse('export default function A() {\n  return <div id="root">x</div>;\n}\n', 'id="root"', 'div')).toMatch(/top-level element/);
    expect(refuse(page('      <Card icon={<i id="ic" />} />'), 'id="ic"', 'i')).toMatch(/prop|expression/);
  });

  it('leaves the file untouched when it refuses', () => {
    const code = page('      {open && <p id="c">x</p>}');
    expect(() => go(code, edit(code, 'id="c"', 'delete', 'p'))).toThrow(EditError);
  });
});

describe('static HTML pages', () => {
  const html = '<!doctype html>\n<html>\n<head><title>t</title></head>\n<body>\n  <ul>\n    <li>one</li>\n    <li>two</li>\n  </ul>\n  <img src="a.png">\n</body>\n</html>\n';
  const files = { 'index.html': html };
  const idOfTag = (tag: string, n = 0) => {
    // ids are assigned in document order by mapHtml: find the element whose tag matches
    const order = [...html.matchAll(/<([a-z0-9]+)[ >]/g)].map((m) => m[1]);
    const seen = order.map((t, i) => [t, i] as const).filter(([t]) => t === tag);
    return `a${seen[n][1] + 0}`;
  };

  it('deletes a list item with its line, duplicates it in place, and handles a void element', () => {
    const del = applyEdit(files, 'index.html', { kind: 'delete', id: idOfTag('li', 0), tag: 'li' })['index.html'];
    expect(del).toContain('<ul>\n    <li>two</li>\n  </ul>');
    expect(del).not.toContain('one');
    const dup = applyEdit(files, 'index.html', { kind: 'duplicate', id: idOfTag('li', 1), tag: 'li' })['index.html'];
    expect(dup).toContain('<li>two</li>\n    <li>two</li>\n  </ul>');
    const img = applyEdit(files, 'index.html', { kind: 'delete', id: idOfTag('img'), tag: 'img' })['index.html'];
    expect(img).not.toContain('<img');
    expect(img).toContain('</ul>\n</body>');
  });

  it('will not remove or copy the whole page, or anything in the head', () => {
    expect(() => applyEdit(files, 'index.html', { kind: 'delete', id: idOfTag('body'), tag: 'body' })).toThrow(/whole page/);
    expect(() => applyEdit(files, 'index.html', { kind: 'duplicate', id: idOfTag('title'), tag: 'title' })).toThrow(/head/);
  });
});

describe('through the dev project, as the canvas uses it', () => {
  it('writes a delete and a duplicate to disk, and undo restores them', async () => {
    const { mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { DevProject } = await import('../src/server/dev-project');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-struct-'));
    try {
      await mkdir(path.join(dir, 'src'));
      const code = page('      <h1 id="a">Title</h1>\n      <p id="b">Gone</p>\n      <footer id="c">End</footer>');
      await writeFile(path.join(dir, 'src', 'App.tsx'), code);
      const project = new DevProject(dir);
      const del = await project.edit(edit(code, 'id="b"', 'delete', 'p'));
      expect(del.target).toBe('structure');
      expect(await readFile(path.join(dir, 'src', 'App.tsx'), 'utf8')).not.toContain('Gone');
      const after = await readFile(path.join(dir, 'src', 'App.tsx'), 'utf8');
      await project.edit(edit(after, 'id="c"', 'duplicate', 'footer'));
      expect((await readFile(path.join(dir, 'src', 'App.tsx'), 'utf8')).match(/<footer/g)).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
