import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject } from '../src/init';
import { NotesStore } from '../src/server/notes';

let dir: string;
let store: NotesStore;
const anchor = { tag: 'h1', classes: [], text: 'Hello', src: 'src/App.tsx:3:4', index: 0, page: '/' };
const notesDir = () => path.join(dir, '.brushup', 'notes');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait for a file-watcher effect: poll for it instead of hoping a fixed pause is long enough on a busy machine. */
const until = async (fn: () => boolean | Promise<boolean>, ms = 8000) => {
  for (let waited = 0; waited < ms; waited += 100) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-shared-'));
  store = new NotesStore(dir);
});
afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('shared notes: one file per note', () => {
  it('stays in the private layout until asked, and moves existing notes across when shared', async () => {
    await store.save({ text: 'first', anchor });
    await store.save({ text: 'second', anchor });
    expect(await store.shared()).toBe(false);
    expect(await store.share()).toEqual({ moved: 2 });
    expect(await store.shared()).toBe(true);
    const files = (await readdir(notesDir())).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(2);
    await expect(readFile(path.join(dir, '.brushup', 'notes.json'), 'utf8')).rejects.toThrow(); // no second copy to drift
    expect((await store.list()).map((n) => n.text)).toEqual(['first', 'second']);
    expect(await store.share()).toEqual({ moved: 0 }); // safe to repeat
  });

  it('saves, edits and removes notes as their own files, and keeps a local notes.md', async () => {
    await store.share();
    const [a] = await store.save({ text: 'one', anchor });
    const list = await store.save({ text: 'two', anchor });
    expect(list).toHaveLength(2);
    expect((await readdir(notesDir())).filter((f) => f.endsWith('.json')).sort()).toEqual(list.map((n) => `${n.id}.json`).sort());
    await store.save({ id: a.id, text: 'one, edited', status: 'done', reply: 'Done in App.tsx', anchor });
    expect(JSON.parse(await readFile(path.join(notesDir(), `${a.id}.json`), 'utf8'))).toMatchObject({ text: 'one, edited', status: 'done', reply: 'Done in App.tsx' });
    const md = await readFile(path.join(dir, '.brushup', 'notes.md'), 'utf8');
    expect(md).toContain('its file in `.brushup/notes/`');
    expect(md).not.toContain('one, edited'); // a done note isn't listed as open
    await store.remove(a.id);
    expect((await readdir(notesDir())).filter((f) => f.endsWith('.json'))).toHaveLength(1);
    expect(await store.list()).toHaveLength(1);
  });

  it('sees a note a teammate added with git pull (a new file), and numbers notes the same everywhere', async () => {
    await store.share();
    await store.save({ text: 'mine', anchor });
    // A note from another machine, with its own id and an earlier date.
    await writeFile(path.join(notesDir(), 'aaaa1111.json'), JSON.stringify({ id: 'aaaa1111', kind: 'element', label: '', text: 'theirs', anchor, status: 'open', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' }));
    expect((await store.list()).map((n) => n.text)).toEqual(['theirs', 'mine']); // date order, the same on every machine
  });

  it('announces a teammate\'s file to the watcher, but not our own writes', async () => {
    await store.share();
    const seen: string[][] = [];
    store.watch((l) => seen.push(l.map((n) => n.text)));
    await sleep(300);
    await store.save({ text: 'ours', anchor });
    await sleep(700);
    expect(seen).toEqual([]);
    await writeFile(path.join(notesDir(), 'bbbb2222.json'), JSON.stringify({ id: 'bbbb2222', text: 'from git', anchor, status: 'open' }));
    expect(await until(() => seen.at(-1)?.includes('from git') ?? false)).toBe(true);
  });

  it('refreshes notes.md when a teammate\'s note arrives, and at start-up for notes pulled while the server was off', async () => {
    await store.share();
    await store.save({ text: 'mine', anchor });
    const theirs = (id: string, text: string) => writeFile(path.join(notesDir(), `${id}.json`), JSON.stringify({ id, text, anchor, status: 'open', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' }));
    await theirs('dddd4444', 'pulled while the server was off');
    store.watch(() => {});
    const md = () => readFile(path.join(dir, '.brushup', 'notes.md'), 'utf8').catch(() => '');
    expect(await until(async () => (await md()).includes('pulled while the server was off'))).toBe(true);
    await sleep(300); // the watcher is up by now
    await theirs('eeee5555', 'pulled while it was running');
    expect(await until(async () => (await md()).includes('pulled while it was running'))).toBe(true);
  });

  it('skips a note file that is not valid JSON instead of losing the others', async () => {
    await store.share();
    await store.save({ text: 'fine', anchor });
    await writeFile(path.join(notesDir(), 'broken.json'), '{ this is a merge conflict <<<<<<<');
    expect((await store.list()).map((n) => n.text)).toEqual(['fine']);
  });
});

describe('brushup init --share-notes', () => {
  it('writes .gitignore so git keeps .brushup/notes/ and ignores the rest, creating the file if there is none', async () => {
    const r = await initProject(dir, { shareNotes: true, wire: false });
    expect(r.sharedNotes).toEqual({ moved: 0 });
    expect(r.gitignore).toBe('updated');
    const ignore = await readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(ignore).toContain('.brushup/*');
    expect(ignore).toContain('!.brushup/notes/');
    expect((await initProject(dir, { shareNotes: true, wire: false })).gitignore).toBe('unchanged');
  });

  it('replaces a bare .brushup/ line, which would ignore the notes folder too, and keeps the other lines', async () => {
    await writeFile(path.join(dir, '.gitignore'), 'node_modules\n.brushup/\ndist\n');
    await initProject(dir, { shareNotes: true, wire: false });
    const lines = (await readFile(path.join(dir, '.gitignore'), 'utf8')).split('\n');
    expect(lines).not.toContain('.brushup/');
    expect(lines).toEqual(expect.arrayContaining(['node_modules', 'dist', '.brushup/*', '!.brushup/notes/']));
  });

  it('does what it promises in real git: notes are tracked, the rest of .brushup is not', async () => {
    try {
      git('init', '-q');
    } catch {
      return; // no git here
    }
    await initProject(dir, { shareNotes: true, wire: false });
    await store.save({ text: 'for the team', anchor });
    await mkdir(path.join(dir, '.brushup'), { recursive: true });
    for (const f of ['edits.jsonl', 'selection.json', 'notes.md', 'ignored-checks.json']) await writeFile(path.join(dir, '.brushup', f), 'x');
    const [noteFile] = (await readdir(notesDir())).filter((f) => f.endsWith('.json'));
    await writeFile(path.join(notesDir(), '.half-written.tmp'), 'x');
    const ignored = (p: string) => {
      try {
        git('check-ignore', '-q', p);
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored(`.brushup/notes/${noteFile}`)).toBe(false);
    for (const f of ['edits.jsonl', 'selection.json', 'notes.md', 'ignored-checks.json', 'notes/.half-written.tmp']) expect(ignored(`.brushup/${f}`), f).toBe(true);
  });
});
