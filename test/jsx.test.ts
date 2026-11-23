import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditError, type Edit, type StyleEdit } from '../src/core/edit-types';
import { instrument } from '../src/core/jsx';
import { applyJsxEdit, TextNotHere } from '../src/core/jsx-patch';
import { isVariant, tailwindClasses } from '../src/core/tailwind';

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
    const dynamic = '<div className={cn(base("a"), on && "b")}>x</div>';
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
  return <div className={cn(base('ml-4 md:ml-8'), on && 'font-bold')}>x</div>;
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

describe('CSS modules', () => {
  const sheet = (name: string) => path.resolve(path.dirname(FILE), name);
  const code = `import styles from './card.module.css';\nexport default function C() {\n  return <div className={styles.card}>x</div>;\n}\n`;
  const css = '.card {\n  margin-left: 4px;\n  color: red;\n}\n.other { margin-left: 9px; }\n';
  const edit = (props: Record<string, string>): Edit => ({ kind: 'style', id: idOf(code, 'div'), tag: 'div', props, scope: 'rule' });
  const run = (e: Edit, extra: Record<string, string> = {}, c = code) => applyJsxEdit({ [FILE]: c, [sheet('card.module.css')]: css, ...extra }, FILE, e, { tailwind: false });

  it('edits the module rule for a class taken from the module (rule scope)', () => {
    const out = run(edit({ 'margin-left': '12px' }));
    expect(out.files[sheet('card.module.css')]).toBe('.card {\n  margin-left: 12px;\n  color: red;\n}\n.other { margin-left: 9px; }\n');
    expect(out.files[FILE]).toBe(code);
    expect(out.target).toBe('rule');
  });

  it('only looks in the module the class comes from, not a global stylesheet with the same class name', () => {
    const out = run(edit({ 'margin-left': '12px' }), { [sheet('global.css')]: '.card { margin-left: 1px; }\n' });
    expect(out.files[sheet('global.css')]).toBe('.card { margin-left: 1px; }\n');
    expect(out.files[sheet('card.module.css')]).toContain('margin-left: 12px');
  });

  it('understands styles["card"] and a module class among several in a call', () => {
    expect(run(edit({ 'margin-left': '2px' }), {}, code.replace('styles.card', "styles['card']")).files[sheet('card.module.css')]).toContain('margin-left: 2px');
    expect(run(edit({ 'margin-left': '3px' }), {}, code.replace('styles.card', "clsx(styles.nope, styles.card, on && 'x')")).files[sheet('card.module.css')]).toContain('margin-left: 3px');
  });

  it('falls back to an inline style when the module has no rule that sets the property', () => {
    const out = run(edit({ 'margin-top': '5px' }));
    expect(out.target).toBe('inline');
    expect(out.files[FILE]).toContain('style={{ marginTop: 5 }}');
    expect(out.files[sheet('card.module.css')]).toBe(css);
  });

  it('without rule scope the element keeps its module class and gets an inline style', () => {
    const out = run({ ...edit({ 'margin-left': '12px' }), scope: 'auto' } as Edit);
    expect(out.files[FILE]).toContain('style={{ marginLeft: 12 }}');
    expect(out.files[sheet('card.module.css')]).toBe(css);
  });
});

describe('text that comes from data written in the same file', () => {
  const code = `const features = [
  { title: "Drag to place", body: "Move any element where it belongs." },
  { title: 'Tune the details', body: \`Spacing, type and color.\` },
  { title: "Stay in sync", body: "When your agent edits code, it follows." },
];

export default function P() {
  return (
    <ul>
      {features.map((f) => (
        <li key={f.title}>
          <h3>{f.title}</h3>
          <p>{f.body}</p>
        </li>
      ))}
    </ul>
  );
}
`;
  const text = (tag: string, instance: number | undefined, to: string, was?: string, src = code): Edit => ({ kind: 'text', id: idOf(src, tag), tag, text: to, instance, was });
  const run = (e: Edit, src = code) => applyJsxEdit({ [FILE]: src }, FILE, e, { tailwind: false }).files[FILE];

  it('writes the edit into the item the element was rendered from', () => {
    const out = run(text('p', 1, 'Spacing, type, colour.', 'Spacing, type and color.'));
    expect(out).toContain('body: `Spacing, type, colour.`');
    expect(out).toContain('body: "Move any element where it belongs."');
    expect(out).toContain('title: \'Tune the details\'');
    expect(out).toContain('{f.body}'); // the JSX is untouched
  });

  it('works for each item, and for a title as well as a body', () => {
    expect(run(text('p', 2, 'Done.'))).toContain('body: "Done."');
    expect(run(text('h3', 0, 'Place it'))).toContain('title: "Place it"');
  });

  it('keeps each literal\'s quote style and escapes what needs it', () => {
    expect(run(text('p', 0, 'She said "hi"'))).toContain('body: "She said \\"hi\\""');
    expect(run(text('p', 1, 'a `tick` and ${x}'))).toContain('body: `a \\`tick\\` and \\${x}`');
    expect(run(text('h3', 1, "it's"))).toContain("title: 'it\\'s'");
  });

  it('understands a destructured parameter', () => {
    const src = code.replace('(f) =>', '({ title, body }) =>').replace('{f.body}', '{body}').replace('{f.title}', '{title}').replace('key={f.title}', 'key={title}');
    expect(run(text('p', 2, 'Changed', undefined, src), src)).toContain('body: "Changed"');
  });

  it('refuses when the page does not show the item the data says it should (a filter or a sort)', () => {
    expect(() => run(text('p', 0, 'x', 'Something else entirely'))).toThrow(/doesn't show item 1 of that list/);
  });

  it('refuses a list that is filtered, spread, fetched or not a plain string, and says why', () => {
    const filtered = code.replace('features.map', 'features.filter(Boolean).map');
    expect(() => run(text('p', 0, 'x', undefined, filtered), filtered)).toThrow(/built by code/);
    const spread = code.replace('{ title: "Drag to place"', '...more, { title: "Drag to place"');
    expect(() => run(text('p', 1, 'x', undefined, spread), spread)).toThrow(/spreads other lists/);
    const computed = code.replace('"Move any element where it belongs."', 'compute()');
    expect(() => run(text('p', 0, 'x', undefined, computed), computed)).toThrow(/not a plain string/);
    expect(() => run(text('p', 9, 'x'))).toThrow(/no matching item at position 10/);
  });

  it('needs to know which item, and says what the text comes from', () => {
    expect(() => run(text('p', undefined, 'x'))).toThrow(/needs to know which item/);
    const state = `export default function P({ label }) {\n  return <p>{label}</p>;\n}\n`;
    expect(() => run(text('p', 0, 'x', undefined, state), state)).toThrow(/comes from \{label\}, which is an expression/);
  });

  it('edits a literal written as an expression: {"Save"} and {`Save`}', () => {
    const quoted = 'export default () => <p>{"Save"}</p>;';
    const ticked = 'export default () => <p>{`Save`}</p>;';
    expect(run(text('p', 0, 'Saved', undefined, quoted), quoted)).toContain('{"Saved"}');
    expect(run(text('p', 0, 'Saved', undefined, ticked), ticked)).toContain('{`Saved`}');
  });
});

describe('editing for a screen size (a variant)', () => {
  const tw = { tailwind: true };
  const code = `export default function P() {
  return <div className="p-4 ml-4 md:ml-8 lg:ml-12">x</div>;
}
`;
  const e = (props: Record<string, string>, variant?: string, c = code): StyleEdit => ({ kind: 'style', id: idOf(c, 'div'), tag: 'div', props, ...(variant ? { variant } : {}) });

  it('writes the class under the variant, replacing only the one that has that same variant', () => {
    const out = run(code, e({ 'margin-left': '40px' }, 'md'), tw).files[FILE];
    expect(out).toContain('className="p-4 ml-4 lg:ml-12 md:ml-[40px]"');
  });

  it('an edit with no variant leaves the md: and lg: classes alone', () => {
    const out = run(code, e({ 'margin-left': '40px' }), tw).files[FILE];
    expect(out).toContain('className="p-4 md:ml-8 lg:ml-12 ml-[40px]"');
  });

  it('warns that a larger size still wins, but not about the size being edited', () => {
    const r = run(code, e({ 'margin-left': '40px' }, 'md'), tw);
    expect(r.warning).toMatch(/lg:ml-12/);
    expect(r.warning).not.toMatch(/md:ml-8/);
  });

  it('adds a className with the variant when there is none', () => {
    const bare = code.replace(' className="p-4 ml-4 md:ml-8 lg:ml-12"', '');
    expect(run(bare, e({ 'font-size': '30px' }, 'lg', bare), tw).files[FILE]).toContain('className="lg:text-[30px]"');
  });

  it('keeps the line-height a named size carried, under the same variant', () => {
    const big = code.replace('p-4 ml-4 md:ml-8 lg:ml-12', 'text-lg md:text-2xl');
    const out = run(big, { ...e({ 'font-size': '40px' }, 'md', big), hints: { lineHeight: '1.2' } }, tw).files[FILE];
    expect(out).toContain('md:text-[40px]');
    expect(out).toContain('md:leading-[1.2]');
    expect(out).toContain('text-lg');
  });

  it('refuses rather than write for every size when it cannot write a class', () => {
    const dyn = `export default function P({ on }) {\n  return <div className={cn(base('a'), on && 'b')}>x</div>;\n}\n`;
    expect(() => run(dyn, e({ 'margin-left': '40px' }, 'md', dyn), tw)).toThrow(/computed/);
    expect(() => run(code, e({ 'margin-left': '40px' }, 'md'), { tailwind: false })).toThrow(/needs Tailwind/);
  });

  it('writes hover, focus and dark, alone or stacked with a screen size', () => {
    const hov = `export default function P() {\n  return <div className="bg-white hover:bg-gray-100">x</div>;\n}\n`;
    expect(run(hov, e({ 'font-weight': '600' }, 'hover', hov), tw).files[FILE]).toContain('hover:font-semibold');
    expect(run(hov, e({ color: '#111111' }, 'focus', hov), tw).files[FILE]).toContain('focus:text-[#111111]');
    expect(run(hov, e({ color: '#eeeeee' }, 'dark', hov), tw).files[FILE]).toContain('dark:text-[#eeeeee]');
    expect(run(hov, e({ 'margin-left': '40px' }, 'dark:md:hover', hov), tw).files[FILE]).toContain('dark:md:hover:ml-[40px]');
    // The hover: class already there is for another property; it is kept.
    expect(run(hov, e({ 'font-weight': '600' }, 'hover', hov), tw).files[FILE]).toContain('hover:bg-gray-100');
  });

  it('replaces the same property under the same state, and not the plain one', () => {
    const both = `export default function P() {\n  return <div className="text-red-500 hover:text-blue-500">x</div>;\n}\n`;
    const out = run(both, e({ color: '#00aa00' }, 'hover', both), tw).files[FILE];
    expect(out).toContain('className="text-red-500 hover:text-[#00aa00]"');
  });

  it('only accepts known variants, in one order, since the value goes into the class name', () => {
    for (const bad of ['md:dark', 'hover:md', 'md:md', 'group-hover', 'md:', ':md', 'dark:dark'])
      expect(isVariant(bad), bad).toBe(false);
    for (const good of ['md', 'hover', 'dark', 'dark:lg', 'lg:focus', 'dark:2xl:hover']) expect(isVariant(good), good).toBe(true);
    expect(() => run(code, e({ 'margin-left': '40px' }, 'md:ml-1 evil'), tw)).toThrow(/Rejected variant/);
    expect(tailwindClasses('a', 'margin-left', '4px', {}, 'x y')).toBeNull();
  });
});

describe('theme colours', () => {
  const tw = { tailwind: true };
  const code = `export default function P() {\n  return <p className="text-lg text-muted font-medium">x</p>;\n}\n`;
  const e = (value: string, tokens?: string[]): StyleEdit => ({ kind: 'style', id: idOf(code, 'p'), tag: 'p', props: { color: value }, ...(tokens ? { hints: { colorTokens: tokens } } : {}) });

  it('writes the theme\'s own class for a theme colour, replacing the colour class already there but not the size', () => {
    const out = run(code, e('var(--color-ink)', ['ink', 'muted']), tw).files[FILE];
    expect(out).toContain('className="text-lg font-medium text-ink"');
  });

  it('replaces a theme colour class when a hex is chosen', () => {
    const out = run(code, e('#112233', ['ink', 'muted']), tw).files[FILE];
    expect(out).toContain('className="text-lg font-medium text-[#112233]"');
  });

  it('does not invent a utility for a token the page did not list', () => {
    expect(run(code, e('var(--color-nope)', ['ink']), tw).files[FILE]).toContain('text-[var(--color-nope)]');
  });
});

describe('class helpers: cn(), clsx() and friends', () => {
  const tw = { tailwind: true };
  const make = (cls: string) => `export default function P({ active, className }) {\n  return <div className={${cls}}>x</div>;\n}\n`;
  const e = (code: string, props: Record<string, string>, variant?: string): StyleEdit => ({ kind: 'style', id: idOf(code, 'div'), tag: 'div', props, ...(variant ? { variant } : {}) });
  const attr = (out: string) => /className=\{(.*)\}>x</.exec(out)![1];

  it('writes into the plain string and leaves the conditional parts alone', () => {
    const code = make(`cn('px-4 ml-2 py-2', active && 'bg-blue-500', className)`);
    const r = run(code, e(code, { 'margin-left': '40px' }), tw);
    expect(r.target).toBe('class');
    expect(attr(r.files[FILE])).toBe(`cn('px-4 py-2 ml-[40px]', active && 'bg-blue-500', className)`);
  });

  it('works for clsx, classNames, cx and twMerge, and with a template literal or double quotes', () => {
    for (const fn of ['clsx', 'classNames', 'cx', 'twMerge']) {
      const code = make(`${fn}("p-4", active && "b")`);
      expect(attr(run(code, e(code, { 'font-weight': '600' }), tw).files[FILE])).toBe(`${fn}("p-4 font-semibold", active && "b")`);
    }
    const tpl = make('cn(`p-4 ml-1`, active && "b")');
    expect(attr(run(tpl, e(tpl, { 'margin-left': '8px' }), tw).files[FILE])).toContain('`p-4 ml-[8px]`');
  });

  it('removes the old class from a second plain string, so it can not linger', () => {
    const code = make(`cn('p-4', 'ml-2 text-sm')`);
    expect(attr(run(code, e(code, { 'margin-left': '40px' }), tw).files[FILE])).toBe(`cn('p-4 ml-[40px]', 'text-sm')`);
  });

  it('warns when a conditional class sets the same property and may still win', () => {
    const code = make(`cn('p-4', active && 'ml-8', { 'ml-12': className })`);
    const r = run(code, e(code, { 'margin-left': '40px' }), tw);
    expect(r.warning).toMatch(/ml-8, ml-12 is set under a condition in cn\(\)/);
    expect(attr(r.files[FILE])).toContain(`active && 'ml-8'`); // left as it was
  });

  it('writes under a screen size too, replacing only the class with that prefix', () => {
    const code = make(`cn('p-4 md:ml-2 ml-1', active && 'b')`);
    expect(attr(run(code, e(code, { 'margin-left': '40px' }, 'md'), tw).files[FILE])).toBe(`cn('p-4 ml-1 md:ml-[40px]', active && 'b')`);
  });

  it('declines when there is no plain string to write into, since the order of the pieces would decide', () => {
    const code = make(`cn(buttonVariants(), className)`);
    const r = run(code, e(code, { 'margin-left': '40px' }), tw);
    expect(r.target).toBe('inline'); // the old fallback, with its warning
    expect(() => run(code, e(code, { 'margin-left': '40px' }, 'md'), tw)).toThrow(/computed/);
  });

  it('leaves a call to some other function alone', () => {
    const code = make(`pickClasses('p-4', active)`);
    expect(run(code, e(code, { 'margin-left': '40px' }), tw).target).toBe('inline');
  });
});

describe('template-literal classNames', () => {
  const tw = { tailwind: true };
  const make = (cls: string) => `export default function P({ active, className = '' }) {\n  return <span className={${cls}}>x</span>;\n}\n`;
  const e = (code: string, props: Record<string, string>): StyleEdit => ({ kind: 'style', id: idOf(code, 'span'), tag: 'span', props });
  const attr = (out: string) => /className=\{(.*)\}>x</.exec(out)![1];

  it('writes into the fixed classes and keeps the space before `${className}`', () => {
    const code = make('`inline-flex gap-2 ml-1 px-3 ${className}`');
    expect(attr(run(code, e(code, { 'margin-left': '40px' }), tw).files[FILE])).toBe('`inline-flex gap-2 px-3 ml-[40px] ${className}`');
  });

  it('finds the classes when the template starts with an expression, and puts nothing against it', () => {
    const code = make('`${className} p-4 ml-2`');
    expect(attr(run(code, e(code, { 'margin-left': '40px' }), tw).files[FILE])).toBe('`${className} p-4 ml-[40px]`');
    const mid = make('`p-4 ${className} ml-2`');
    // The new class joins the first run, and the stale one in the later run is dropped (a harmless space is left behind).
    expect(attr(run(mid, e(mid, { 'margin-left': '40px' }), tw).files[FILE])).toBe('`p-4 ml-[40px] ${className} `');
  });

  it('warns about a class the expressions may still add', () => {
    const code = make("`p-4 ${active ? 'ml-8' : ''}`");
    expect(run(code, e(code, { 'margin-left': '40px' }), tw).warning).toMatch(/ml-8 is set under a condition in the template/);
  });

  it('declines a template that is only expressions', () => {
    const code = make('`${className}`');
    expect(run(code, e(code, { 'margin-left': '40px' }), tw).target).toBe('inline');
  });
});

describe('named text sizes and spacing tokens', () => {
  const tw = { tailwind: true };
  const make = (cls: string) => `export default function P() {\n  return <p className="${cls}">x</p>;\n}\n`;
  const e = (code: string, props: Record<string, string>, hints: object): StyleEdit => ({ kind: 'style', id: idOf(code, 'p'), tag: 'p', props, hints });
  const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'];

  it('writes a named size as its own class, replacing the size already there and keeping the colour', () => {
    const code = make('text-lg text-red-500 font-medium');
    const out = run(code, e(code, { 'font-size': 'var(--text-3xl)' }, { textTokens: SIZES }), tw).files[FILE];
    expect(out).toContain('className="text-red-500 font-medium text-3xl"');
  });

  it('does not pin the old line-height when the new size is a named one, since it brings its own', () => {
    const code = make('text-lg');
    const out = run(code, e(code, { 'font-size': 'var(--text-xl)' }, { textTokens: SIZES, lineHeight: '1.5' }), tw).files[FILE];
    expect(out).toContain('className="text-xl"');
    expect(out).not.toContain('leading-');
    // An arbitrary size still pins the line-height the page showed.
    expect(run(code, e(code, { 'font-size': '40px' }, { lineHeight: '1.5' }), tw).files[FILE]).toContain('text-[40px] leading-[1.5]');
  });

  it('replaces a size the project\'s theme added, and a size from the theme is written by name', () => {
    const code = make('text-display p-4');
    expect(run(code, e(code, { 'font-size': 'var(--text-xl)' }, { textTokens: [...SIZES, 'display'] }), tw).files[FILE]).toContain('className="p-4 text-xl"');
    expect(run(code, e(code, { 'font-size': 'var(--text-hero)' }, { textTokens: [...SIZES, 'display', 'hero'] }), tw).files[FILE]).toContain('p-4 text-hero');
  });

  it('does not take a colour token for a size when it replaces a size', () => {
    const code = make('text-ink text-lg');
    const out = run(code, e(code, { 'font-size': 'var(--text-xl)' }, { textTokens: SIZES }), tw).files[FILE];
    expect(out).toContain('text-ink'); // the colour stays
    expect(out).toContain('text-xl');
  });

  it('never invents a size the page did not list', () => {
    const code = make('p-4');
    expect(run(code, e(code, { 'font-size': 'var(--text-nope)' }, { textTokens: SIZES }), tw).files[FILE]).toContain('text-[var(--text-nope)]');
  });

  it('writes a custom spacing token by name for a margin, padding or gap', () => {
    const code = make('p-4 ml-2');
    const out = run(code, e(code, { 'margin-left': 'var(--spacing-gutter)', 'padding-top': 'var(--spacing-gutter)' }, { spacingTokens: ['gutter'] }), tw).files[FILE];
    expect(out).toContain('ml-gutter');
    expect(out).toContain('pt-gutter');
    expect(out).not.toContain('ml-2');
    expect(run(code, e(code, { 'margin-left': 'var(--spacing-nope)' }, { spacingTokens: ['gutter'] }), tw).files[FILE]).toContain('ml-[var(--spacing-nope)]');
  });

  it('drops token names that are not plain lowercase words, since they end up in a class name', () => {
    const code = make('p-4');
    const out = run(code, e(code, { 'font-size': 'var(--text-x y)' }, { textTokens: ['x y', 'x"y'] }), tw).files[FILE];
    expect(out).not.toMatch(/text-x y|x"y/);
  });
});
