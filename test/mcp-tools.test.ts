import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findRoot } from '../src/mcp/server';
import { getNotes, getRecentEdits, getSelection, inspect, updateNote } from '../src/mcp/tools';
import { NotesStore } from '../src/server/notes';

let dir: string;
const ctx = () => ({ root: dir });
const anchor = (over: Record<string, unknown> = {}) => ({ tag: 'h1', classes: ['text-4xl'], text: 'Ship it', src: 'src/app/page.tsx:24:8', index: 0, page: '/', ...over });

beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-mcp-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('brushup_get_notes', () => {
  it('returns open notes with pin numbers and where they live in source', async () => {
    const store = new NotesStore(dir);
    await store.save({ kind: 'section', label: 'Hero', text: 'Too cramped', anchor: anchor() });
    await store.save({ kind: 'component', label: 'CTA', text: 'Wider', anchor: anchor({ tag: 'button', use: 'src/app/page.tsx:31:10#Button' }) });
    const r = await getNotes(ctx(), {});
    expect(r.ok && (r.data as any).count).toBe(2);
    const [hero, cta] = (r as any).data.notes;
    expect(hero).toMatchObject({ number: 1, kind: 'section', name: 'Hero', note: 'Too cramped', where: { renderedBy: 'src/app/page.tsx:24:8' } });
    expect(cta.where.component).toBe('<Button> used at src/app/page.tsx:31:10');
  });

  it('filters by status and page, keeping the original numbering', async () => {
    const store = new NotesStore(dir);
    await store.save({ text: 'one', anchor: anchor() });
    const list = await store.save({ text: 'two', anchor: anchor({ page: '/pricing' }) });
    await store.save({ ...list[0], status: 'done' });
    const open = (await getNotes(ctx(), {})) as any;
    expect(open.data.notes.map((n: any) => [n.number, n.note])).toEqual([[2, 'two']]);
    expect(((await getNotes(ctx(), { status: 'done' })) as any).data.count).toBe(1);
    expect(((await getNotes(ctx(), { status: 'all', page: '/pricing' })) as any).data.notes[0].number).toBe(2);
  });

  it('is empty when there is no .brushup folder', async () => {
    expect(((await getNotes(ctx(), {})) as any).data).toMatchObject({ count: 0, notes: [] });
  });
});

describe('brushup_update_note', () => {
  it('marks a note done and writes only notes.json / notes.md', async () => {
    const [n] = await new NotesStore(dir).save({ text: 'x', anchor: anchor() });
    expect(await updateNote(ctx(), { id: n.id, status: 'done' })).toEqual({ ok: true, data: { id: n.id, status: 'done' } });
    expect(JSON.parse(await readFile(path.join(dir, '.brushup/notes.json'), 'utf8'))[0].status).toBe('done');
    expect(await readFile(path.join(dir, '.brushup/notes.md'), 'utf8')).toContain('_No open notes._');
  });

  it('explains an unknown id', async () => {
    const r = await updateNote(ctx(), { id: 'nope', status: 'done' });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toContain('brushup_get_notes');
  });
});

describe('brushup_get_selection', () => {
  it('reads the selection the canvas wrote', async () => {
    await mkdir(path.join(dir, '.brushup'));
    await writeFile(path.join(dir, '.brushup/selection.json'), JSON.stringify({ file: 'src/app/page.tsx', line: 24, tag: 'h1' }));
    const r = (await getSelection(ctx())) as any;
    expect(r.data.selection).toMatchObject({ file: 'src/app/page.tsx', line: 24 });
    expect(typeof r.data.updatedAt).toBe('string');
  });

  it('says so when nothing is selected', async () => {
    expect(((await getSelection(ctx())) as any).data.selection).toBeNull();
    await mkdir(path.join(dir, '.brushup'));
    await writeFile(path.join(dir, '.brushup/selection.json'), 'null\n');
    expect(((await getSelection(ctx())) as any).data.selection).toBeNull();
  });
});

describe('brushup_recent_edits', () => {
  const line = (o: object) => JSON.stringify({ at: '2026-01-01T00:00:00Z', ...o }) + '\n';
  beforeEach(async () => {
    await mkdir(path.join(dir, '.brushup'));
    await writeFile(
      path.join(dir, '.brushup/edits.jsonl'),
      line({ edit: { kind: 'style', id: 'src/page.tsx:31:10#Button', props: { 'font-size': '18px' } }, files: ['src/page.tsx'] }) +
        line({ edits: [{ kind: 'style', id: 'src/page.tsx:32:10#Button', props: { 'padding-left': '24px' } }, { kind: 'text', id: 'src/page.tsx:31:10#Button', text: 'Start building' }], files: ['src/page.tsx'] }) +
        line({ undo: ['src/page.tsx'] }) +
        'not json\n',
    );
  });

  it('lists newest first, flattening batches and summarising each change', async () => {
    const r = (await getRecentEdits(ctx(), {})) as any;
    expect(r.data.count).toBe(3);
    expect(r.data.edits[0]).toMatchObject({ action: 'undo', files: ['src/page.tsx'] });
    expect(r.data.edits[1].changes).toEqual([
      { target: 'src/page.tsx:32#Button', change: 'padding-left: 24px' },
      { target: 'src/page.tsx:31#Button', change: 'text → "Start building"' },
    ]);
    expect(r.data.edits[2].changes[0].change).toBe('font-size: 18px');
  });

  it('respects the limit and handles a missing log', async () => {
    expect(((await getRecentEdits(ctx(), { limit: 1 })) as any).data.count).toBe(1);
    await rm(path.join(dir, '.brushup'), { recursive: true });
    expect(((await getRecentEdits(ctx(), {})) as any).data.count).toBe(0);
  });
});

describe('brushup_inspect with several notes', () => {
  it('asks once per note and keeps each answer, including the ones that failed', async () => {
    const asked: unknown[] = [];
    const ask = async (q: unknown) => {
      asked.push(q);
      const id = (q as { noteId: string }).noteId;
      return id === 'gone' ? { ok: false as const, error: 'That note\'s element is not on this page.' } : { ok: true as const, data: { tag: id } };
    };
    const r = await inspect({ root: dir, ask }, { note_ids: ['a', 'gone', 'b'] });
    expect(r).toEqual({ ok: true, data: { count: 3, elements: [{ note_id: 'a', tag: 'a' }, { note_id: 'gone', error: "That note's element is not on this page." }, { note_id: 'b', tag: 'b' }] } });
    expect(asked).toHaveLength(3);
  });

  it('caps the list at ten and still handles the single-note and selection forms', async () => {
    const asked: unknown[] = [];
    const ask = async (q: unknown) => (asked.push(q), { ok: true as const, data: {} });
    await inspect({ root: dir, ask }, { note_ids: Array.from({ length: 14 }, (_, i) => `n${i}`) });
    expect(asked).toHaveLength(10);
  });
});

describe('brushup_inspect', () => {
  it('asks the canvas and returns its answer, passing the note id', async () => {
    const asked: unknown[] = [];
    const ask = async (q: Record<string, unknown>) => (asked.push(q), { ok: true as const, data: { tag: 'h1', box: { width: 600 } } });
    expect(await inspect({ root: dir, ask }, { note_id: 'abc' })).toEqual({ ok: true, data: { tag: 'h1', box: { width: 600 } } });
    expect(asked).toEqual([{ kind: 'inspect', noteId: 'abc' }]);
  });

  it('passes the canvas error through', async () => {
    const ask = async () => ({ ok: false as const, error: 'Nothing is selected on the canvas.' });
    expect(await inspect({ root: dir, ask }, {})).toEqual({ ok: false, error: 'Nothing is selected on the canvas.' });
  });

  it('explains when Brushup is not running (no host.json)', async () => {
    const r = await inspect({ root: dir }, {});
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/not running/i);
  });
});

describe('findRoot', () => {
  it('prefers --root, then BRUSHUP_ROOT, then the nearest folder with .brushup', async () => {
    expect(findRoot(['--root', '/a/b'], {}, '/x')).toBe(path.resolve('/a/b'));
    expect(findRoot([], { BRUSHUP_ROOT: '/c' }, '/x')).toBe(path.resolve('/c'));
    await mkdir(path.join(dir, '.brushup'));
    await mkdir(path.join(dir, 'src/deep'), { recursive: true });
    expect(findRoot([], {}, path.join(dir, 'src/deep'))).toBe(dir);
    expect(findRoot([], {}, '/')).toBe('/');
  });
});

describe('token economy', () => {
  it('caps long class lists but reports the total', async () => {
    const classes = Array.from({ length: 40 }, (_, i) => `c${i}`);
    await new NotesStore(dir).save({ text: 'x', anchor: anchor({ classes }) });
    const el = ((await getNotes(ctx(), {})) as any).data.notes[0].element;
    expect(el.classes).toHaveLength(12);
    expect(el.classesTotal).toBe(40);
  });
});

describe('the agent inbox', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('keeps a note\'s times when it is read, so since can tell what changed', async () => {
    const store = new NotesStore(dir);
    await store.save({ text: 'old', anchor: anchor() });
    const first = ((await getNotes(ctx(), { status: 'all' })) as any).data;
    await wait(20);
    const second = ((await getNotes(ctx(), { status: 'all' })) as any).data;
    expect(second.notes[0].updatedAt).toBe(first.notes[0].updatedAt);
  });

  it('returns only what is new since the cursor, and hands back the next cursor', async () => {
    const store = new NotesStore(dir);
    await store.save({ text: 'first', anchor: anchor() });
    const a = ((await getNotes(ctx(), {})) as any).data;
    expect(a.count).toBe(1);
    expect(Date.parse(a.cursor)).not.toBeNaN();
    await wait(20);
    expect(((await getNotes(ctx(), { since: a.cursor })) as any).data.count).toBe(0);
    await wait(20);
    await store.save({ text: 'second', anchor: anchor() });
    const b = ((await getNotes(ctx(), { since: a.cursor })) as any).data;
    expect(b.notes.map((n: any) => n.note)).toEqual(['second']);
  });

  it('shows a note that was reopened or changed after the cursor', async () => {
    const store = new NotesStore(dir);
    const list = await store.save({ text: 'x', anchor: anchor() });
    await updateNote(ctx(), { id: list[0].id, status: 'done' });
    const c = ((await getNotes(ctx(), { status: 'all' })) as any).data.cursor;
    await wait(20);
    await updateNote(ctx(), { id: list[0].id, status: 'open' });
    expect(((await getNotes(ctx(), { since: c })) as any).data.notes[0].status).toBe('open');
  });

  it('refuses a since that is not a date', async () => {
    const r = await getNotes(ctx(), { since: 'yesterday-ish' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/ISO date-time/);
  });

  it('stores the agent\'s reply with the note, shows it, and keeps it when the canvas saves the note again', async () => {
    const store = new NotesStore(dir);
    const list = await store.save({ text: 'Make it wider', anchor: anchor() });
    const r = await updateNote(ctx(), { id: list[0].id, status: 'done', reply: 'Widened to max-w-4xl in page.tsx' });
    expect(r.ok && (r.data as any).reply).toBe('Widened to max-w-4xl in page.tsx');
    expect(((await getNotes(ctx(), { status: 'done' })) as any).data.notes[0].reply).toBe('Widened to max-w-4xl in page.tsx');
    const [note] = await store.list();
    await store.save({ id: note.id, text: 'Make it wider, please', anchor: note.anchor, status: 'done' }); // the canvas edits the text
    expect(((await getNotes(ctx(), { status: 'done' })) as any).data.notes[0].reply).toBe('Widened to max-w-4xl in page.tsx');
    await updateNote(ctx(), { id: note.id, status: 'open' }); // reopening without a reply keeps the old one
    expect(((await getNotes(ctx(), { status: 'all' })) as any).data.notes[0].reply).toBe('Widened to max-w-4xl in page.tsx');
  });

  it('marks manual edits locked, filters by since, and says what locked means', async () => {
    await mkdir(path.join(dir, '.brushup'));
    const old = { at: '2026-01-01T00:00:00.000Z', edit: { kind: 'text', id: 'a.tsx:1:1', text: 'Old' }, files: ['a.tsx'] };
    const fresh = { at: new Date(Date.now() + 5000).toISOString(), edit: { kind: 'style', id: 'a.tsx:2:2', props: { width: '10px' } }, files: ['a.tsx'] };
    const undone = { at: new Date(Date.now() + 6000).toISOString(), undo: ['a.tsx'] };
    await writeFile(path.join(dir, '.brushup', 'edits.jsonl'), [old, fresh, undone].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const all = ((await getRecentEdits(ctx(), {})) as any).data;
    expect(all.rule).toMatch(/do not revert/);
    expect(all.edits.map((e: any) => [e.action, e.locked])).toEqual([['undo', false], ['edit', true], ['edit', true]]);
    const recent = ((await getRecentEdits(ctx(), { since: '2026-06-01T00:00:00Z' })) as any).data;
    expect(recent.edits).toHaveLength(2);
    expect(Date.parse(recent.cursor)).not.toBeNaN();
    expect((await getRecentEdits(ctx(), { since: 'nope' })).ok).toBe(false);
  });
});
