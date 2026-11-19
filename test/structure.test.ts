import { describe, expect, it } from 'vitest';
import { EditError, type Edit } from '../src/core/edit-types';
import { applyJsxEdit } from '../src/core/jsx-patch';
import { applyEdit } from '../src/core/patch';
import { duplicateSpan, removeSpan, swapSpans, wrapSpan } from '../src/core/structure';

const FILE = '/app/src/App.tsx';

/** `file:line:col` of the element whose opening tag contains `marker`. */
const idAt = (code: string, marker: string, name?: string) => {
  const at = code.lastIndexOf('<', code.indexOf(marker));
  const before = code.slice(0, at).split('\n');
  return `src/App.tsx:${before.length}:${before[before.length - 1].length}${name ? `#${name}` : ''}`;
};
const edit = (code: string, marker: string, kind: 'delete' | 'duplicate' | 'moveUp' | 'moveDown' | 'wrap', tag: string, name?: string): Edit => ({ kind, id: idAt(code, marker, name), tag });
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

describe('telling the canvas where a moved element went', () => {
  it('gives the new position of the element, so it can stay selected after the reload', async () => {
    const { mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { DevProject } = await import('../src/server/dev-project');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-move-'));
    try {
      await mkdir(path.join(dir, 'src'));
      const code = page('      <h1 id="a">One</h1>\n      <p id="b">Two</p>\n      <footer id="c">Three</footer>');
      await writeFile(path.join(dir, 'src', 'App.tsx'), code);
      const project = new DevProject(dir);
      const up = await project.edit(edit(code, 'id="b"', 'moveUp', 'p'));
      const after = await readFile(path.join(dir, 'src', 'App.tsx'), 'utf8');
      expect(up.select).toBe(idAt(after, 'id="b"')); // the p is now where the h1 was
      const down = await project.edit(edit(after, 'id="b"', 'moveDown', 'p'));
      const back = await readFile(path.join(dir, 'src', 'App.tsx'), 'utf8');
      expect(down.select).toBe(idAt(back, 'id="b"'));
      expect(back).toBe(code); // up, then down, is where it started
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

describe('wrapSpan and swapSpans', () => {
  it('wrap puts an element on its own lines in a block with the contents indented, and stays on one line when it shares one', () => {
    const code = 'a\n  <p>x</p>\nb\n';
    expect(wrapSpan(code, 4, 12)).toBe('a\n  <div>\n    <p>x</p>\n  </div>\nb\n');
    expect(wrapSpan('x <b>y</b> z', 2, 10)).toBe('x <div><b>y</b></div> z');
    const nested = '  <section>\n    <p>one</p>\n  </section>';
    expect(wrapSpan(nested, 2, nested.length)).toBe('  <div>\n    <section>\n      <p>one</p>\n    </section>\n  </div>');
  });

  it('swap exchanges two spans and leaves what is between them alone', () => {
    expect(swapSpans('[A] and [B]', [0, 3], [8, 11])).toBe('[B] and [A]');
  });
});

describe('moving an element up or down among its siblings', () => {
  const body = '      <h1 id="a">One</h1>\n      <p id="b">Two</p>\n      <footer id="c">Three</footer>';

  it('swaps with the element before it, or after it, keeping the formatting', () => {
    const code = page(body);
    expect(go(code, edit(code, 'id="b"', 'moveUp', 'p')).files[FILE]).toBe(page('      <p id="b">Two</p>\n      <h1 id="a">One</h1>\n      <footer id="c">Three</footer>'));
    expect(go(code, edit(code, 'id="b"', 'moveDown', 'p')).files[FILE]).toBe(page('      <h1 id="a">One</h1>\n      <footer id="c">Three</footer>\n      <p id="b">Two</p>'));
    expect(go(code, edit(code, 'id="b"', 'moveUp', 'p')).target).toBe('structure');
  });

  it('moves a multi-element block as a unit', () => {
    const code = page('      <section id="s">\n        <p>a</p>\n      </section>\n      <aside id="t">side</aside>');
    expect(go(code, edit(code, 'id="t"', 'moveUp', 'aside')).files[FILE]).toBe(page('      <aside id="t">side</aside>\n      <section id="s">\n        <p>a</p>\n      </section>'));
  });

  it('refuses at the ends, and says which end', () => {
    const code = page(body);
    expect(() => go(code, edit(code, 'id="a"', 'moveUp', 'h1'))).toThrow(/already the first/);
    expect(() => go(code, edit(code, 'id="c"', 'moveDown', 'footer'))).toThrow(/already the last/);
  });

  it('refuses to move past an expression or loose text, which could change what the page says or shows', () => {
    const expr = page('      <p id="a">A</p>\n      {open && <b>x</b>}\n      <p id="c">C</p>');
    expect(() => go(expr, edit(expr, 'id="a"', 'moveDown', 'p'))).toThrow(/expression/);
    const text = page('      <p id="a">A</p>\n      Some words\n      <p id="c">C</p>');
    expect(() => go(text, edit(text, 'id="c"', 'moveUp', 'p'))).toThrow(/loose text/);
  });

  it('refuses an element that is not a plain child, such as a list item', () => {
    const code = page('      {items.map((i) => (\n        <li id="li" key={i}>{i}</li>\n      ))}');
    expect(() => go(code, edit(code, 'id="li"', 'moveUp', 'li'))).toThrow(EditError);
  });
});

describe('wrapping an element in a div', () => {
  it('wraps a child, and an element in a list or a condition, since the wrapper is one more element', () => {
    const code = page('      <p id="a">Hi</p>');
    expect(go(code, edit(code, 'id="a"', 'wrap', 'p')).files[FILE]).toBe(page('      <div>\n        <p id="a">Hi</p>\n      </div>'));
    const cond = page('      {open && <p id="c">x</p>}');
    expect(go(cond, edit(cond, 'id="c"', 'wrap', 'p')).files[FILE]).toContain('{open && <div><p id="c">x</p></div>}');
  });

  it('wraps the element a component returns, which delete and duplicate refuse', () => {
    const code = 'export default function A() {\n  return <p id="r">x</p>;\n}\n';
    expect(go(code, edit(code, 'id="r"', 'wrap', 'p')).files[FILE]).toBe('export default function A() {\n  return <div><p id="r">x</p></div>;\n}\n');
  });
});

describe('moving and wrapping on a static page', () => {
  const html = '<!doctype html>\n<html>\n<body>\n  <h1>One</h1>\n  <p>Two</p>\n  <p>Three</p>\n</body>\n</html>\n';
  const files = { 'index.html': html };
  const ids = () => ({ h1: 'a2', p1: 'a3', p2: 'a4' }); // body is a1... elements in document order: html a0, body a1

  it('swaps siblings and wraps an element, and will not wrap or move the page itself', () => {
    const first = applyEdit(files, 'index.html', { kind: 'moveDown', id: ids().h1, tag: 'h1' })['index.html'];
    expect(first).toContain('<p>Two</p>\n  <h1>One</h1>\n  <p>Three</p>');
    const last = applyEdit(files, 'index.html', { kind: 'moveUp', id: ids().p2, tag: 'p' })['index.html'];
    expect(last).toContain('<h1>One</h1>\n  <p>Three</p>\n  <p>Two</p>');
    const wrapped = applyEdit(files, 'index.html', { kind: 'wrap', id: ids().p1, tag: 'p' })['index.html'];
    expect(wrapped).toContain('  <div>\n    <p>Two</p>\n  </div>');
    expect(() => applyEdit(files, 'index.html', { kind: 'moveUp', id: ids().h1, tag: 'h1' })).toThrow(/already the first/);
    expect(() => applyEdit(files, 'index.html', { kind: 'moveDown', id: ids().p2, tag: 'p' })).toThrow(/already the last/);
    expect(() => applyEdit(files, 'index.html', { kind: 'wrap', id: 'a1', tag: 'body' })).toThrow(/whole page/);
  });
});
