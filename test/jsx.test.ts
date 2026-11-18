import { describe, expect, it } from 'vitest';
import { EditError, type Edit } from '../src/core/edit-types';
import { instrument } from '../src/core/jsx';
import { applyJsxEdit, TextNotHere } from '../src/core/jsx-patch';
import { tailwindClasses } from '../src/core/tailwind';

const FILE = '/app/src/App.tsx';

const src = `import { useState } from 'react';
import './App.css';

export default function App() {
  const [n, setN] = useState(0);
  return (
    <main className="page">
      <h1 style={{ color: 'red', margin: 0 }}>
        Hello world
      </h1>
      <p className="lede text-gray-500 ml-4 md:ml-8">Intro</p>
      <button onClick={() => setN(n + 1)}>{n}</button>
      <div>Plain</div>
      <section style={styles.box}>x</section>
    </main>
  );
}
`;

/** `file:line:col` id of the first element with this tag, found by locating its `<tag` in the source. */
const idOf = (code: string, tag: string) => {
  const at = code.indexOf(`<${tag}`);
  const before = code.slice(0, at).split('\n');
  return `src/App.tsx:${before.length}:${before[before.length - 1].length}`;
};

const run = (code: string, edit: Edit, opts = { tailwind: false }, extra: Record<string, string> = {}) =>
  applyJsxEdit({ [FILE]: code, ...extra }, FILE, edit, opts);

const style = (code: string, tag: string, props: Record<string, string>, scope?: 'auto' | 'rule'): Edit => ({ kind: 'style', id: idOf(code, tag), tag, props, scope });

/** The tags without their version tokens, for tests about where the refs point. */
const noVer = (code: string) => code.replace(/ data-brushup-[su]v="[^"]+"/g, '');

describe('instrument', () => {
  it('tags host elements only, and changes nothing else', () => {
    const out = instrument(src, FILE, 'src/App.tsx')!;
    expect(noVer(out.code)).toContain('<h1 data-brushup-src="src/App.tsx:8:6" style=');
    expect(out.code).not.toMatch(/<App|<Fragment/);
    expect(out.code.replace(/ data-brushup-(src|sv)="[^"]+"/g, '')).toBe(src);
  });

  it('ids point at the element they tag', () => {
    const out = instrument(src, FILE, 'src/App.tsx')!;
    expect(noVer(out.code)).toContain(`<div data-brushup-src="${idOf(src, 'div')}">`);
  });

  it('skips files with no JSX or that fail to parse', () => {
    expect(instrument('const a = 1;', FILE, 'a.tsx')).toBeNull();
    expect(instrument('<div', FILE, 'a.tsx')).toBeNull();
  });

  it('tags component usages with their name, and host elements inside them as before', () => {
    expect(noVer(instrument('const x = <Card><b>hi</b></Card>;', FILE, 'a.tsx')!.code)).toBe(
      'const x = <Card data-brushup-use="a.tsx:1:10#Card"><b data-brushup-src="a.tsx:1:16">hi</b></Card>;',
    );
  });

  it('leaves components alone when usage tagging is off', () => {
    expect(noVer(instrument('const x = <Card><b>hi</b></Card>;', FILE, 'a.tsx', { usage: false })!.code)).toBe('const x = <Card><b data-brushup-src="a.tsx:1:16">hi</b></Card>;');
  });

  it('tags member components and keeps generic arguments intact', () => {
    const out = noVer(instrument('const x = <Dialog.Trigger asChild><List<string> items={a} /></Dialog.Trigger>;', FILE, 'a.tsx')!.code);
    expect(out).toContain('<Dialog.Trigger data-brushup-use="a.tsx:1:10#Dialog.Trigger" asChild>');
    expect(out).toContain('<List<string> data-brushup-use="a.tsx:1:34#List" items={a} />');
  });

  it('never tags components that accept no props', () => {
    const out = instrument('const x = <><Suspense fallback={f}><Ctx.Provider value={v}><React.Fragment><i /></React.Fragment></Ctx.Provider></Suspense></>;', FILE, 'a.tsx')!.code;
    expect(out).not.toMatch(/<(Suspense|Ctx\.Provider|React\.Fragment) data-brushup/);
    expect(out).toContain('<i data-brushup-src=');
  });
});

describe('component usage edits (shadcn style)', () => {
  const page = `export default function Page() {
  return (
    <div>
      <Button variant="outline" className="px-4">Save</Button>
      <Button>{label}</Button>
      <Card.Header>Plain</Card.Header>
    </div>
  );
}
`;
  const useRef = (name: string) => {
    const at = page.indexOf(`<${name}`);
    const before = page.slice(0, at).split('\n');
    return `src/App.tsx:${before.length}:${before[before.length - 1].length}#${name}`;
  };
  const edit = (name: string, props: Record<string, string>): Edit => ({ kind: 'style', id: useRef(name), tag: 'button', props });
  const go = (e: Edit, tailwind = true) => applyJsxEdit({ [FILE]: page }, FILE, e, { tailwind }).files[FILE];

  it('adds the utility to the usage site className (the component merges it at runtime)', () => {
    expect(go(edit('Button', { height: '40px' }))).toContain('<Button variant="outline" className="px-4 h-[40px]">Save</Button>');
  });

  it('adds a className to a usage that has none, and uses style props without Tailwind', () => {
    expect(go(edit('Card.Header', { 'margin-top': '12px' }))).toContain('<Card.Header className="mt-[12px]">Plain</Card.Header>');
    expect(go(edit('Card.Header', { 'margin-top': '12px' }), false)).toContain('<Card.Header style={{ marginTop: 12 }}>Plain</Card.Header>');
  });

  it('edits text written at the usage site', () => {
    const out = applyJsxEdit({ [FILE]: page }, FILE, { kind: 'text', id: useRef('Button'), tag: 'button', text: 'Save changes' }, { tailwind: true }).files[FILE];
    expect(out).toContain('>Save changes</Button>');
  });

  it('signals when the usage does not hold the text, so a fallback can be tried', () => {
    const second = page.indexOf('<Button>{label}');
    const before = page.slice(0, second).split('\n');
    const id = `src/App.tsx:${before.length}:${before[before.length - 1].length}#Button`;
    expect(() => applyJsxEdit({ [FILE]: page }, FILE, { kind: 'text', id, tag: 'button', text: 'x' }, { tailwind: true })).toThrow(TextNotHere);
  });

  it('rejects a usage reference whose component name no longer matches', () => {
    expect(() => go({ ...edit('Button', { height: '40px' }), id: useRef('Button').replace('#Button', '#Card') })).toThrow(/no longer at/);
  });
});

describe('inline style edits', () => {
  it('replaces an existing property, converting px to a React number', () => {
    const out = run(src, style(src, 'h1', { color: 'blue', margin: '12px' })).files[FILE];
    expect(out).toContain("style={{ color: 'blue', margin: 12 }}");
  });

  it('appends a property', () => {
    expect(run(src, style(src, 'h1', { 'font-size': '40px' })).files[FILE]).toContain("style={{ color: 'red', margin: 0, fontSize: 40 }}");
  });

  it('adds a style prop when there is none; unitless props stay numbers', () => {
    const out = run(src, style(src, 'div', { 'margin-left': '38px', 'line-height': '1.2', 'font-weight': '700' })).files[FILE];
    expect(out).toContain('<div style={{ marginLeft: 38, lineHeight: 1.2, fontWeight: 700 }}>Plain</div>');
  });

  it('keeps non-px values as strings, using the file quote style', () => {
    expect(run(src, style(src, 'div', { width: '50%' })).files[FILE]).toContain("<div style={{ width: '50%' }}>");
  });

  it('refuses a style prop that is not an object literal', () => {
    expect(() => run(src, style(src, 'section', { color: 'red' }))).toThrow(/not an object literal/);
  });

  it('only changes the targeted bytes', () => {
    const out = run(src, style(src, 'div', { color: 'red' })).files[FILE];
    expect(out.replace(" style={{ color: 'red' }}", '')).toBe(src);
  });
});

describe('text edits', () => {
  it('replaces JSX text, keeping the surrounding layout', () => {
    const out = run(src, { kind: 'text', id: idOf(src, 'h1'), tag: 'h1', text: 'Fish & <chips> {now}' }).files[FILE];
    expect(out).toContain('<h1 style={{ color: \'red\', margin: 0 }}>\n        Fish &amp; &lt;chips&gt; &#123;now&#125;\n      </h1>');
  });

  it('refuses text that comes from an expression', () => {
    expect(() => run(src, { kind: 'text', id: idOf(src, 'button'), tag: 'button', text: 'x' })).toThrow(/expression/);
  });
});

describe('stale references', () => {
  it('rejects a location that no longer holds that tag', () => {
    expect(() => run(src, { kind: 'style', id: 'src/App.tsx:1:0', tag: 'h1', props: { color: 'red' } })).toThrow(EditError);
    expect(() => run(src, { kind: 'style', id: idOf(src, 'h1'), tag: 'p', props: { color: 'red' } })).toThrow(EditError);
  });

  it('rejects injection through a value', () => {
    expect(() => run(src, style(src, 'div', { color: 'red; } x {' }))).toThrow(EditError);
  });
});

describe('tailwind flex-basis', () => {
  it('maps flex-basis onto the basis utilities, snapping on-scale values', () => {
    expect(tailwindClasses('flex-1 basis-1/2', 'flex-basis', '200px')).toBe('flex-1 basis-[200px]');
    expect(tailwindClasses('basis-1/2', 'flex-basis', '64px', { scale: 'v3' })).toBe('basis-16');
  });
});

describe('tailwind', () => {
  const tw = { tailwind: true };

  it('adds an arbitrary utility and replaces the one it conflicts with, leaving variants alone', () => {
    const out = run(src, style(src, 'p', { 'margin-left': '38px' }), tw).files[FILE];
    expect(out).toContain('className="lede text-gray-500 md:ml-8 ml-[38px]"');
  });

  it('adds a className when there is none', () => {
    expect(run(src, style(src, 'div', { 'font-size': '30px' }), tw).files[FILE]).toContain('<div className="text-[30px]">Plain</div>');
  });

  it('reports the target so the canvas can drop its preview', () => {
    expect(run(src, style(src, 'div', { color: '#fff' }), tw).target).toBe('class');
    expect(run(src, style(src, 'div', { color: '#fff' })).target).toBe('inline');
  });

  it('falls back to inline style when className is dynamic', () => {
    const dynamic = '<div className={cn("a", on && "b")}>x</div>';
    const out = run(dynamic, style(dynamic, 'div', { margin: '4px' }), tw).files[FILE];
    expect(out).toContain('style={{ margin: 4 }}');
  });

  it('maps properties distinctly: size vs colour vs weight', () => {
    expect(tailwindClasses('text-lg text-red-500 text-center font-sans', 'font-size', '40px')).toBe('text-red-500 text-center font-sans text-[40px]');
    expect(tailwindClasses('text-lg text-red-500 text-center', 'color', '#4338ca')).toBe('text-lg text-center text-[#4338ca]');
    expect(tailwindClasses('font-bold font-sans', 'font-weight', '500')).toBe('font-sans font-medium');
    expect(tailwindClasses('gap-x-2 gap-4', 'gap', '12px')).toBe('gap-x-2 gap-[12px]');
    expect(tailwindClasses('', 'border-radius', '8px 4px')).toBe('[border-radius:8px_4px]');
    expect(tailwindClasses('ml-4 -ml-2 mx-2', 'margin-left', '10px')).toBe('mx-2 ml-[10px]');
  });

  it('keeps the line-height of a named size it replaces, but only then', () => {
    expect(tailwindClasses('text-5xl font-bold', 'font-size', '40px', { lineHeight: '1' })).toBe('font-bold text-[40px] leading-[1]');
    expect(tailwindClasses('text-lg/7 font-bold', 'font-size', '20px', { lineHeight: '1.75' })).toBe('font-bold text-[20px] leading-[1.75]');
    // user already controls leading, or the old size was arbitrary: nothing to preserve
    expect(tailwindClasses('text-5xl leading-tight', 'font-size', '40px', { lineHeight: '1' })).toBe('leading-tight text-[40px]');
    expect(tailwindClasses('text-[48px]', 'font-size', '40px', { lineHeight: '1.5' })).toBe('text-[40px]');
    expect(tailwindClasses('font-bold', 'font-size', '40px', { lineHeight: '1.5' })).toBe('font-bold text-[40px]');
  });

  it('refuses values that could break out of the class', () => {
    expect(tailwindClasses('a', 'width', '1px] [x:y')).toBeNull();
  });
});

describe('shared rule scope', () => {
  const css = '/app/src/App.css';
  const sheet = '.page { padding: 8px; }\n.lede { font-size: 14px; color: #555 }\n.lede.big { font-size: 20px }\n';

  it('edits the rule that styles the element when scope is rule', () => {
    const out = run(src, style(src, 'p', { 'font-size': '16px' }, 'rule'), { tailwind: false }, { [css]: sheet });
    expect(out.files[css]).toContain('.lede { font-size: 16px; color: #555 }');
    expect(out.files[FILE]).toBe(src);
    expect(out.target).toBe('rule');
  });

  it('falls back to inline when no rule declares the property', () => {
    const out = run(src, style(src, 'p', { 'margin-top': '5px' }, 'rule'), { tailwind: false }, { [css]: sheet });
    expect(out.files[css]).toBe(sheet);
    expect(out.target).toBe('inline');
  });
});

describe('stale reference recovery', () => {
  const page = `export default function P() {
  return (
    <div>
      <p className="a">One</p>
      <p className="b">Two</p>
      <p className="b">Three</p>
    </div>
  );
}
`;
  // The agent added two lines above, so every recorded position is now two lines too high.
  const shifted = page.replace('  return (', '  const x = 1;\n  const y = 2;\n  return (');
  const at = (code: string, needle: string) => {
    const i = code.indexOf(needle);
    const lines = code.slice(0, i).split('\n');
    return `src/App.tsx:${lines.length}:${lines[lines.length - 1].length}`;
  };
  const ed = (id: string, ident?: { cls?: string; text?: string }): Edit => ({ kind: 'style', id, tag: 'p', props: { 'margin-left': '8px' }, ident });

  it('finds the element by what it looked like when its line moved', () => {
    const out = run(shifted, ed(at(page, '<p className="a"'), { cls: 'a', text: 'One' }), { tailwind: true }).files[FILE];
    expect(out).toContain('<p className="a ml-[8px]">One</p>');
  });

  it('tells apart elements that share a tag by text', () => {
    const out = run(shifted, ed(at(page, '<p className="b">Three'), { cls: 'b', text: 'Three' }), { tailwind: true }).files[FILE];
    expect(out).toContain('<p className="b">Two</p>');
    expect(out).toContain('<p className="b ml-[8px]">Three</p>');
  });

  it('refuses when several elements still fit', () => {
    expect(() => run(shifted, ed(at(page, '<p className="b">Two'), { cls: 'b' }), { tailwind: true })).toThrow(/no longer at/);
  });

  it('moves off a different element of the same tag that landed on the old position', () => {
    // After the shift the old line:col of "One" now holds a different <p>.
    const onto = page.replace('    <div>\n', '    <div>\n      <p className="z">Zed</p>\n');
    const out = run(onto, ed(at(page, '<p className="a"'), { cls: 'a', text: 'One' }), { tailwind: true }).files[FILE];
    expect(out).toContain('<p className="a ml-[8px]">One</p>');
    expect(out).toContain('<p className="z">Zed</p>');
  });

  it('without a fingerprint still refuses a missing element, and keeps working for an exact hit', () => {
    expect(() => run(shifted, ed(at(page, '<p className="a"')), { tailwind: true })).toThrow(/no longer at/);
    expect(run(page, ed(at(page, '<p className="a"'))).files[FILE]).toContain('style={{ marginLeft: 8 }}');
  });

  it('ignores a malformed fingerprint from the wire', () => {
    const bad = ed(at(page, '<p className="a"'), { cls: 5 as unknown as string });
    expect(run(page, bad, { tailwind: true }).files[FILE]).toContain('a ml-[8px]');
  });
});

describe('variant warnings', () => {
  const code = `export default function P() {
  return <div className="ml-4 md:ml-8">x</div>;
}
`;
  const dyn = `export default function P({ on }) {
  return <div className={cn('ml-4 md:ml-8', on && 'font-bold')}>x</div>;
}
`;
  const e = (c: string): Edit => ({ kind: 'style', id: idOf(c, 'div'), tag: 'div', props: { 'margin-left': '40px' } });

  it('warns when a responsive variant keeps winning over the class we wrote', () => {
    const r = run(code, e(code), { tailwind: true });
    expect(r.target).toBe('class');
    expect(r.warning).toMatch(/md:ml-8/);
  });

  it('warns when the inline fallback would override a variant at every size', () => {
    const r = run(dyn, e(dyn), { tailwind: true });
    expect(r.target).toBe('inline');
    expect(r.warning).toMatch(/overrides md:ml-8/);
  });

  it('stays quiet when there is no conflicting variant', () => {
    const plain = code.replace(' md:ml-8', ' md:w-1/2');
    expect(run(plain, e(plain), { tailwind: true }).warning).toBeUndefined();
    expect(run(dyn.replace('md:ml-8', 'md:p-2'), e(dyn), { tailwind: true }).warning).toBeUndefined();
  });
});
