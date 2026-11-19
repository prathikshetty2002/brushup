import { describe, expect, it } from 'vitest';
import { EditError, type Edit } from '../src/core/edit-types';
import { applyJsxEdit } from '../src/core/jsx-patch';
import { applyEdit } from '../src/core/patch';

const FILE = '/app/src/App.tsx';
const idAt = (code: string, marker: string, name?: string) => {
  const at = code.lastIndexOf('<', code.indexOf(marker));
  const before = code.slice(0, at).split('\n');
  return `src/App.tsx:${before.length}:${before[before.length - 1].length}${name ? `#${name}` : ''}`;
};
const set = (code: string, marker: string, name: 'src' | 'alt', value: string, tag = 'img', comp?: string): Edit => ({ kind: 'attr', id: idAt(code, marker, comp), tag, name, value });
const go = (code: string, e: Edit) => applyJsxEdit({ [FILE]: code }, FILE, e, { tailwind: false });
const page = (body: string) => `export default function App() {\n  return (\n    <main>\n${body}\n    </main>\n  );\n}\n`;

describe('setting an image\'s src and alt in JSX', () => {
  it('replaces a string value, keeping everything else', () => {
    const code = page('      <img id="a" src="/old.png" alt="Old" className="w-10" />');
    const out = go(code, set(code, 'id="a"', 'src', '/new.png')).files[FILE];
    expect(out).toBe(page('      <img id="a" src="/new.png" alt="Old" className="w-10" />'));
    expect(go(code, set(code, 'id="a"', 'src', '/new.png')).target).toBe('attribute');
  });

  it('adds an attribute that is not there, as the first one', () => {
    const code = page('      <img id="a" src="/a.png" />');
    expect(go(code, set(code, 'id="a"', 'alt', 'A cat on a sofa')).files[FILE]).toBe(page('      <img alt="A cat on a sofa" id="a" src="/a.png" />'));
  });

  it('writes an empty alt for a decorative image, but never an empty src', () => {
    const code = page('      <img id="a" src="/a.png" />');
    expect(go(code, set(code, 'id="a"', 'alt', '')).files[FILE]).toContain('alt=""');
    expect(() => go(code, set(code, 'id="a"', 'src', '  '))).toThrow(/needs a source/);
  });

  it('changes a value written as a plain string inside braces, and keeps a template literal a template literal', () => {
    const a = page('      <img id="a" src={"/old.png"} />');
    expect(go(a, set(a, 'id="a"', 'src', '/new.png')).files[FILE]).toContain('src={"/new.png"}');
    const b = page('      <img id="b" src={`/old.png`} />');
    expect(go(b, set(b, 'id="b"', 'src', '/new.png')).files[FILE]).toContain('src={`/new.png`}');
  });

  it('writes a value with quotes or an ampersand so it still means what the user typed', () => {
    const code = page('      <img id="a" src="/a.png" />');
    expect(go(code, set(code, 'id="a"', 'alt', 'Say "hi"')).files[FILE]).toContain(`alt='Say "hi"'`);
    expect(go(code, set(code, 'id="a"', 'alt', `It's "fine"`)).files[FILE]).toContain('alt={"It\'s \\"fine\\""}');
    expect(go(code, set(code, 'id="a"', 'src', '/a.png?x=1&y=2')).files[FILE]).toContain('src="/a.png?x=1&amp;y=2"');
  });

  it('quotes the way the surrounding attributes do, not the way the imports do', () => {
    // single-quoted imports with double-quoted JSX attributes is the common Prettier style
    const mixed = "import x from 'react';\n" + page('      <img id="a" src="/a.png" width="32" />');
    expect(go(mixed, set(mixed, 'id="a"', 'src', '/b.png')).files[FILE]).toContain('src="/b.png"');
    const single = page("      <img id='a' src='/a.png' />");
    expect(go(single, set(single, "id='a'", 'src', '/b.png')).files[FILE]).toContain("src='/b.png'");
    // the majority of the element's own attributes decides, so one stray quote doesn't spread
    const odd = page("      <img id=\"a\" src='/a.png' width=\"32\" height=\"32\" />");
    expect(go(odd, set(odd, 'id="a"', 'alt', 'A')).files[FILE]).toContain('alt="A"');
    const oddOther = page("      <img id='a' src='/a.png' width=\"32\" />");
    expect(go(oddOther, set(oddOther, "id='a'", 'alt', 'A')).files[FILE]).toContain("alt='A'");
    // an element with no string attributes of its own follows the rest of the file
    const none = page("      <img id='n' />\n      <p className='c'>hi</p>");
    expect(go(none, set(none, "id='n'", 'alt', 'A')).files[FILE]).toContain("<img alt='A' id='n' />");
    const empty = page('      <img />');
    expect(go(empty, set(empty, '<img', 'alt', 'A')).files[FILE]).toContain('<img alt="A" />'); // nothing to follow: a double quote
  });

  it('refuses a value that comes from an import or a variable, and says so', () => {
    const code = page('      <img id="a" src={logo} />');
    expect(() => go(code, set(code, 'id="a"', 'src', '/x.png'))).toThrow(/comes from \{logo\}, an expression/);
    const call = page('      <img id="b" alt={t("logo")} src="/a.png" />');
    expect(() => go(call, set(call, 'id="b"', 'alt', 'Logo'))).toThrow(/expression/);
  });

  it('edits the usage of a component that renders an image, such as next/image', () => {
    const code = page('      <Image id="a" src="/old.png" alt="x" width={20} height={20} />');
    expect(go(code, set(code, 'id="a"', 'src', '/new.png', 'img', 'Image')).files[FILE]).toContain('<Image id="a" src="/new.png"');
  });
});

describe('what an attribute edit may never write', () => {
  const code = page('      <img id="a" src="/a.png" />');
  const refuse = (name: string, value: string) => () => go(code, { ...set(code, 'id="a"', 'src', value), name } as unknown as Edit);

  it('anything but src and alt', () => {
    expect(refuse('onerror', 'alert(1)')).toThrow(/only edits an image's src and alt/);
    expect(refuse('dangerouslySetInnerHTML', 'x')).toThrow(EditError);
    expect(refuse('style', 'x')).toThrow(EditError);
  });

  it('an address that runs code or reads a local file', () => {
    expect(refuse('src', 'javascript:alert(1)')).toThrow(/can't be an image source/);
    expect(refuse('src', ' JavaScript:alert(1)')).toThrow(/can't be an image source/);
    expect(refuse('src', 'file:///etc/passwd')).toThrow(/can't be an image source/);
    expect(refuse('src', 'data:text/html,<script>alert(1)</script>')).toThrow(/inline png/);
  });

  it('an inline image is fine, but not a huge one', () => {
    expect(go(code, set(code, 'id="a"', 'src', 'data:image/png;base64,iVBORw0KGgo=')).files[FILE]).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(refuse('src', `data:image/png;base64,${'A'.repeat(210_000)}`)).toThrow(/too large/);
  });

  it('control characters and very long values', () => {
    expect(refuse('src', '/a.png\n" onerror="x')).toThrow(/line break/);
    expect(() => go(code, set(code, 'id="a"', 'alt', 'x'.repeat(501)))).toThrow(/limited to 500/);
    expect(refuse('src', `/${'a'.repeat(2100)}.png`)).toThrow(/longer than 2000/);
  });
});

describe('setting src and alt on a static page', () => {
  const html = '<!doctype html>\n<html>\n<body>\n  <img src="a.png" alt="A">\n  <img data-src="lazy.png" src="b.png">\n  <img src=c.png>\n</body>\n</html>\n';
  const files = { 'index.html': html };
  const attr = (id: string, name: 'src' | 'alt', value: string) => applyEdit(files, 'index.html', { kind: 'attr', id, tag: 'img', name, value })['index.html'];

  it('replaces quoted and unquoted values, and does not mistake data-src for src', () => {
    expect(attr('a2', 'src', 'new.png')).toContain('<img src="new.png" alt="A">');
    const second = attr('a3', 'src', 'new.png');
    expect(second).toContain('<img data-src="lazy.png" src="new.png">');
    expect(attr('a4', 'src', 'new.png')).toContain('<img src="new.png">');
  });

  it('adds a missing attribute and encodes what needs it', () => {
    expect(attr('a3', 'alt', 'Tom & "Jerry"')).toContain('<img alt="Tom &amp; &quot;Jerry&quot;" data-src="lazy.png" src="b.png">');
  });

  it('applies the same limits as in JSX', () => {
    expect(() => attr('a2', 'src', 'javascript:alert(1)')).toThrow(/can't be an image source/);
    expect(() => applyEdit(files, 'index.html', { kind: 'attr', id: 'a2', tag: 'img', name: 'onclick' as any, value: 'x' })).toThrow(/only edits/);
  });
});
