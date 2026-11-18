import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotesStore, renderNotesMarkdown, sanitizeNote } from '../src/server/notes';

let dir: string;
let store: NotesStore;

const anchor = { tag: 'h1', classes: ['text-4xl', 'font-bold'], text: 'Ship interfaces your agent drafted', src: 'src/app/page.tsx:21:8', index: 0, page: '/' };

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-notes-'));
  store = new NotesStore(dir);
});
afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('NotesStore', () => {
  it('saves a note, writes notes.json and a readable notes.md pointing at source', async () => {
    const list = await store.save({ kind: 'section', label: 'Hero', text: 'Feels cramped, add breathing room', anchor });
    expect(list).toHaveLength(1);
    const md = await readFile(path.join(dir, '.brushup', 'notes.md'), 'utf8');
    expect(md).toContain('## 1. Hero (section)');
    expect(md).toContain('Feels cramped, add breathing room');
    expect(md).toContain('`src/app/page.tsx:21:8`');
    expect(md).toContain('"Ship interfaces your agent drafted"');
    expect(JSON.parse(await readFile(path.join(dir, '.brushup', 'notes.json'), 'utf8'))[0].status).toBe('open');
  });

  it('updates in place by id, and removes', async () => {
    const [n] = await store.save({ text: 'first', anchor });
    const after = await store.save({ id: n.id, text: 'second', anchor });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: n.id, text: 'second', createdAt: n.createdAt });
    expect(await store.remove(n.id)).toEqual([]);
  });

  it('shows component usages and leaves done notes out of notes.md', async () => {
    await store.save({ kind: 'component', label: 'Primary button', text: 'Make it wider', anchor: { ...anchor, tag: 'button', use: 'src/app/page.tsx:30:10#Button' } });
    const [first] = await store.list();
    await store.save({ ...first, status: 'done', text: 'x' });
    await store.save({ text: 'still open', anchor });
    const md = await readFile(path.join(dir, '.brushup', 'notes.md'), 'utf8');
    expect(md).not.toContain('Primary button');
    expect(md).toContain('still open');
    // numbering is the position in the full list, matching the pin on the canvas
    expect(renderNotesMarkdown(await store.list())).toContain('## 2.');
  });

  it('shows a component note with its usage site', async () => {
    await store.save({ kind: 'component', label: 'Primary button', text: 'Make it wider', anchor: { ...anchor, tag: 'button', use: 'src/app/page.tsx:30:10#Button' } });
    const md = await readFile(path.join(dir, '.brushup', 'notes.md'), 'utf8');
    expect(md).toContain('component `<Button>` used at `src/app/page.tsx:30:10`');
  });

  it('picks up notes.json edits made by someone else (an agent marking a note done)', async () => {
    const [n] = await store.save({ text: 'handle me', anchor });
    const seen: string[] = [];
    store.watch((list) => seen.push(...list.map((x) => x.status)));
    await new Promise((r) => setTimeout(r, 300));
    await writeFile(path.join(dir, '.brushup', 'notes.json'), JSON.stringify([{ ...n, status: 'done' }]));
    await new Promise((r) => setTimeout(r, 800));
    expect(seen).toContain('done');
  });

  it('does not echo its own writes to the watcher', async () => {
    const seen: number[] = [];
    await store.save({ text: 'a', anchor });
    store.watch((l) => seen.push(l.length));
    await new Promise((r) => setTimeout(r, 300));
    await store.save({ text: 'b', anchor });
    await new Promise((r) => setTimeout(r, 800));
    expect(seen).toEqual([]);
  });

  it('rejects empty notes and sanitises hostile input', async () => {
    await expect(store.save({ text: '   ', anchor })).rejects.toThrow();
    await expect(store.save({ text: 'x' })).rejects.toThrow();
    const n = sanitizeNote({ kind: 'bogus', text: 'a\u0000b', label: 'x'.repeat(500), anchor: { ...anchor, classes: new Array(100).fill('c') } })!;
    expect(n.kind).toBe('element');
    expect(n.text).toBe('ab');
    expect(n.label).toHaveLength(120);
    expect(n.anchor.classes).toHaveLength(40);
  });
});
