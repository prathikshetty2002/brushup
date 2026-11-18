import { describe, expect, it } from 'vitest';
import { annotate, mapHtml } from '../src/core/html-map';
import { applyEdit } from '../src/core/patch';
import { matches, parseSelector, specificity } from '../src/core/selector';
import { EditError, type Edit } from '../src/core/edit-types';

const ENTRY = '/site/index.html';

const page = `<!doctype html>
<html>
<head>
<style>
  .card { padding: 16px; font-size: 14px; }
  .card h2 { font-size: 24px; margin: 0 }
  #hero { margin-top: 8px; }
  @media (max-width: 600px) { .card { padding: 4px; } }
</style>
</head>
<body>
  <section id="hero" class="hero">
    <h1 style="color: red; margin: 0">
      Hello &amp; welcome
    </h1>
  </section>
  <div class="card"><h2>One</h2></div>
  <div class="card"><h2>Two</h2></div>
  <div class="solo">Solo</div>
</body>
</html>
`;

const idOf = (html: string, pick: (el: ReturnType<typeof mapHtml>['elements'][number]) => boolean) => {
  const el = mapHtml(html).elements.find(pick)!;
  return { id: el.id, tag: el.tag };
};

const run = (edit: Edit, files = { [ENTRY]: page }) => applyEdit(files, ENTRY, edit)[ENTRY];

describe('mapHtml / annotate', () => {
  it('ids body elements in document order and skips head', () => {
    const out = annotate(mapHtml(page));
    expect(out).toContain('<h1 data-ascend-id=');
    expect(out).not.toMatch(/<style data-ascend-id/);
    expect(out.replace(/ data-ascend-id="a\d+"/g, '')).toBe(page);
  });
});

describe('selector engine', () => {
  const doc = mapHtml(page);
  const h2 = doc.elements.find((e) => e.tag === 'h2')!;
  it('matches descendants, children, ids and classes', () => {
    expect(matches(h2, parseSelector('.card h2')!)).toBe(true);
    expect(matches(h2, parseSelector('.card > h2')!)).toBe(true);
    expect(matches(h2, parseSelector('section h2')!)).toBe(false);
    expect(matches(h2, parseSelector('body .card > h2')!)).toBe(true);
  });
  it('rejects selectors it cannot evaluate', () => {
    expect(parseSelector('a:hover')).toBeNull();
    expect(parseSelector('a[href]')).toBeNull();
    expect(parseSelector('a + b')).toBeNull();
  });
  it('orders by specificity', () => {
    expect(specificity(parseSelector('#a')!)).toBeGreaterThan(specificity(parseSelector('.a.b.c')!));
  });
});

describe('style edits', () => {
  it('edits an existing inline declaration in place, touching nothing else', () => {
    const out = run({ kind: 'style', ...idOf(page, (e) => e.tag === 'h1'), props: { color: 'blue' } });
    expect(out).toBe(page.replace('color: red', 'color: blue'));
  });

  it('appends to an existing inline style', () => {
    const out = run({ kind: 'style', ...idOf(page, (e) => e.tag === 'h1'), props: { 'font-size': '30px' } });
    expect(out).toContain('style="color: red; margin: 0; font-size: 30px"');
  });

  it('adds a style attribute when there is none and no rule targets the element alone', () => {
    const out = run({ kind: 'style', ...idOf(page, (e) => e.classes.includes('solo')), props: { 'font-size': '20px' } });
    expect(out).toContain('<div style="font-size: 20px" class="solo">');
  });

  it('edits a rule that targets exactly one element', () => {
    const out = run({ kind: 'style', ...idOf(page, (e) => e.attrs.id === 'hero'), props: { 'margin-top': '24px' } });
    expect(out).toBe(page.replace('#hero { margin-top: 8px; }', '#hero { margin-top: 24px; }'));
  });

  it('uses inline style, not the shared rule, when a rule hits several elements (auto scope)', () => {
    const first = mapHtml(page).elements.filter((e) => e.tag === 'h2')[0];
    const out = run({ kind: 'style', id: first.id, tag: 'h2', props: { 'font-size': '18px' } });
    expect(out).toContain('.card h2 { font-size: 24px;');
    expect(out).toContain('<h2 style="font-size: 18px">One</h2>');
    expect(out).toContain('<h2>Two</h2>');
  });

  it('edits the shared rule when scope is rule', () => {
    const first = mapHtml(page).elements.filter((e) => e.tag === 'h2')[0];
    const out = run({ kind: 'style', id: first.id, tag: 'h2', props: { 'font-size': '18px' }, scope: 'rule' });
    expect(out).toContain('.card h2 { font-size: 18px;');
    expect(out).toContain('@media (max-width: 600px) { .card { padding: 4px; } }');
  });

  it('never edits rules inside @media', () => {
    const card = mapHtml(page).elements.find((e) => e.classes.includes('card'))!;
    const out = run({ kind: 'style', id: card.id, tag: 'div', props: { padding: '20px' }, scope: 'rule' });
    expect(out).toContain('.card { padding: 20px; font-size: 14px; }');
    expect(out).toContain('@media (max-width: 600px) { .card { padding: 4px; } }');
  });

  it('writes into a linked stylesheet', () => {
    const html = '<link rel="stylesheet" href="s.css"><h1 id="t">x</h1>';
    const css = '#t {\n  font-size: 40px;\n  color: #111;\n}\n';
    const files = { [ENTRY]: html, '/site/s.css': css };
    const id = idOf(html, (e) => e.tag === 'h1');
    const out = applyEdit(files, ENTRY, { kind: 'style', ...id, props: { 'font-size': '32px' } });
    expect(out['/site/s.css']).toBe('#t {\n  font-size: 32px;\n  color: #111;\n}\n');
    expect(out[ENTRY]).toBe(html);
  });

  it('applies several props in one edit', () => {
    const out = run({ kind: 'style', ...idOf(page, (e) => e.tag === 'h1'), props: { color: 'green', 'margin-left': '4px' } });
    expect(out).toContain('color: green; margin: 0; margin-left: 4px');
  });

  it('rejects stale ids and injection attempts', () => {
    expect(() => run({ kind: 'style', id: 'a999', tag: 'div', props: { color: 'red' } })).toThrow(EditError);
    expect(() => run({ kind: 'style', id: 'a0', tag: 'span', props: { color: 'red' } })).toThrow(EditError);
    const h1 = idOf(page, (e) => e.tag === 'h1');
    expect(() => run({ kind: 'style', ...h1, props: { color: 'red; } body { display: none' } })).toThrow(EditError);
  });
});

describe('text edits', () => {
  it('replaces text and keeps surrounding whitespace', () => {
    const out = run({ kind: 'text', ...idOf(page, (e) => e.tag === 'h1'), text: 'Hi <there> & you' });
    expect(out).toContain('<h1 style="color: red; margin: 0">\n      Hi &lt;there> &amp; you\n    </h1>');
  });

  it('refuses elements that contain other elements', () => {
    expect(() => run({ kind: 'text', ...idOf(page, (e) => e.tag === 'section'), text: 'x' })).toThrow(EditError);
  });
});
