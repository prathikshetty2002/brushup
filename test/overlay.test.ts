// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeHex } from '../src/overlay/panel';
import { click, key, layout, loadOverlay, pointer, settle, type Overlay } from './overlay-harness';

let o: Overlay;
const el = (id: string) => document.querySelector(`[data-brushup-id="${id}"]`) as HTMLElement;
const info = () => o.root.querySelector('[data-pane=style] .info')!.textContent!;
const status = () => o.root.querySelector('.status')!.textContent!;
const handle = (kind: string) => o.root.querySelector(`[data-kind="${kind}"]`)!;
const ok = async (hash = 'h1', extra: object = {}) => (await settle(), o.reply({ ok: true, hash, ...extra }), await settle());

beforeEach(async () => {
  document.body.innerHTML = `
    <h1 data-brushup-id="a1">Hello</h1>
    <p data-brushup-id="a2" class="lede">World</p>
    <div data-brushup-id="a3"><span data-brushup-id="a4">x</span></div>`;
  o = await loadOverlay({ mode: 'static' });
});
afterEach(() => o.destroy());

describe('selection', () => {
  it('selects a tagged element, tells the server, and shows it in the panel', () => {
    click(el('a1'));
    expect(o.last('select').selection).toEqual({ id: 'a1', tag: 'h1' });
    expect(info()).toContain('<h1>');
  });

  it('clicking empty space deselects', () => {
    click(el('a1'));
    click(document.body);
    expect(o.last('select').selection).toBeNull();
  });

  it('Shift+click adds to the selection and Escape clears it', () => {
    click(el('a1'));
    click(el('a2'), { shiftKey: true });
    expect(info()).toContain('2 elements selected');
    key('Escape');
    expect(o.last('select').selection).toBeNull();
  });

  it('Shift+click on a selected element removes it', () => {
    click(el('a1'));
    click(el('a2'), { shiftKey: true });
    click(el('a2'), { shiftKey: true });
    expect(info()).not.toContain('selected');
  });
});

describe('keyboard nudge and edit sending', () => {
  it('nudges the selection by 10px with Shift+Arrow, previewing instantly', () => {
    click(el('a1'));
    key('ArrowRight', { shiftKey: true });
    return settle().then(() => {
      const m = o.last('edit');
      expect(m.edit).toMatchObject({ kind: 'style', id: 'a1', tag: 'h1', props: { 'margin-left': '10px' } });
      expect(m.hash).toBe('h0');
      expect(el('a1').style.marginLeft).toBe('10px');
    });
  });

  it('only writes the axis that moved', async () => {
    click(el('a3')); // a <div>: no default browser margin to build on
    key('ArrowDown');
    await settle();
    expect(o.last('edit').edit.props).toEqual({ 'margin-top': '1px' });
  });

  it('sends several selected elements as one batch', async () => {
    click(el('a1'));
    click(el('a2'), { shiftKey: true });
    key('ArrowDown');
    await settle();
    const m = o.last('edits');
    expect(m.edits.map((e: any) => e.id)).toEqual(['a1', 'a2']);
    expect(o.all('edit')).toHaveLength(0);
  });

  it('rolls the preview back and shows the reason when the server refuses', async () => {
    click(el('a1'));
    key('ArrowRight');
    await settle();
    expect(el('a1').style.marginLeft).toBe('1px');
    o.reply({ ok: false, error: 'No rule can be edited here' });
    await settle();
    expect(el('a1').style.marginLeft).toBe('');
    expect(status()).toBe('No rule can be edited here');
  });

  it('edits are sent one at a time, each based on the hash the last one produced', async () => {
    click(el('a1'));
    key('ArrowRight');
    key('ArrowRight');
    await settle();
    expect(o.all('edit')).toHaveLength(1); // the second waits for the first
    await ok('h1');
    expect(o.all('edit')).toHaveLength(2);
    expect(o.last('edit').hash).toBe('h1');
  });

  it('a field in the Style tab edits the selection', async () => {
    click(el('a1'));
    const input = o.root.querySelector('input[data-prop="font-size"]') as HTMLInputElement;
    input.value = '20';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(o.last('edit').edit).toMatchObject({ props: { 'font-size': '20px' }, scope: 'auto' });
  });

  it('dragging a field label scrubs the value with a live preview and saves on release', async () => {
    click(el('a1'));
    const input = o.root.querySelector('input[data-prop="font-size"]') as HTMLInputElement;
    const label = input.previousElementSibling as HTMLElement;
    const start = parseFloat(input.value);
    pointer('pointerdown', label, { clientX: 100, clientY: 5 });
    pointer('pointermove', label, { clientX: 120, clientY: 5 });
    expect(parseFloat(input.value)).toBe(start + 10); // 20px across = 10 steps
    expect(el('a1').style.fontSize).toBe(`${start + 10}px`); // previewed on the page
    expect(o.all('edit')).toHaveLength(0); // nothing written yet
    pointer('pointerup', label, { clientX: 120, clientY: 5 });
    await settle();
    expect(o.last('edit').edit).toMatchObject({ props: { 'font-size': `${start + 10}px` } });
  });

  it('Shift multiplies a scrub by ten and a click on the label saves nothing', async () => {
    click(el('a1'));
    const input = o.root.querySelector('input[data-prop="font-size"]') as HTMLInputElement;
    const label = input.previousElementSibling as HTMLElement;
    const start = parseFloat(input.value);
    pointer('pointerdown', label, { clientX: 0, clientY: 0 });
    pointer('pointermove', label, { clientX: 10, clientY: 0, shiftKey: true });
    expect(parseFloat(input.value)).toBe(start + 50);
    pointer('pointerup', label, { clientX: 10, clientY: 0 });
    await ok();
    pointer('pointerdown', label, { clientX: 0, clientY: 0 });
    pointer('pointerup', label, { clientX: 0, clientY: 0 });
    await settle();
    expect(o.all('edit')).toHaveLength(1);
  });

  it('arrow keys in a number field step it and save once typing pauses', async () => {
    click(el('a1'));
    const input = o.root.querySelector('input[data-prop="font-size"]') as HTMLInputElement;
    const start = parseFloat(input.value);
    key('ArrowUp', { shiftKey: true }, input);
    key('ArrowUp', {}, input);
    expect(parseFloat(input.value)).toBe(start + 11);
    await new Promise((r) => setTimeout(r, 420));
    expect(o.all('edit')).toHaveLength(1);
    expect(o.last('edit').edit).toMatchObject({ props: { 'font-size': `${start + 11}px` } });
  });

  it('Ctrl+Z and Ctrl+Shift+Z ask the server to undo and redo', async () => {
    key('z', { ctrlKey: true });
    await settle();
    expect(o.last('undo')).toBeTruthy();
    await ok();
    key('z', { ctrlKey: true, shiftKey: true });
    await settle();
    expect(o.last('redo')).toBeTruthy();
  });
});

describe('dragging to move', () => {
  it('moves by the distance dragged, using margins for flow elements', async () => {
    pointer('pointerdown', el('a1'), { clientX: 10, clientY: 10 });
    pointer('pointermove', el('a1'), { clientX: 30, clientY: 10 });
    expect(el('a1').style.marginLeft).toBe('20px'); // live preview
    pointer('pointerup', el('a1'), { clientX: 30, clientY: 10 });
    await settle();
    expect(o.last('edit').edit.props).toEqual({ 'margin-left': '20px' });
  });

  it('ignores a tiny wobble (under 4px) so a click is not a move', async () => {
    pointer('pointerdown', el('a1'), { clientX: 10, clientY: 10 });
    pointer('pointermove', el('a1'), { clientX: 12, clientY: 11 });
    pointer('pointerup', el('a1'), { clientX: 12, clientY: 11 });
    await settle();
    expect(o.all('edit')).toHaveLength(0);
  });

  it('Shift locks the drag to the dominant axis', async () => {
    pointer('pointerdown', el('a1'), { clientX: 0, clientY: 0 });
    pointer('pointermove', el('a1'), { clientX: 30, clientY: 6, shiftKey: true });
    pointer('pointerup', el('a1'), { clientX: 30, clientY: 6 });
    await settle();
    expect(o.last('edit').edit.props).toEqual({ 'margin-left': '30px' });
  });

  it('dragging an element of a multi-selection moves them all, and a plain click collapses the group', async () => {
    click(el('a1'));
    click(el('a2'), { shiftKey: true });
    pointer('pointerdown', el('a1'), { clientX: 0, clientY: 0 });
    pointer('pointermove', el('a1'), { clientX: 8, clientY: 0 });
    pointer('pointerup', el('a1'), { clientX: 8, clientY: 0 });
    await settle();
    expect(o.last('edits').edits).toHaveLength(2);
    await ok();
    click(el('a1')); // click, no drag: narrow to just that element
    expect(info()).not.toContain('selected');
  });
});

describe('resize, padding and margin handles', () => {
  const grab = (kind: string, from: [number, number], to: [number, number], init: Partial<MouseEventInit> = {}) => {
    const g = handle(kind);
    pointer('pointerdown', g, { clientX: from[0], clientY: from[1] });
    pointer('pointermove', g, { clientX: to[0], clientY: to[1], ...init });
    return () => pointer('pointerup', g, { clientX: to[0], clientY: to[1] });
  };
  beforeEach(() => {
    el('a1').style.cssText = 'width: 200px; padding-left: 16px; margin-top: 0px';
    layout(el('a1'), { x: 50, y: 50, width: 200, height: 100 });
    click(el('a1'));
    o.tick();
  });

  it('creates every grip', () => {
    for (const kind of ['resize-e', 'resize-s', 'resize-se', 'resize-w', 'resize-n', 'resize-nw', 'resize-ne', 'resize-sw', 'pad-t', 'pad-r', 'pad-b', 'pad-l', 'mar-t', 'mar-r', 'mar-b', 'mar-l']) expect(handle(kind)).toBeTruthy();
  });

  it('resizes width from the right edge and snaps to the 4px grid', async () => {
    const release = grab('resize-e', [250, 100], [280, 100]);
    expect(o.root.querySelector('.tip')!.textContent).toBe('width 232px'); // 200 + 30 = 230 -> 232
    release();
    await settle();
    expect(o.last('edit').edit.props).toEqual({ width: '232px' });
  });

  it('writes flex-basis, not a width it would ignore, for a flex item that sets one', async () => {
    el('a1').parentElement!.style.display = 'flex';
    el('a1').style.cssText = 'width: 200px; flex-basis: 200px';
    layout(el('a1'), { x: 50, y: 50, width: 200, height: 100 });
    click(el('a2'));
    click(el('a1'));
    o.tick();
    grab('resize-e', [250, 100], [280, 100])();
    await settle();
    expect(o.last('edit').edit.props).toEqual({ 'flex-basis': '232px' });
  });

  it('says why the page did not honour a resize, and keeps saying so after saving', async () => {
    const real = window.getComputedStyle.bind(window);
    // The page refuses to grow past 240px: report that as the computed width whatever the preview asked for.
    window.getComputedStyle = ((node: Element) => {
      const cs = real(node);
      return node === el('a1') ? new Proxy(cs, { get: (t, k) => (k === 'width' ? '240px' : k === 'maxWidth' ? '240px' : (t as any)[k]) }) : cs;
    }) as typeof window.getComputedStyle;
    try {
      const release = grab('resize-e', [250, 100], [300, 100]);
      expect(o.root.querySelector('.tip')!.textContent).toBe('width 292px · not applied: max-width caps it at 240px');
      release();
      await settle();
      await ok('h1');
      expect(status()).toContain("won't show: max-width caps it at 240px");
    } finally {
      window.getComputedStyle = real;
    }
  });

  it('the left edge resizes from that side: width and the element shift change together', async () => {
    el('a1').style.cssText = 'width: 200px; margin-left: 10px; margin-top: 0px';
    layout(el('a1'), { x: 50, y: 50, width: 200, height: 100 });
    click(el('a2'));
    click(el('a1'));
    o.tick();
    grab('resize-w', [50, 100], [30, 100])();
    await settle();
    expect(o.last('edit').edit.props).toEqual({ width: '220px', 'margin-left': '-10px' });
  });

  it('Shift gives 1px precision', async () => {
    grab('resize-e', [250, 100], [280, 100], { shiftKey: true })();
    await settle();
    expect(o.last('edit').edit.props).toEqual({ width: '230px' });
  });

  it('the corner grip changes width and height together', async () => {
    grab('resize-se', [250, 150], [262, 164])();
    await settle();
    expect(Object.keys(o.last('edit').edit.props).sort()).toEqual(['height', 'width']);
  });

  it('padding grows when dragged inward', async () => {
    grab('pad-l', [66, 100], [74, 100])();
    await settle();
    expect(o.last('edit').edit.props).toEqual({ 'padding-left': '24px' });
  });

  it('margin grows when dragged outward', async () => {
    grab('mar-t', [150, 36], [150, 20])();
    await settle();
    expect(o.last('edit').edit.props).toEqual({ 'margin-top': '16px' });
  });

  it('with several elements selected the same value is applied to all, as one batch', async () => {
    click(el('a2'), { shiftKey: true });
    layout(el('a2'), { x: 50, y: 200, width: 200, height: 100 });
    o.tick();
    grab('resize-e', [250, 250], [280, 250])();
    await settle();
    const m = o.last('edits');
    expect(m.edits.map((e: any) => [e.id, e.props.width])).toEqual([['a1', expect.any(String)], ['a2', expect.any(String)]]);
  });

  it('a drag that never moves changes nothing', async () => {
    const g = handle('resize-e');
    pointer('pointerdown', g, { clientX: 250, clientY: 100 });
    pointer('pointerup', g, { clientX: 250, clientY: 100 });
    await settle();
    expect(o.all('edit')).toHaveLength(0);
  });
});

describe('inline text editing', () => {
  it('commits on Enter with the new text', async () => {
    pointer('dblclick', el('a2'));
    expect(el('a2').getAttribute('contenteditable')).toBe('plaintext-only');
    el('a2').textContent = 'Changed';
    key('Enter', {}, el('a2'));
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'text', id: 'a2', text: 'Changed' });
    expect(el('a2').hasAttribute('contenteditable')).toBe(false);
  });

  it('Escape cancels and restores the original text', async () => {
    pointer('dblclick', el('a2'));
    el('a2').textContent = 'Oops';
    key('Escape', {}, el('a2'));
    await settle();
    expect(el('a2').textContent).toBe('World');
    expect(o.all('edit')).toHaveLength(0);
  });

  it('lets spaces be typed into a <button> label (Space would otherwise press the button)', () => {
    document.body.insertAdjacentHTML('beforeend', '<button data-brushup-id="b1">Get</button>');
    const b = el('b1');
    let pressed = 0;
    b.addEventListener('click', () => pressed++);
    pointer('dblclick', b);
    getSelection()!.collapse(b.firstChild, 3); // caret after "Get"
    const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    b.dispatchEvent(down);
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    b.dispatchEvent(up);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true); // so the browser does not "click" the button on key release
    expect(b.textContent).toBe('Get ');
    expect(pressed).toBe(0);
  });

  it('does not interfere with Space in an ordinary text element', () => {
    pointer('dblclick', el('a2'));
    const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    el('a2').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false); // the browser types the space itself
  });

  it('refuses an element that contains other elements', () => {
    pointer('dblclick', el('a3'));
    expect(status()).toContain('contains other elements');
    expect(el('a3').hasAttribute('contenteditable')).toBe(false);
  });

  it('restores the text if the server cannot write it', async () => {
    pointer('dblclick', el('a2'));
    el('a2').textContent = 'Changed';
    key('Enter', {}, el('a2'));
    await settle();
    o.reply({ ok: false, error: 'comes from an expression' });
    await settle();
    expect(el('a2').textContent).toBe('World');
  });

  it('pins a note for Claude when the text comes from data the source cannot hold, once', async () => {
    for (let i = 0; i < 2; i++) {
      pointer('dblclick', el('a2'));
      el('a2').textContent = 'Changed';
      key('Enter', {}, el('a2'));
      await settle();
      o.reply({ ok: false, textSource: true, error: 'comes from {label}' });
      await settle();
      const saved = o.all('note-save');
      if (saved.length) o.receive({ type: 'notes', notes: [{ ...saved[0].note, id: 'n1', status: 'open', createdAt: '', updatedAt: '' }] });
    }
    expect(el('a2').textContent).toBe('World');
    const saves = o.all('note-save');
    expect(saves).toHaveLength(1);
    expect(saves[0].note.text).toContain('Change this text to \u201cChanged\u201d');
    expect(saves[0].note.text).toContain('it says \u201cWorld\u201d');
    expect(saves[0].note.text).toContain('comes from {label}');
  });

  it('does not pin a note for other refusals', async () => {
    pointer('dblclick', el('a2'));
    el('a2').textContent = 'Changed';
    key('Enter', {}, el('a2'));
    await settle();
    o.reply({ ok: false, error: 'No rule can be edited here' });
    await settle();
    expect(o.all('note-save')).toHaveLength(0);
  });
});

describe('notes', () => {
  const note = (over: object = {}) => ({
    id: 'n1', kind: 'section', label: 'Hero', text: 'More space please', status: 'open', createdAt: '', updatedAt: '',
    anchor: { tag: 'h1', classes: [], text: 'Hello', index: 0, page: '/' }, ...over,
  });

  it('lists notes from the server, counts the open ones, and pins them on the page', () => {
    o.receive({ type: 'notes', notes: [note(), note({ id: 'n2', status: 'done', label: 'Done one' })] });
    o.tick();
    expect(o.root.querySelectorAll('.notes-list .note')).toHaveLength(2);
    expect(o.root.querySelector('.tabs .count')!.textContent).toBe('1');
    const pins = [...o.root.querySelectorAll('.pin')];
    expect(pins.map((p) => p.textContent)).toEqual(['1', '2']);
    expect(pins[1].classList.contains('done')).toBe(true);
  });

  it('flags a note whose element is not on the page', () => {
    o.receive({ type: 'notes', notes: [note({ anchor: { tag: 'section', classes: ['gone'], text: '', index: 0, page: '/' } })] });
    expect(o.root.querySelector('.note.missing')).toBeTruthy();
  });

  it('only shows this page\'s notes and mentions the rest', () => {
    o.receive({ type: 'notes', notes: [note(), note({ id: 'n3', anchor: { tag: 'h1', classes: [], text: '', index: 0, page: '/other' } })] });
    expect(o.root.querySelectorAll('.notes-list .note')).toHaveLength(1);
    expect(o.root.querySelector('.notes-list')!.textContent).toContain('1 note on other pages');
  });

  it('N opens the composer for the selection; saving sends the note with a fingerprint anchor', async () => {
    click(el('a1'));
    key('n');
    const composer = o.root.querySelector('form.composer') as HTMLFormElement;
    expect(composer.hidden).toBe(false);
    expect(o.root.querySelector('form.composer .target')!.textContent).toBe('Note on <h1>');
    (composer.elements.namedItem('text') as HTMLTextAreaElement).value = 'Make it bigger';
    (composer.elements.namedItem('label') as HTMLInputElement).value = 'Title';
    composer.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(o.last('note-save').note).toMatchObject({
      kind: 'element', label: 'Title', text: 'Make it bigger', status: 'open',
      anchor: { tag: 'h1', text: 'Hello', sid: 'a1', index: 0, page: '/' },
    });
  });

  it('suggests "section" for a section-like element', () => {
    document.body.insertAdjacentHTML('beforeend', '<section data-brushup-id="s1">s</section>');
    click(el('s1'));
    key('n');
    expect((o.root.querySelector('form.composer select[name=kind]') as HTMLSelectElement).value).toBe('section');
  });

  it('does not save an empty note, and N does nothing with no selection', async () => {
    key('n');
    expect((o.root.querySelector('form.composer') as HTMLFormElement).hidden).toBe(true);
    click(el('a1'));
    key('n');
    (o.root.querySelector('form.composer') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(o.all('note-save')).toHaveLength(0);
  });

  it('Done and Delete send the right messages', async () => {
    o.receive({ type: 'notes', notes: [note()] });
    const buttons = [...o.root.querySelectorAll('.note .acts button')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent === 'Done')!.click();
    await settle();
    expect(o.last('note-save').note).toMatchObject({ id: 'n1', status: 'done' });
    await ok();
    buttons.find((b) => b.textContent === 'Delete')!.click();
    await settle();
    expect(o.last('note-delete').id).toBe('n1');
  });
});

describe('questions from the MCP server', () => {
  const answer = (id: string) => o.all('answer').find((m) => m.id === id)!;

  it('says so when nothing is selected', () => {
    o.receive({ type: 'ask', id: 'q1', ask: { kind: 'inspect' } });
    expect(answer('q1')).toMatchObject({ ok: false });
    expect(answer('q1').error).toContain('Nothing is selected');
  });

  it('describes the selected element: box, computed styles, overflow and parent', () => {
    el('a1').style.cssText = 'font-size: 24px; margin-left: 8px';
    layout(el('a1'), { x: 10, y: 20, width: 300, height: 40 });
    click(el('a1'));
    o.receive({ type: 'ask', id: 'q2', ask: { kind: 'inspect' } });
    const a = answer('q2');
    expect(a.ok).toBe(true);
    expect(a.data).toMatchObject({ tag: 'h1', text: 'Hello', page: '/', box: { x: 10, y: 20, width: 300, height: 40 }, parent: { tag: 'body' } });
    expect(a.data.typography['font-size']).toBe('24px');
    expect(a.data.spacing['margin-left']).toBe('8px');
  });

  it('adds what a screenshot would have shown: accessible name, contrast, what covers it and what overlaps it', () => {
    el('a2').setAttribute('style', 'color:#aaa;background:#fff;font-size:16px');
    layout(el('a2'), { x: 0, y: 100, width: 200, height: 40 });
    layout(el('a3'), { x: 100, y: 110, width: 200, height: 40 });
    document.elementFromPoint = () => el('a3'); // what is on top at a2's centre
    click(el('a2'));
    o.receive({ type: 'ask', id: 'q20', ask: { kind: 'inspect' } });
    const d = answer('q20').data;
    expect(d.handle).toEqual({ selector: 'body > p.lede', mappedToSource: true });
    expect(d.accessibility).toMatchObject({ role: 'p', name: 'World', focusable: false, hidden: false });
    expect(d.contrast).toMatchObject({ required: 4.5, passes: false, largeText: false });
    expect(d.contrast.ratio).toBeCloseTo(2.32, 1);
    expect(d.coveredAtCenterBy).toMatchObject({ tag: 'div' });
    expect(d.overlappedBy).toEqual([{ el: expect.objectContaining({ tag: 'div' }), coversPercent: 38 }]);
  });

  it('says so when the background is an image, instead of guessing a contrast ratio', () => {
    el('a2').setAttribute('style', 'background-image:linear-gradient(#000,#fff);color:#999');
    click(el('a2'));
    o.receive({ type: 'ask', id: 'q21', ask: { kind: 'inspect' } });
    expect(answer('q21').data.contrast.note).toMatch(/image or gradient/);
  });

  it('runs the checks for an agent: counts, where each problem is written, why, and the fix', () => {
    el('a2').setAttribute('style', 'color:#aaa;background:#fff;font-size:16px');
    layout(el('a2'), { x: 0, y: 0, width: 100, height: 20 });
    o.receive({ type: 'ask', id: 'q22', ask: { kind: 'check', category: 'accessibility' } });
    const d = answer('q22').data;
    expect(d.counts.accessibility).toBeGreaterThanOrEqual(1);
    const contrast = d.issues.find((i: any) => i.rule === 'contrast');
    expect(contrast).toMatchObject({ category: 'accessibility', element: { tag: 'p', text: 'World' }, suggestedFix: { color: expect.stringMatching(/^#[0-9a-f]{6}$/) }, strength: 'standard' });
    expect(contrast.basis).toMatch(/WCAG 1\.4\.3/);
    expect(d.note).toMatch(/not proof/);
    expect(d.issues.every((i: any) => i.category === 'accessibility')).toBe(true);
    o.receive({ type: 'ask', id: 'q23', ask: { kind: 'check', rule: 'contrast', limit: 1 } });
    expect(answer('q23').data.issues.map((i: any) => i.rule)).toEqual(['contrast']);
  });

  it('returns what the page logged to the console, newest first, and can filter by level', () => {
    console.warn('careful now');
    console.error(new Error('Boom: x is undefined'));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: y is not a function' }));
    o.receive({ type: 'ask', id: 'q24', ask: { kind: 'console' } });
    const d = answer('q24').data;
    expect(d.entries.map((e: any) => [e.level, e.message])).toEqual([
      ['error', 'Uncaught TypeError: y is not a function'],
      ['error', 'Boom: x is undefined'],
      ['warn', 'careful now'],
    ]);
    expect(d.entries[1].stack).toContain('Boom');
    o.receive({ type: 'ask', id: 'q25', ask: { kind: 'console', level: 'warn' } });
    expect(answer('q25').data.entries.map((e: any) => e.message)).toEqual(['careful now']);
    o.receive({ type: 'ask', id: 'q26', ask: { kind: 'console', limit: 1 } });
    expect(answer('q26').data.count).toBe(1);
  });

  it('inspects the element a note is pinned to', () => {
    o.receive({ type: 'notes', notes: [{ id: 'n9', kind: 'element', label: '', text: 'x', status: 'open', createdAt: '', updatedAt: '', anchor: { tag: 'p', classes: ['lede'], text: 'World', index: 0, page: '/' } }] });
    o.receive({ type: 'ask', id: 'q3', ask: { kind: 'inspect', noteId: 'n9' } });
    expect(answer('q3').data).toMatchObject({ tag: 'p', text: 'World', classes: ['lede'] });
  });

  it('explains when a note\'s element is not on this page, and rejects unknown questions', () => {
    o.receive({ type: 'ask', id: 'q4', ask: { kind: 'inspect', noteId: 'missing' } });
    expect(answer('q4').error).toContain('not on the page');
    o.receive({ type: 'ask', id: 'q5', ask: { kind: 'format-disk' } });
    expect(answer('q5')).toMatchObject({ ok: false, error: 'Unknown question' });
  });

  it('caps long class lists but reports the total', () => {
    el('a1').className = Array.from({ length: 30 }, (_, i) => `c${i}`).join(' ');
    click(el('a1'));
    o.receive({ type: 'ask', id: 'q6', ask: { kind: 'inspect' } });
    expect(answer('q6').data.classes).toHaveLength(12);
    expect(answer('q6').data.classesTotal).toBe(30);
  });
});

describe('Preview mode', () => {
  it('stops selecting and moving so the page can be used normally', () => {
    (o.root.querySelector('[data-mode=preview]') as HTMLButtonElement).click();
    const before = o.all('select').length;
    click(el('a1'));
    expect(o.all('select')).toHaveLength(before);
    key('ArrowRight');
    expect(o.all('edit')).toHaveLength(0);
  });
});

describe('keeping a moved element selected in dev mode', () => {
  beforeEach(async () => {
    o.destroy();
    document.body.innerHTML = `
      <p data-brushup-src="src/App.tsx:5:6">Intro</p>
      <ul data-brushup-src="src/App.tsx:6:6"><li data-brushup-src="src/App.tsx:7:8">item</li></ul>`;
    o = await loadOverlay({ mode: 'dev' });
  });

  it('selects the element where it ended up once the page has updated, not its neighbour', async () => {
    const p = () => document.querySelector('p') as HTMLElement;
    click(p());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'moveDown', id: 'src/App.tsx:5:6', tag: 'p' });
    o.reply({ ok: true, hash: 'h1', target: 'structure', select: 'src/App.tsx:6:6' }); // the p now starts where the ul used to
    await settle();
    // The page has not updated yet: that position still holds the ul, and it must not be picked.
    await new Promise((r) => setTimeout(r, 200));
    expect(o.last('select').selection).toEqual({ id: 'src/App.tsx:5:6', tag: 'p' });
    // Hot reload swaps the references, as the server rewrote the file.
    p().setAttribute('data-brushup-src', 'src/App.tsx:6:6');
    document.querySelector('ul')!.setAttribute('data-brushup-src', 'src/App.tsx:5:6');
    await new Promise((r) => setTimeout(r, 400));
    expect(o.last('select').selection).toEqual({ id: 'src/App.tsx:6:6', tag: 'p' });
  });
});

describe('dev-server mode references (component usage sites)', () => {
  beforeEach(async () => {
    o.destroy();
    document.body.innerHTML = `
      <button data-brushup-src="src/ui/button.tsx:5:4" data-brushup-use="src/app/page.tsx:12:6#Button">Go</button>
      <li data-brushup-src="src/List.tsx:3:2">a</li><li data-brushup-src="src/List.tsx:3:2">b</li>`;
    o = await loadOverlay({ mode: 'dev' });
  });
  const btn = () => document.querySelector('button')!;

  it('addresses the usage site, and says which component and file in the panel', () => {
    click(btn());
    expect(o.last('select').selection).toEqual({ id: 'src/app/page.tsx:12:6#Button', tag: 'button' });
    expect(info()).toContain('<Button> · page.tsx');
  });

  it('the file in the panel opens in an editor once the server has said where the project is', () => {
    click(btn());
    const link = () => o.root.querySelector('a.src') as HTMLAnchorElement;
    expect(link().textContent).toBe('page.tsx:12');
    expect(link().getAttribute('href')).toBeNull(); // the project root isn't known yet
    o.receive({ type: 'info', root: '/home/me/app' });
    expect(link().getAttribute('href')).toBe('vscode://file/home/me/app/src/app/page.tsx:12:6');
    localStorage.setItem('brushup:editor', 'cursor');
    o.receive({ type: 'info', root: '/home/me/app' });
    expect(link().getAttribute('href')).toBe('cursor://file/home/me/app/src/app/page.tsx:12:6');
    localStorage.removeItem('brushup:editor');
  });

  it('encodes characters in the project path that would end a URL path early', () => {
    click(btn());
    o.receive({ type: 'info', root: '/home/me/C# apps/50%/app' });
    expect((o.root.querySelector('a.src') as HTMLAnchorElement).getAttribute('href')).toBe('vscode://file/home/me/C%23%20apps/50%25/app/src/app/page.tsx:12:6');
  });

  it('the copy button puts file:line on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    click(btn());
    (o.root.querySelector('.info .copy') as HTMLButtonElement).click();
    await settle();
    expect(writeText).toHaveBeenCalledWith('src/app/page.tsx:12');
    expect(status()).toBe('Copied src/app/page.tsx:12');
  });

  it('sends the version token of the tag it edits: the usage site\'s, with the host element\'s as a text fallback', async () => {
    btn().setAttribute('data-brushup-uv', 'u1.f1.0.1');
    btn().setAttribute('data-brushup-sv', 's1.f2.0.1');
    click(btn());
    key('ArrowRight');
    await settle();
    expect(o.last('edit').edit).toMatchObject({ ver: 'u1.f1.0.1' });
    await ok('h1');
    pointer('dblclick', btn());
    btn().textContent = 'Start';
    key('Enter', {}, btn());
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'text', ver: 'u1.f1.0.1', fallbackVer: 's1.f2.0.1' });
  });

  it('after a stale answer, waits for the hot update and retries once on the same selection', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    click(btn());
    key('ArrowRight');
    await settle();
    expect(o.all('edit')).toHaveLength(1);
    o.reply({ ok: false, stale: true, error: 'changed' });
    await settle();
    expect(o.all('edit')).toHaveLength(1); // waiting for the hot update
    o.receive({ type: 'hmr' });
    await wait(250);
    expect(o.all('edit')).toHaveLength(2);
    o.reply({ ok: false, stale: true, error: 'changed again' });
    await settle();
    o.receive({ type: 'hmr' });
    await wait(250);
    expect(o.all('edit')).toHaveLength(2); // one retry only
  });

  it('does not retry an ordinary refusal', async () => {
    click(btn());
    key('ArrowRight');
    await settle();
    o.reply({ ok: false, error: 'Nope' });
    await settle();
    o.receive({ type: 'hmr' });
    await new Promise((r) => setTimeout(r, 250));
    expect(o.all('edit')).toHaveLength(1);
  });

  it('edits go to the usage site', async () => {
    click(btn());
    key('ArrowRight');
    await settle();
    expect(o.last('edit').edit.id).toBe('src/app/page.tsx:12:6#Button');
  });

  it('text edits carry the host element as a fallback', async () => {
    pointer('dblclick', btn());
    btn().textContent = 'Start';
    key('Enter', {}, btn());
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'text', id: 'src/app/page.tsx:12:6#Button', fallback: 'src/ui/button.tsx:5:4' });
  });

  it('a text edit says which list item it was and what the text was, so data-driven text can be found', async () => {
    const [, b] = [...document.querySelectorAll('li')];
    pointer('dblclick', b);
    b.textContent = 'beta';
    key('Enter', {}, b);
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'text', id: 'src/List.tsx:3:2', text: 'beta', instance: 1, was: 'b' });
  });

  it('list items from one JSX line are one edit, and the status says how many share it', async () => {
    const [a, b] = [...document.querySelectorAll('li')];
    click(a);
    click(b, { shiftKey: true });
    key('ArrowDown');
    await settle();
    expect(o.all('edits')).toHaveLength(0);
    expect(o.last('edit').edit.id).toBe('src/List.tsx:3:2');
    await ok('h1', { target: 'class' });
    expect(status()).toBe('Saved · Tailwind class · 2 elements share this JSX');
  });

  it('a note on a component records its usage site', async () => {
    click(btn());
    key('n');
    const composer = o.root.querySelector('form.composer') as HTMLFormElement;
    (composer.elements.namedItem('text') as HTMLTextAreaElement).value = 'Wider';
    composer.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(o.last('note-save').note).toMatchObject({ kind: 'component', anchor: { use: 'src/app/page.tsx:12:6#Button', src: 'src/ui/button.tsx:5:4' } });
  });

  it('does not stamp a synthetic id for notes in dev mode (the source tags are the anchor)', async () => {
    click(btn());
    key('n');
    const composer = o.root.querySelector('form.composer') as HTMLFormElement;
    (composer.elements.namedItem('text') as HTMLTextAreaElement).value = 'x';
    composer.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(o.last('note-save').note.anchor.sid).toBeUndefined();
  });
});

describe('brushup_inspect overflow reporting', () => {
  const ask = (id: string) => (o.receive({ type: 'ask', id, ask: { kind: 'inspect' } }), o.all('answer').find((m) => m.id === id)!.data.overflow);
  const withScroll = (e: HTMLElement, scrollH: number, clientH: number) => {
    Object.defineProperty(e, 'scrollHeight', { value: scrollH, configurable: true });
    Object.defineProperty(e, 'clientHeight', { value: clientH, configurable: true });
  };

  it('does not call a few pixels of font-metric slack on a visible element "overflow"', () => {
    withScroll(el('a1'), 99, 96); // a heading whose glyphs are 3px taller than its line-height
    click(el('a1'));
    expect(ask('o1')).toMatchObject({ setting: 'visible / visible', clipped: { x: false, y: false }, contentPastBoxPx: { y: 3 } });
  });

  it('reports content as clipped only when overflow hides it', () => {
    el('a1').style.overflow = 'hidden';
    withScroll(el('a1'), 140, 100);
    click(el('a1'));
    expect(ask('o2')).toMatchObject({ clipped: { y: true, x: false }, contentPastBoxPx: { y: 40 } });
  });

  it('a scrollable box counts as clipped too', () => {
    el('a1').style.overflowY = 'auto';
    withScroll(el('a1'), 400, 100);
    click(el('a1'));
    expect(ask('o3').clipped.y).toBe(true);
  });
});

describe('the Changes tab', () => {
  const q = (sel: string) => o.root.querySelector(sel) as HTMLElement;
  const changes = {
    repo: true, branch: 'main', truncated: false,
    files: [
      { file: 'src/page.tsx', status: 'M', additions: 1, deletions: 1, byBrushup: true, diff: 'diff --git a/src/page.tsx b/src/page.tsx\n--- a/src/page.tsx\n+++ b/src/page.tsx\n@@ -1 +1 @@\n-<p>Hello</p>\n+<p><img src=x onerror=alert(1)></p>\n' },
      { file: 'notes.md', status: '?', additions: 0, deletions: 0, byBrushup: false, diff: '' },
    ],
  };

  it('asks the server for the diff when opened, and shows files, counts and diff lines as text', async () => {
    q('[data-tab=changes]').click();
    await settle();
    expect(o.last('changes')).toBeTruthy();
    o.reply({ ok: true, changes });
    await settle();
    expect(q('.chsum').textContent).toBe('2 changed');
    expect(o.root.querySelectorAll('.chfile')).toHaveLength(2);
    expect(q('.chfile .chby').textContent).toBe('Brushup');
    expect(o.root.querySelectorAll('.chfile pre .cha')).toHaveLength(1);
    expect(o.root.querySelector('.chfile img')).toBeNull(); // diff text is never parsed as HTML
    expect(q('.chfile pre .cha').textContent).toContain('onerror=alert(1)');
    expect((q('[data-act=changes-copy]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists the files closed, even when Brushup edited only one', async () => {
    q('[data-tab=changes]').click();
    await settle();
    o.reply({ ok: true, changes: { ...changes, files: [changes.files[0]] } });
    await settle();
    expect(o.root.querySelectorAll('.chfile')).toHaveLength(1);
    expect((o.root.querySelector('.chfile') as HTMLDetailsElement).open).toBe(false);
  });

  it('says so for a project that is not in git, and for a clean tree', async () => {
    q('[data-tab=changes]').click();
    await settle();
    o.reply({ ok: true, changes: { repo: false, reason: 'This project is not in a git repository.' } });
    await settle();
    expect(q('.chsum').textContent).toBe('No git repository');
    expect(q('.chnote').textContent).toContain('not in a git repository');
    (q('[data-act=changes-refresh]') as HTMLButtonElement).click();
    await settle();
    o.reply({ ok: true, changes: { repo: true, branch: 'main', truncated: false, files: [] } });
    await settle();
    expect(q('.chsum').textContent).toBe('No changes');
  });

  it('shows what the agent replied on a done note', async () => {
    o.receive({ type: 'notes', notes: [{ id: 'n1', kind: 'section', label: 'Hero', text: 'More space', status: 'done', reply: 'Added py-16 in page.tsx', createdAt: '', updatedAt: '', anchor: { tag: 'h1', classes: [], text: 'Hello', index: 0, page: '/' } }] });
    o.tick();
    expect(q('.note .reply').textContent).toBe('Claude: Added py-16 in page.tsx');
    const parts = [...o.root.querySelectorAll('.note > *')].map((e) => e.className || e.tagName.toLowerCase());
    expect(parts.indexOf('p')).toBeLessThan(parts.indexOf('reply')); // the note's own text first, then the reply
  });
});

describe('the Layers tab', () => {
  const q = (sel: string) => o.root.querySelector(sel) as HTMLElement;
  const rows = () => [...o.root.querySelectorAll('.layers button.row')] as HTMLButtonElement[];
  const name = (r: HTMLElement) => r.querySelector('.lnm')!.textContent;

  it('starts folded, so only the top level shows; nested elements are indented under their parent once opened', () => {
    q('[data-tab=layers]').click();
    expect(rows().map((r) => [name(r), r.getAttribute('aria-level')])).toEqual([['h1', '1'], ['p', '1'], ['div', '1']]);
    expect(rows()[0].querySelector('.lhint')!.textContent).toBe('“Hello”');
    expect(rows()[1].querySelector('.lhint')!.textContent).toBe('“World”');
    expect(rows()[2].getAttribute('aria-expanded')).toBe('false'); // only elements with children can fold
    expect(rows()[0].hasAttribute('aria-expanded')).toBe(false);
    expect(q('.laysum').textContent).toBe('4 elements');
    (rows()[2].querySelector('.lcaret') as HTMLElement).click();
    expect(rows().map((r) => [name(r), r.getAttribute('aria-level')])).toEqual([['h1', '1'], ['p', '1'], ['div', '1'], ['span', '2']]);
  });

  it('clicking a row selects that element, Shift adds, and the row follows the selection made on the page', () => {
    q('[data-tab=layers]').click();
    (q('[data-act=layers-expand]') as HTMLButtonElement).click();
    rows()[1].click();
    expect(o.last('select').selection).toEqual({ id: 'a2', tag: 'p' });
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
    rows()[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(info()).toContain('2 elements selected');
    click(el('a1'));
    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('opening a row shows what is under it, and closing it hides it again', () => {
    q('[data-tab=layers]').click();
    expect(rows().map(name)).toEqual(['h1', 'p', 'div']);
    (rows()[2].querySelector('.lcaret') as HTMLElement).click();
    expect(rows().map(name)).toEqual(['h1', 'p', 'div', 'span']);
    expect(rows()[2].getAttribute('aria-expanded')).toBe('true');
    (rows()[2].querySelector('.lcaret') as HTMLElement).click();
    expect(rows().map(name)).toEqual(['h1', 'p', 'div']);
  });

  it('the arrow keys move between rows, Right opens a closed row and Left closes an open one', () => {
    q('[data-tab=layers]').click();
    const first = rows()[0];
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(o.root.activeElement).toBe(rows()[1]);
    rows()[2].focus();
    rows()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(rows().map(name)).toEqual(['h1', 'p', 'div', 'span']);
    expect(o.root.activeElement).toBe(rows()[2]);
    rows()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(rows().map(name)).toEqual(['h1', 'p', 'div']);
  });

  it('leaves out the page head and the overlay itself', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('data-brushup-id', 'm1');
    document.head.append(meta);
    q('[data-tab=layers]').click();
    (q('[data-act=layers-expand]') as HTMLButtonElement).click();
    expect(rows().map(name)).toEqual(['h1', 'p', 'div', 'span']);
    meta.remove();
  });

  it('writes the page\'s text into the tree as text, never as markup', () => {
    el('a2').textContent = '<img src=x onerror=alert(1)>';
    q('[data-tab=layers]').click();
    expect(o.root.querySelector('.layers img')).toBeNull();
    expect(rows()[1].querySelector('.lhint')!.textContent).toContain('<img src=x');
  });
});

describe('the Layers tab on a big page', () => {
  const q = (sel: string) => o.root.querySelector(sel) as HTMLElement;
  const rows = () => [...o.root.querySelectorAll('.layers button.row')] as HTMLButtonElement[];
  const names = () => rows().map((r) => r.querySelector('.lnm')!.textContent);
  const filter = () => q('.layfilter') as HTMLInputElement;
  const type = (v: string) => ((filter().value = v), filter().dispatchEvent(new Event('input', { bubbles: true })));

  /** 30 groups of three nested divs with a span at the bottom: 120 elements, over the size where folding starts. */
  const big = () => {
    document.body.innerHTML = Array.from({ length: 30 }, (_, i) => `<div data-brushup-id="g${i}" class="group-${i}"><div data-brushup-id="m${i}"><div data-brushup-id="d${i}"><span data-brushup-id="s${i}">leaf ${i}${i === 17 ? ' needle' : ''}</span></div></div></div>`).join('');
  };

  it('always starts fully folded, so even a long page is a short list of its top level', () => {
    big();
    q('[data-tab=layers]').click();
    expect(rows()).toHaveLength(30); // the 30 groups; everything inside them is folded away
    expect(q('.laysum').textContent).toBe('120 elements');
    expect(rows().every((r) => r.getAttribute('aria-expanded') === 'false')).toBe(true);
  });

  it('Expand and Collapse open and close every branch at once', () => {
    big();
    q('[data-tab=layers]').click();
    (q('[data-act=layers-expand]') as HTMLButtonElement).click();
    expect(rows()).toHaveLength(120);
    (q('[data-act=layers-collapse]') as HTMLButtonElement).click();
    expect(rows()).toHaveLength(30);
  });

  it('filters by text, tag, class or component, showing each match in its place under the rows above it', () => {
    big();
    q('[data-tab=layers]').click();
    type('needle');
    expect(names()).toEqual(['div', 'div', 'div', 'span']); // the leaf and the three rows it sits in
    expect(q('.laysum').textContent).toBe('1 match');
    expect(q('.layers .lm')!.parentElement!.querySelector('.lhint')!.textContent).toContain('leaf 17');
    type('group-3');
    expect(rows().map((r) => r.querySelector('.lhint')!.textContent)).toEqual(['.group-3']); // only that group matches, and nothing sits above it
    type('SPAN');
    expect(rows()).toHaveLength(30 * 4); // every span with the three rows above it, matched case-insensitively
    type('');
    expect(rows()).toHaveLength(30); // clearing the filter goes back to the folded list
  });

  it('says when nothing matches, and Escape in the box clears the filter without clearing the selection', () => {
    big();
    q('[data-tab=layers]').click();
    click(el('s4'));
    type('zzz');
    expect(q('.layers .empty')!.textContent).toBe('Nothing on the page matches.');
    expect(rows()).toHaveLength(0);
    filter().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(filter().value).toBe('');
    expect(o.last('select').selection).toEqual({ id: 's4', tag: 'span' }); // the shortcut for deselecting never saw it
  });

  it('selecting something on the page unfolds the tree down to its row', () => {
    big();
    q('[data-tab=layers]').click();
    expect(names()).not.toContain('span');
    click(el('s22'));
    const row = rows().find((r) => r.getAttribute('aria-selected') === 'true')!;
    expect(row.querySelector('.lnm')!.textContent).toBe('span');
    expect(row.getAttribute('aria-level')).toBe('4');
    expect(rows()).toHaveLength(33); // just that one branch opened, down to the selection
  });

  it('says how many elements it left out when a page is huge', () => {
    document.body.innerHTML = Array.from({ length: 2005 }, (_, i) => `<i data-brushup-id="x${i}"></i>`).join('');
    q('[data-tab=layers]').click();
    expect(q('.laysum').textContent).toBe('2000 elements (showing the first 2000 of 2005)');
  });

  it('typing in the filter box never triggers a canvas shortcut', () => {
    big();
    q('[data-tab=layers]').click();
    click(el('s1'));
    filter().dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true }));
    filter().dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, composed: true }));
    expect(o.all('edit')).toHaveLength(0);
  });
});

describe('the Image section', () => {
  const q = (sel: string) => o.root.querySelector(sel) as HTMLElement;
  const field = (n: 'src' | 'alt') => q(`[data-img=${n}]`) as HTMLInputElement;
  const deco = () => q('[data-img=decorative]') as HTMLInputElement;
  const change = (input: HTMLInputElement, value: string) => ((input.value = value), input.dispatchEvent(new Event('change', { bubbles: true })));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  beforeEach(() => {
    document.body.insertAdjacentHTML('beforeend', '<img data-brushup-id="im" src="/old.png"><img data-brushup-id="im2" src="/b.png" alt="A cat"><img data-brushup-id="im3" src="/c.png" alt="">');
  });

  it('shows for an image only, filled in with what it has now, and says when there is no alt text', () => {
    expect(q('.imgsec').hidden).toBe(true);
    click(el('a1'));
    expect(q('.imgsec').hidden).toBe(true); // a heading is not an image
    click(el('im'));
    expect(q('.imgsec').hidden).toBe(false);
    expect(field('src').value).toBe('/old.png');
    expect(field('alt').value).toBe('');
    expect(q('.imgwarn').hidden).toBe(false);
    click(el('im2'));
    expect(field('alt').value).toBe('A cat');
    expect(q('.imgwarn').hidden).toBe(true);
    click(el('im3'));
    expect(deco().checked).toBe(true); // alt="" is the decorative case
    expect(field('alt').disabled).toBe(true);
  });

  it('changing the source writes it, shows it straight away and confirms with Undo', async () => {
    click(el('im'));
    change(field('src'), '/new.png');
    await settle();
    expect(o.last('edit').edit).toEqual({ kind: 'attr', id: 'im', tag: 'img', name: 'src', value: '/new.png' });
    expect(el('im').getAttribute('src')).toBe('/new.png');
    o.reply({ ok: true, hash: 'h1', target: 'attribute' });
    await settle();
    expect(status()).toBe('Saved · image source');
  });

  it('puts the old source back and says why when the server refuses', async () => {
    click(el('im'));
    change(field('src'), 'javascript:alert(1)');
    await settle();
    o.reply({ ok: false, error: 'That kind of address can\'t be an image source' });
    await settle();
    expect(el('im').getAttribute('src')).toBe('/old.png');
    expect(status()).toContain("can't be an image source");
    expect(field('src').value).toBe('/old.png');
  });

  it('writes alt text, ignores an empty box when there was none, and writes a decorative image only when asked', async () => {
    click(el('im'));
    change(field('alt'), '');
    await settle();
    expect(o.all('edit')).toHaveLength(0); // an empty box is not a choice to mark it decorative
    change(field('alt'), 'A red bicycle');
    await settle();
    expect(o.last('edit').edit).toMatchObject({ name: 'alt', value: 'A red bicycle' });
    o.reply({ ok: true, hash: 'h1', target: 'attribute' });
    await settle();
    expect(status()).toBe('Saved · alt text');
    click(el('im2'));
    deco().checked = true;
    deco().dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(o.last('edit').edit).toMatchObject({ name: 'alt', value: '' });
    o.reply({ ok: true, hash: 'h2', target: 'attribute' });
    await settle();
    expect(status()).toBe('Saved · marked decorative');
  });

  it('uploads a chosen file, then points the image at it and asks for alt text', async () => {
    click(el('im'));
    const file = new File([png], 'Team Photo.png', { type: 'image/png' });
    (file as any).arrayBuffer = async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    const input = q('.imgfile') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const up = o.last('upload');
    expect(up.name).toBe('Team Photo.png');
    expect(atob(up.data)).toBe(String.fromCharCode(...png));
    o.reply({ ok: true, src: '/team-photo.png', saved: 'public/team-photo.png' });
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'attr', name: 'src', value: '/team-photo.png' });
    o.reply({ ok: true, hash: 'h1', target: 'attribute' });
    await settle();
    expect(status()).toBe('Saved public/team-photo.png and set it as the source. Now describe it in Alt text.');
    expect(o.root.activeElement).toBe(field('alt'));
  });

  it('turns away a file that is too big without sending it, and shows the server\'s reason for one it refuses', async () => {
    click(el('im'));
    const big = new File([png], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    const input = q('.imgfile') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(status()).toMatch(/3\.0 MB; the limit here is 2\.5 MB/);
    expect(o.all('upload')).toHaveLength(0);
    const odd = new File([png], 'odd.png', { type: 'image/png' });
    (odd as any).arrayBuffer = async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    Object.defineProperty(input, 'files', { value: [odd], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    o.reply({ ok: false, error: "That doesn't look like a png, jpeg, gif, webp or avif image." });
    await settle();
    expect(status()).toContain("doesn't look like");
    expect(o.all('edit')).toHaveLength(0);
  });

  it('offers Write alt text on a missing-alt check, and it jumps to the field', async () => {
    document.documentElement.lang = 'en';
    document.title = 'Test';
    layout(el('im'), { x: 0, y: 0, width: 50, height: 50 });
    q('[data-tab=a11y]').click();
    const btn = [...o.root.querySelectorAll('.a11yitem .acts button')].find((b) => b.textContent === 'Write alt text') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await new Promise((r) => setTimeout(r, 120));
    expect(o.last('select').selection).toEqual({ id: 'im', tag: 'img' });
    expect(q('[data-tab=style]').getAttribute('aria-selected')).toBe('true');
    expect(o.root.activeElement).toBe(field('alt'));
  });
});

describe('move and wrap', () => {
  const q = (sel: string) => o.root.querySelector(sel) as HTMLButtonElement;
  const press = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  it('Alt+Up and Alt+Down ask the server to swap with the neighbour, without nudging the element', async () => {
    click(el('a2'));
    press({ key: 'ArrowUp', altKey: true });
    await settle();
    expect(o.last('edit').edit).toEqual({ kind: 'moveUp', id: 'a2', tag: 'p' });
    o.reply({ ok: true, hash: 'h1', target: 'structure' });
    await settle();
    expect(status()).toBe('Moved <p> up');
    press({ key: 'ArrowDown', altKey: true });
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'moveDown', id: 'a2' });
    expect(o.all('edit').every((m) => m.edit.kind !== 'style')).toBe(true); // an Alt+arrow is not a nudge
  });

  it('Ctrl+Alt+G wraps the selection in a div', async () => {
    click(el('a1'));
    press({ key: 'g', ctrlKey: true, altKey: true });
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'wrap', id: 'a1', tag: 'h1' });
    o.reply({ ok: true, hash: 'h1', target: 'structure' });
    await settle();
    expect(status()).toBe('Wrapped <h1> in a <div>');
  });

  it('the Layers tab has Up, Down and Wrap buttons that are off until something is selected', async () => {
    q('[data-tab=layers]').click();
    const names = ['move-up', 'move-down', 'wrap'];
    expect(names.map((n) => q(`[data-act=${n}]`).disabled)).toEqual([true, true, true]);
    click(el('a2'));
    expect(names.map((n) => q(`[data-act=${n}]`).disabled)).toEqual([false, false, false]);
    q('[data-act=move-down]').click();
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'moveDown', id: 'a2' });
    o.reply({ ok: true, hash: 'h1', target: 'structure' }); // edits go one at a time, each after the last was answered
    await settle();
    q('[data-act=wrap]').click();
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'wrap', id: 'a2' });
  });

  it('moves or wraps one element at a time, and says so', async () => {
    click(el('a1'));
    click(el('a2'), { shiftKey: true });
    press({ key: 'ArrowUp', altKey: true });
    await settle();
    expect(status()).toBe('Select one element to move or wrap it');
    expect(o.all('edit')).toHaveLength(0);
    expect(o.all('edits')).toHaveLength(0);
  });

  it('shows the reason when the server refuses to move past an expression', async () => {
    click(el('a2'));
    press({ key: 'ArrowDown', altKey: true });
    await settle();
    o.reply({ ok: false, error: '<p> has an expression ({…}) next to it, which could be a list or a condition, so Brushup won\'t move past it.' });
    await settle();
    expect(status()).toContain('has an expression');
    expect(info()).toContain('<p>');
  });
});

describe('delete and duplicate', () => {
  const q = (sel: string) => o.root.querySelector(sel) as HTMLButtonElement;

  it('Delete removes the selection from the source, clears the selection and offers Undo', async () => {
    click(el('a2'));
    key('Delete');
    await settle();
    expect(o.last('edit').edit).toEqual({ kind: 'delete', id: 'a2', tag: 'p' });
    o.reply({ ok: true, hash: 'h1', target: 'structure' });
    await settle();
    expect(status()).toBe('Deleted <p>');
    expect(o.last('select').selection).toBeNull();
    expect(o.root.querySelector('.undo')!.hasAttribute('hidden')).toBe(false);
  });

  it('Ctrl+D (and Cmd+D) writes a copy and keeps the original selected', async () => {
    click(el('a1'));
    const down = new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(down);
    await settle();
    expect(down.defaultPrevented).toBe(true); // not the browser's "bookmark this page"
    expect(o.last('edit').edit).toMatchObject({ kind: 'duplicate', id: 'a1', tag: 'h1' });
    o.reply({ ok: true, hash: 'h1', target: 'structure' });
    await settle();
    expect(status()).toBe('Duplicated <h1>');
    expect(info()).toContain('<h1>');
  });

  it('the buttons are off until something is selected, then do the same', async () => {
    expect(q('[data-act=delete]').disabled).toBe(true);
    expect(q('[data-act=duplicate]').disabled).toBe(true);
    click(el('a2'));
    expect(q('[data-act=delete]').disabled).toBe(false);
    q('[data-act=duplicate]').click();
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'duplicate', id: 'a2' });
  });

  it('shows the server\'s reason when it refuses, and keeps the selection', async () => {
    click(el('a1'));
    key('Delete');
    await settle();
    o.reply({ ok: false, error: '<h1> is drawn from a list (.map), so one line of code makes several elements' });
    await settle();
    expect(status()).toContain('drawn from a list');
    expect(info()).toContain('<h1>');
  });

  it('does nothing without a selection, and never fires while typing in a field or a note', async () => {
    key('Delete');
    await settle();
    expect(o.all('edit')).toHaveLength(0);
    click(el('a1'));
    const field = o.root.querySelector('input') as HTMLInputElement;
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, composed: true }));
    await settle();
    expect(o.all('edit')).toHaveLength(0);
  });

  it('removes several selected elements as one edit batch, one per distinct element', async () => {
    click(el('a1'));
    click(el('a2'), { shiftKey: true });
    key('Delete');
    await settle();
    expect(o.last('edits').edits.map((e: any) => [e.kind, e.id])).toEqual([['delete', 'a1'], ['delete', 'a2']]);
  });
});

describe('the A11y tab', () => {
  const q = (sel: string) => o.root.querySelector(sel) as HTMLElement;
  // A proper page, so the tests are about the element and not about a missing <title> or <main>.
  beforeEach(() => {
    document.documentElement.lang = 'en';
    document.title = 'Test';
    const main = document.createElement('main');
    main.append(...document.body.childNodes);
    document.body.append(main);
    layout(el('a1'), { x: 0, y: 0, width: 100, height: 20 });
  });
  const faint = () => {
    el('a2').setAttribute('style', 'color:#aaa;background:#fff;font-size:16px');
    layout(el('a2'), { x: 0, y: 0, width: 100, height: 20 });
  };
  const buttons = () => [...o.root.querySelectorAll('.a11yitem .acts button')].map((b) => b.textContent);

  it('scans when opened and lists what it found, as text, with a count on the tab', () => {
    faint();
    el('a2').title = '<img src=x onerror=alert(1)>';
    q('[data-tab=a11y]').click();
    expect(q('.a11ysum').textContent).toBe('1 issue');
    expect(q('.a11yitem .sub').textContent).toMatch(/Text is hard to read/);
    expect(q('.a11yitem b').textContent).toBe('<p> “World”'); // the element names the card
    expect(q('.a11ygrouphead .rule').textContent).toBe('Contrast');
    expect(q('.a11ygrouphead .gcount').textContent).toBe('1');
    expect(q('[data-tab=a11y]').textContent).toContain('Checks');
    expect(q('[data-a11y-count]').textContent).toBe('1');
    expect(o.root.querySelector('.a11yitem img')).toBeNull();
    const learn = q('.a11yitem .learn') as HTMLAnchorElement;
    expect(learn.href).toBe('https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html');
    expect(learn.rel).toBe('noopener noreferrer');
    expect(o.root.querySelectorAll('.a11ywhat li').length).toBeGreaterThanOrEqual(15);
    expect(buttons()).toEqual([expect.stringMatching(/^Change color to #/), 'Locate', 'Send to Claude', 'Ignore']);
  });

  it('shows each issue as one closed line, and opens the detail only when you ask', () => {
    faint();
    q('[data-tab=a11y]').click();
    const head = q('.a11yhead');
    const body = q('.a11ybody');
    expect(head.querySelector('.sub')!.textContent).toMatch(/Text is hard to read/);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true); // the explanation, the buttons and the source stay out of sight
    expect(head.getAttribute('aria-controls')).toBe(body.id);
    head.click();
    expect(body.hidden).toBe(false);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(q('.a11yitem').classList.contains('open')).toBe(true);
    head.click();
    expect(body.hidden).toBe(true);
  });

  describe('ordering and ignoring', () => {
    const groupNames = () => [...o.root.querySelectorAll('.a11ygrouphead .rule')].map((r) => r.textContent);
    const ignoreBtn = () => [...o.root.querySelectorAll('.a11yitem .acts button')].find((b) => b.textContent === 'Ignore') as HTMLButtonElement;

    it('lists the most serious kinds first: accessibility standards, then design guidelines, then conventions', () => {
      // One of each: a design guideline (spacing), a design convention (image), an accessibility standard (contrast).
      el('a3').setAttribute('style', 'padding-top:15px');
      layout(el('a3'), { x: 0, y: 0, width: 100, height: 40 });
      faint();
      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<img data-brushup-id="im" src="a.png" alt="x">');
      const img = el('im') as HTMLImageElement;
      Object.defineProperties(img, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
      layout(img, { x: 0, y: 0, width: 200, height: 100 });
      q('[data-tab=a11y]').click();
      expect(groupNames()).toEqual(['Contrast', 'Design · Spacing', 'Design · Image']);
    });

    it('Ignore sends the finding to the server, and it leaves the list once the server confirms', async () => {
      faint();
      q('[data-tab=a11y]').click();
      ignoreBtn().click();
      await settle();
      const sent = o.last('ignore-add');
      expect(sent.item).toMatchObject({ scope: 'one', rule: 'contrast', label: '<p> “World”', page: '/' });
      expect(sent.item.key).toBe('contrast|<p> “World”|/');
      o.reply({ ok: true });
      o.receive({ type: 'ignored', items: [{ ...sent.item, at: '' }] });
      expect(o.root.querySelectorAll('.a11yitem')).toHaveLength(0);
      expect(q('.a11ysum').textContent).toBe('No issues found');
      const ignored = q('.a11yignored');
      expect(ignored.hidden).toBe(false);
      expect(ignored.querySelector('.gcount')!.textContent).toBe('1');
      expect(ignored.querySelector('li span')!.textContent).toBe('Contrast: <p> “World”');
    });

    it('Restore asks the server to forget it, and the finding comes back', async () => {
      faint();
      q('[data-tab=a11y]').click();
      o.receive({ type: 'ignored', items: [{ key: 'contrast|<p> “World”|/', scope: 'one', rule: 'contrast', label: '<p> “World”', page: '/', at: '' }] });
      expect(o.root.querySelectorAll('.a11yitem')).toHaveLength(0);
      (q('.a11yignored li button') as HTMLButtonElement).click();
      await settle();
      expect(o.last('ignore-remove').key).toBe('contrast|<p> “World”|/');
      o.receive({ type: 'ignored', items: [] });
      expect(o.root.querySelectorAll('.a11yitem')).toHaveLength(1);
      expect(q('.a11yignored').hidden).toBe(true);
    });

    it('a design group can be ignored as a whole, and says what it is hiding; an accessibility group cannot', async () => {
      el('a3').setAttribute('style', 'padding-top:15px');
      layout(el('a3'), { x: 0, y: 0, width: 100, height: 40 });
      faint();
      q('[data-tab=a11y]').click();
      const groupButtons = [...o.root.querySelectorAll('.a11ygroupacts button')];
      expect(groupButtons.map((b) => b.textContent)).toEqual(['Ignore all “Spacing” suggestions']); // none for Contrast
      (groupButtons[0] as HTMLButtonElement).click();
      await settle();
      const sent = o.last('ignore-add').item;
      expect(sent).toMatchObject({ key: 'kind|spacing-grid', scope: 'kind', rule: 'spacing-grid', label: 'Spacing', page: '' });
      o.receive({ type: 'ignored', items: [{ ...sent, at: '' }] });
      expect(groupNames()).toEqual(['Contrast']);
      expect(q('.a11yignored li span').textContent).toBe('All “Spacing” suggestions');
    });

    it('the agent\'s check leaves out what you ignored, and says how many it left out', () => {
      faint();
      el('a3').setAttribute('style', 'padding-top:15px');
      layout(el('a3'), { x: 0, y: 0, width: 100, height: 40 });
      o.receive({ type: 'ignored', items: [{ key: 'kind|spacing-grid', scope: 'kind', rule: 'spacing-grid', label: 'Spacing', page: '', at: '' }] });
      o.receive({ type: 'ask', id: 'qi', ask: { kind: 'check' } });
      const d = o.all('answer').find((m) => m.id === 'qi')!.data;
      expect(d.issues.map((i: any) => i.rule)).toEqual(['contrast']);
      expect(d.ignoredByUser).toBe(1);
    });
  });

  describe('grouping', () => {
    /** n paragraphs with faint text, each its own contrast problem. */
    const faintParagraphs = (n: number) => {
      document.querySelector('main')!.insertAdjacentHTML('beforeend', Array.from({ length: n }, (_, i) => `<p data-brushup-id="f${i}" style="color:#aaa;background:#fff;font-size:16px">faint ${i}</p>`).join(''));
      for (let i = 0; i < n; i++) layout(el(`f${i}`), { x: 0, y: 0, width: 100, height: 20 });
    };
    const groups = () => [...o.root.querySelectorAll('.a11ygroup')] as HTMLElement[];
    const heads = () => [...o.root.querySelectorAll('.a11ygrouphead')] as HTMLButtonElement[];

    it('puts issues of one kind under one heading with a count, so a long run does not repeat the same words', () => {
      faintParagraphs(3);
      q('[data-tab=a11y]').click();
      expect(groups()).toHaveLength(1);
      expect(heads()[0].querySelector('.rule')!.textContent).toBe('Contrast');
      expect(heads()[0].querySelector('.gcount')!.textContent).toBe('3');
      const cards = [...o.root.querySelectorAll('.a11yhead b')].map((b) => b.textContent);
      expect(cards).toEqual(['<p> “faint 0”', '<p> “faint 1”', '<p> “faint 2”']); // each card is its own element
    });

    it('opens a small group and folds a group of more than three, and remembers what you chose', () => {
      faintParagraphs(5);
      q('[data-tab=a11y]').click();
      expect(heads()[0].getAttribute('aria-expanded')).toBe('false');
      expect((o.root.querySelector('.a11ygroupbody') as HTMLElement).hidden).toBe(true);
      heads()[0].click();
      expect((o.root.querySelector('.a11ygroupbody') as HTMLElement).hidden).toBe(false);
      (q('[data-act=a11y-scan]') as HTMLButtonElement).click();
      expect(heads()[0].getAttribute('aria-expanded')).toBe('true'); // your choice survives the next check
    });

    it('names an image by its file and an unlabelled element by what identifies it', () => {
      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<img data-brushup-id="i1" src="/img/team/photo.png"><button data-brushup-id="b1" class="icon-btn" id="close"></button>');
      layout(el('i1'), { x: 0, y: 0, width: 50, height: 50 });
      layout(el('b1'), { x: 0, y: 0, width: 40, height: 40 });
      q('[data-tab=a11y]').click();
      const labels = [...o.root.querySelectorAll('.a11yhead b')].map((b) => b.textContent);
      expect(labels).toContain('<img> photo.png');
      expect(labels).toContain('<button> #close');
    });
  });

  it('keeps a card as you left it when the page is checked again, and only that card', () => {
    faint();
    el('a3').setAttribute('style', 'padding-top:15px');
    layout(el('a3'), { x: 0, y: 0, width: 100, height: 40 });
    q('[data-tab=a11y]').click();
    const heads = () => [...o.root.querySelectorAll('.a11yhead')] as HTMLElement[];
    expect(heads()).toHaveLength(2);
    heads()[1].click();
    (q('[data-act=a11y-scan]') as HTMLButtonElement).click();
    expect(heads().map((h) => h.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
  });

  it('says so when the page is clean, and never claims it is a pass', () => {
    q('[data-tab=a11y]').click();
    expect(q('.a11ysum').textContent).toBe('No issues found');
    expect(q('.a11ynote').hidden).toBe(false);
    expect(q('.a11ynote').textContent).toMatch(/doesn't mean the page is accessible/);
    expect(q('.a11ynote').textContent).toMatch(/Design checks are guidelines/);
  });

  it('Apply writes the fix as a normal style edit on the element', async () => {
    faint();
    q('[data-tab=a11y]').click();
    (q('.a11yitem .apply') as HTMLButtonElement).click();
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'style', id: 'a2', props: { color: expect.stringMatching(/^#[0-9a-f]{6}$/) } });
  });

  it('Locate selects the element, and Send to Claude pins a note once', async () => {
    faint();
    q('[data-tab=a11y]').click();
    el('a2').scrollIntoView = () => {};
    (o.root.querySelectorAll('.a11yitem .acts button')[1] as HTMLButtonElement).click();
    expect(o.last('select').selection).toEqual({ id: 'a2', tag: 'p' });
    (o.root.querySelectorAll('.a11yitem .acts button')[2] as HTMLButtonElement).click();
    await settle();
    const saved = o.last('note-save').note;
    expect(saved.label).toBe('Accessibility');
    expect(saved.text).toMatch(/^Accessibility: Text is hard to read/);
    o.reply({ ok: true });
    await settle();
    o.receive({ type: 'notes', notes: [{ ...saved, id: 'n1', status: 'open', createdAt: '', updatedAt: '' }] });
    o.tick();
    (o.root.querySelectorAll('.a11yitem .acts button')[2] as HTMLButtonElement).click();
    await settle();
    expect(o.all('note-save')).toHaveLength(1);
  });

  it('also runs the design checks, with a filter, and Apply and Send to Claude work on them too', async () => {
    faint();
    el('a3').setAttribute('style', 'padding-top:15px;margin-bottom:16px');
    layout(el('a3'), { x: 0, y: 0, width: 100, height: 40 });
    q('[data-tab=a11y]').click();
    const filters = [...o.root.querySelectorAll('.a11yfilter button')].map((b) => b.textContent);
    expect(filters).toEqual(['All 2', 'Accessibility 1', 'Design 1']);
    expect(q('.a11ysum').textContent).toBe('2 issues');
    (o.root.querySelector('[data-filter=design]') as HTMLButtonElement).click();
    expect(q('.a11ysum').textContent).toBe('1 design issue');
    expect(o.root.querySelectorAll('.a11yitem')).toHaveLength(1);
    expect(q('.a11ygrouphead .rule').textContent).toBe('Design · Spacing');
    expect(q('.a11yitem b').textContent).toBe('<div> “x”');
    expect(q('.a11yitem .sub').textContent).toBe('Off the 4px grid: padding-top 15px');
    expect((q('.a11yitem .learn') as HTMLAnchorElement).href).toBe('https://m2.material.io/design/layout/spacing-methods.html');
    expect(q('.a11yitem .basis').textContent).toMatch(/^Guideline\. Figma recommends an 8-point grid/);
    (q('.a11yitem .apply') as HTMLButtonElement).click();
    await settle();
    expect(o.last('edit').edit).toMatchObject({ kind: 'style', id: 'a3', props: { 'padding-top': '16px' } });
    (o.root.querySelectorAll('.a11yitem .acts button')[2] as HTMLButtonElement).click();
    await settle();
    expect(o.last('note-save').note).toMatchObject({ label: 'Design', text: expect.stringMatching(/^Design: Off the 4px grid: padding-top 15px/) });
    (o.root.querySelector('[data-filter=accessibility]') as HTMLButtonElement).click();
    expect(q('.a11ysum').textContent).toBe('1 accessibility issue');
    (o.root.querySelector('[data-filter=all]') as HTMLButtonElement).click();
    expect(q('.a11ysum').textContent).toBe('2 issues');
  });

  it('lists both groups under What\'s checked', () => {
    expect([...o.root.querySelectorAll('.a11ywhat h4')].map((h) => h.textContent)).toEqual(['Accessibility', 'Design']);
    expect(o.root.querySelectorAll('.a11ywhat li').length).toBe(15 + 11);
    expect(o.root.querySelectorAll('.a11ywhat .why').length).toBe(26); // each says where its number comes from
  });

  it('does not scan the overlay itself', () => {
    q('[data-tab=a11y]').click();
    expect(q('.a11ysum').textContent).toBe('No issues found'); // the panel has icon-only buttons with labels, and none are reported
  });
});

describe('panel position', () => {
  const panelEl = () => o.root.querySelector('.panel') as HTMLElement;
  const header = () => o.root.querySelector('header') as HTMLElement;

  it('the ? button walks through a short tour, and remembers it was seen', () => {
    const q = (sel: string) => o.root.querySelector(sel) as HTMLElement;
    const tour = q('.tour');
    expect(tour.hidden).toBe(true);
    expect(q('[data-act=tour] .dot').hidden).toBe(false);
    q('[data-act=tour]').click();
    expect(tour.hidden).toBe(false);
    expect(q('.tour .n').textContent).toBe('1 / 8');
    (q('.tour .next') as HTMLButtonElement).click();
    expect(q('.tour .n').textContent).toBe('2 / 8');
    (q('.tour .back') as HTMLButtonElement).click();
    expect(q('.tour .n').textContent).toBe('1 / 8');
    for (let i = 0; i < 7; i++) (q('.tour .next') as HTMLButtonElement).click();
    expect(q('.tour .next').textContent).toBe('Done');
    (q('.tour .next') as HTMLButtonElement).click();
    expect(tour.hidden).toBe(true);
    expect(q('[data-act=tour] .dot').hidden).toBe(true);
    q('[data-act=tour]').click();
    tour.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tour.hidden).toBe(true);
  });

  it('the header drags the panel, and the dock button snaps it back', () => {
    pointer('pointerdown', header(), { clientX: 400, clientY: 20 });
    pointer('pointermove', header(), { clientX: 300, clientY: 90 });
    pointer('pointerup', header(), { clientX: 300, clientY: 90 });
    expect(panelEl().style.right).toBe('auto');
    expect(parseFloat(panelEl().style.left)).toBeGreaterThanOrEqual(8);
    (o.root.querySelector('[data-act=dock]') as HTMLButtonElement).click();
    expect(panelEl().style.left).toBe('');
    expect(panelEl().style.right).toBe('');
  });

  it('dragging a button in the header does not move the panel', () => {
    const btn = o.root.querySelector('[data-mode=preview]') as HTMLElement;
    pointer('pointerdown', btn, { clientX: 5, clientY: 5 });
    pointer('pointermove', btn, { clientX: 200, clientY: 200 });
    expect(panelEl().style.right).not.toBe('auto');
  });
});

describe('box-model spacing widget', () => {
  const mini = (prop: string) => o.root.querySelector(`.boxm input[data-prop="${prop}"]`) as HTMLInputElement;

  it('puts all eight margin and padding values on their sides of one box, each labelled', () => {
    const props = ['top', 'right', 'bottom', 'left'].flatMap((s) => [`margin-${s}`, `padding-${s}`]);
    for (const prop of props) expect(mini(prop), prop).toBeTruthy();
    expect(mini('margin-top').getAttribute('aria-label')).toBe('Margin top, pixels');
    expect(mini('padding-left').getAttribute('aria-label')).toBe('Padding left, pixels');
    expect(o.root.querySelectorAll('.fields .grid')).toHaveLength(2); // typography and layout keep their rows
  });

  it('dragging a cell sideways scrubs it with a live preview and saves on release', async () => {
    click(el('a1'));
    const input = mini('padding-top');
    const start = parseFloat(input.value);
    pointer('pointerdown', input, { clientX: 50, clientY: 5 });
    pointer('pointermove', input, { clientX: 66, clientY: 5 });
    expect(parseFloat(input.value)).toBe(start + 8);
    expect(el('a1').style.paddingTop).toBe(`${start + 8}px`);
    pointer('pointerup', input, { clientX: 66, clientY: 5 });
    await settle();
    expect(o.last('edit').edit).toMatchObject({ props: { 'padding-top': `${start + 8}px` } });
  });

  it('a plain click on a cell edits the number instead of scrubbing', async () => {
    click(el('a1'));
    const input = mini('margin-left');
    pointer('pointerdown', input, { clientX: 5, clientY: 5 });
    pointer('pointerup', input, { clientX: 5, clientY: 5 });
    await settle();
    expect(o.all('edit')).toHaveLength(0);
  });
});

describe('panel stays off the selection', () => {
  const frame = async () => o.tick();
  const panelEl = () => o.root.querySelector('.panel') as HTMLElement;
  const rect = (left: number, right: number) => ({ left, right, top: 14, bottom: 600, width: right - left, height: 586, x: left, y: 14, toJSON() {} }) as DOMRect;

  it('hops to the other side when the new selection sits under it', async () => {
    panelEl().getBoundingClientRect = () => rect(750, 1010);
    layout(el('a1'), { x: 600, y: 100, width: 300, height: 60 });
    click(el('a1'));
    await frame();
    await new Promise((r) => setTimeout(r, 0));
    expect(panelEl().classList.contains('left')).toBe(true);
  });

  it('tucks into the free band above or below a full-width element that both sides would cover', async () => {
    panelEl().getBoundingClientRect = () => rect(750, 1010);
    layout(el('a2'), { x: 10, y: 100, width: 1000, height: 60 });
    click(el('a2'));
    await frame();
    await new Promise((r) => setTimeout(r, 0));
    const room = Math.max(100 - 14 - 28, innerHeight - 160 - 14 - 28);
    expect(panelEl().style.maxHeight).toBe(`${room}px`);
    layout(el('a1'), { x: 100, y: 100, width: 200, height: 60 }); // a clear spot restores the usual place
    click(el('a1'));
    await frame();
    await new Promise((r) => setTimeout(r, 0));
    expect(panelEl().style.maxHeight).toBe('');
  });

  it('collapses to its header when no band is tall enough, and the chevron expands it', async () => {
    panelEl().getBoundingClientRect = () => rect(750, 1010);
    layout(el('a2'), { x: 10, y: 20, width: 1000, height: innerHeight - 40 });
    click(el('a2'));
    await frame();
    await new Promise((r) => setTimeout(r, 0));
    expect(panelEl().classList.contains('mini')).toBe(true);
    (o.root.querySelector('[data-act=mini]') as HTMLButtonElement).click();
    expect(panelEl().classList.contains('mini')).toBe(false);
    layout(el('a1'), { x: 100, y: 100, width: 200, height: 60 });
    click(el('a1'));
    await frame();
    await new Promise((r) => setTimeout(r, 0));
    expect(panelEl().classList.contains('mini')).toBe(false);
  });

  it('stays put when the selection is clear of it, or when the other side is no better', async () => {
    panelEl().getBoundingClientRect = () => rect(750, 1010);
    layout(el('a1'), { x: 100, y: 100, width: 200, height: 60 });
    click(el('a1'));
    await frame();
    await new Promise((r) => setTimeout(r, 0));
    expect(panelEl().classList.contains('left')).toBe(false);
    layout(el('a2'), { x: 10, y: 100, width: 1000, height: 60 }); // spans the page: both sides cover it equally
    click(el('a2'));
    await frame();
    await new Promise((r) => setTimeout(r, 0));
    expect(panelEl().classList.contains('left')).toBe(false);
  });

  it('fades while an element is dragged and comes back after', () => {
    pointer('pointerdown', el('a1'), { clientX: 10, clientY: 10 });
    pointer('pointermove', el('a1'), { clientX: 40, clientY: 10 });
    expect(panelEl().classList.contains('ghost')).toBe(true);
    pointer('pointerup', el('a1'), { clientX: 40, clientY: 10 });
    expect(panelEl().classList.contains('ghost')).toBe(false);
  });
});

describe('panel fades during a handle drag too', () => {
  it('fades while a grip is dragged and comes back on release', () => {
    const panelEl = o.root.querySelector('.panel') as HTMLElement;
    layout(el('a1'), { x: 100, y: 100, width: 200, height: 100 });
    click(el('a1'));
    o.tick();
    const grip = o.root.querySelector('[data-kind="resize-e"]') as HTMLElement;
    pointer('pointerdown', grip, { clientX: 300, clientY: 150 });
    pointer('pointermove', grip, { clientX: 340, clientY: 150 });
    expect(panelEl.classList.contains('ghost')).toBe(true);
    pointer('pointerup', grip, { clientX: 340, clientY: 150 });
    expect(panelEl.classList.contains('ghost')).toBe(false);
  });
});

describe('panel accessibility', () => {
  it('is a labelled region with a proper tablist, tabpanels and arrow-key navigation', () => {
    expect(o.root.querySelector('.panel')!.getAttribute('role')).toBe('region');
    const style = o.root.querySelector('[data-tab=style]') as HTMLElement;
    const layers = o.root.querySelector('[data-tab=layers]') as HTMLElement;
    expect(style.getAttribute('aria-controls')).toBe(o.root.querySelector('[data-pane=style]')!.id);
    expect(o.root.querySelector('[data-pane=style]')!.getAttribute('role')).toBe('tabpanel');
    expect([style.tabIndex, layers.tabIndex]).toEqual([0, -1]);
    style.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(layers.getAttribute('aria-selected')).toBe('true');
    expect([style.tabIndex, layers.tabIndex]).toEqual([-1, 0]);
    expect((o.root.querySelector('[data-pane=layers]') as HTMLElement).hidden).toBe(false);
    layers.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(style.getAttribute('aria-selected')).toBe('true'); // and it wraps around the other way too
    style.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect((o.root.querySelector('[data-tab=a11y]') as HTMLElement).getAttribute('aria-selected')).toBe('true');
  });

  it('every form control has an accessible name', () => {
    const controls = [...o.root.querySelectorAll('input, select, textarea')] as HTMLInputElement[];
    const unnamed = controls.filter((c) => !c.getAttribute('aria-label') && !c.closest('label')?.textContent?.trim());
    expect(unnamed.map((c) => c.name || c.dataset.prop)).toEqual([]);
  });
});

describe('toast with undo', () => {
  const toast = () => o.root.querySelector('.toast') as HTMLElement;
  const undoBtn = () => o.root.querySelector('.toast .undo') as HTMLButtonElement;

  it('confirms a save with an Undo button that reverts it', async () => {
    click(el('a1'));
    key('ArrowRight');
    await ok('h1');
    expect(toast().hidden).toBe(false);
    expect(status()).toContain('Saved');
    expect(undoBtn().hidden).toBe(false);
    undoBtn().click();
    await settle();
    expect(o.last('undo')).toBeTruthy();
    expect(toast().hidden).toBe(true);
  });

  it('errors stay on screen until dismissed', async () => {
    click(el('a1'));
    key('ArrowRight');
    await settle();
    o.reply({ ok: false, error: 'Nope' });
    await settle();
    expect(toast().classList.contains('err')).toBe(true);
    expect(undoBtn().hidden).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(toast().hidden).toBe(false);
    (o.root.querySelector('[data-act=toast-x]') as HTMLButtonElement).click();
    expect(toast().hidden).toBe(true);
  });
});

describe('hex colour field', () => {
  const hexBox = () => o.root.querySelector('input[data-hex="color"]') as HTMLInputElement;

  it('normalises what you type and saves it', async () => {
    click(el('a1'));
    hexBox().value = 'D4401F';
    hexBox().dispatchEvent(new Event('change'));
    await settle();
    expect(hexBox().value).toBe('#d4401f');
    expect((o.root.querySelector('input[data-prop="color"]') as HTMLInputElement).value).toBe('#d4401f');
    expect(o.last('edit').edit).toMatchObject({ props: { color: '#d4401f' } });
  });

  it('rejects text that is not a colour without sending anything', async () => {
    click(el('a1'));
    hexBox().value = 'nope';
    hexBox().dispatchEvent(new Event('change'));
    await settle();
    expect(hexBox().getAttribute('aria-invalid')).toBe('true');
    expect(o.all('edit')).toHaveLength(0);
    expect(status()).toContain('hex colour');
  });

  it('normalizeHex handles shorthand, alpha and junk', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('ABCD')).toBe('#aabbccdd');
    expect(normalizeHex(' #AABBCC80 ')).toBe('#aabbcc80');
    for (const bad of ['', '#12', '#12345', 'red', '#gggggg', '#1234567']) expect(normalizeHex(bad), bad).toBeNull();
  });
});

describe('edit hints', () => {
  it('tell the server the root font size, so on-scale values can be written as plain utilities', async () => {
    document.documentElement.style.fontSize = '16px';
    click(el('a1'));
    key('ArrowRight');
    await settle();
    expect(o.last('edit').edit.hints).toMatchObject({ rootPx: 16 });
    document.documentElement.style.fontSize = '';
  });
});

describe('rubber-band selection', () => {
  beforeEach(() => {
    layout(el('a1'), { x: 10, y: 10, width: 100, height: 20 });
    layout(el('a2'), { x: 10, y: 40, width: 100, height: 20 });
    layout(el('a3'), { x: 300, y: 300, width: 100, height: 80 });
    layout(el('a4'), { x: 310, y: 310, width: 40, height: 20 });
  });
  const band = (from: [number, number], to: [number, number], init: Partial<MouseEventInit> = {}) => {
    pointer('pointerdown', document.body, { clientX: from[0], clientY: from[1], ...init });
    pointer('pointermove', document.body, { clientX: to[0], clientY: to[1], ...init });
    return () => pointer('pointerup', document.body, { clientX: to[0], clientY: to[1], ...init });
  };
  const box = () => o.root.querySelector('.marquee') as HTMLElement;

  it('drawing a box from empty space selects everything fully inside it', () => {
    const release = band([0, 0], [150, 100]);
    expect(box().hidden).toBe(false);
    expect(box().style.width).toBe('150px');
    release();
    expect(box().hidden).toBe(true);
    expect(info()).toContain('2 elements selected');
  });

  it('ignores elements the box only touches, and keeps the outermost of nested ones', () => {
    band([0, 0], [20, 100])(); // cuts through the middle of a1 and a2
    expect(info()).toBe('Click an element to select it.');
    band([290, 290], [420, 400])(); // holds both a3 and the a4 inside it
    expect(o.last('select').selection).toEqual({ id: 'a3', tag: 'div' });
    expect(info()).not.toContain('elements selected');
  });

  it('Shift adds to the selection', () => {
    click(el('a3'));
    band([0, 0], [150, 100], { shiftKey: true })();
    expect(info()).toContain('3 elements selected');
  });

  it('a plain click on empty space still deselects, and an empty box clears the selection', () => {
    click(el('a1'));
    click(document.body);
    expect(info()).toBe('Click an element to select it.');
    click(el('a1'));
    band([600, 600], [700, 700])();
    expect(info()).toBe('Click an element to select it.');
  });

  it('Alt+drag draws a box even starting on an element, and Alt+click selects it', () => {
    pointer('pointerdown', el('a1'), { clientX: 0, clientY: 0, altKey: true });
    pointer('pointermove', el('a1'), { clientX: 150, clientY: 100, altKey: true });
    pointer('pointerup', el('a1'), { clientX: 150, clientY: 100, altKey: true });
    expect(info()).toContain('2 elements selected');
    click(document.body);
    pointer('pointerdown', el('a2'), { clientX: 20, clientY: 45, altKey: true });
    pointer('pointerup', el('a2'), { clientX: 20, clientY: 45, altKey: true });
    expect(o.last('select').selection).toEqual({ id: 'a2', tag: 'p' });
  });
});

describe('snapping to neighbours while dragging', () => {
  beforeEach(() => {
    layout(el('a1'), { x: 10, y: 10, width: 100, height: 20 });
    layout(el('a2'), { x: 16, y: 100, width: 80, height: 20 });
  });
  const dragBy = (dx: number, dy: number, init: Partial<MouseEventInit> = {}) => {
    pointer('pointerdown', el('a1'), { clientX: 20, clientY: 15, ...init });
    pointer('pointermove', el('a1'), { clientX: 20 + dx, clientY: 15 + dy, ...init });
    return () => pointer('pointerup', el('a1'), { clientX: 20 + dx, clientY: 15 + dy, ...init });
  };
  const guides = () => o.root.querySelectorAll('.guide');

  it('pulls the left edge onto a nearby edge and draws a guide', () => {
    const release = dragBy(7, 0); // a1's left edge lands on 17, a2 starts at 16: pulled back 1px
    expect(el('a1').style.marginLeft).toBe('6px');
    expect(guides().length).toBeGreaterThan(0);
    release();
    expect(guides()).toHaveLength(0);
  });

  it('snaps centres too, and does nothing beyond a few pixels', () => {
    dragBy(20, 0)(); // far from every edge and centre
    expect(el('a1').style.marginLeft).toBe('20px');
    // a1's centre is 60+dx and a2's is 56: dx = -6 puts it at 54, which snaps to 56 (dx -4)
    el('a1').style.marginLeft = '';
    dragBy(-6, 0)();
    expect(el('a1').style.marginLeft).toBe('-4px');
  });

  it('Ctrl or Cmd moves freely', () => {
    dragBy(7, 0, { ctrlKey: true })();
    expect(el('a1').style.marginLeft).toBe('7px');
  });

  it('leaves an axis alone when the drag is not moving along it', () => {
    const base = parseFloat(getComputedStyle(el('a1')).marginTop) || 0; // jsdom gives an h1 a default margin
    dragBy(0, 4)(); // a2's top edge is 100 away: nothing in range, and x is untouched
    expect(el('a1').style.marginLeft).toBe('');
    expect(el('a1').style.marginTop).toBe(`${Math.round(base + 4)}px`);
  });
});
