import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectChanges, dirtyFiles, splitDiff } from '../src/server/changes';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-changes-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('splitDiff', () => {
  it('splits per file and counts added and removed lines, not the header lines', () => {
    const text = 'diff --git a/a.tsx b/a.tsx\nindex 1..2 100644\n--- a/a.tsx\n+++ b/a.tsx\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n keep\ndiff --git a/b.css b/b.css\n--- a/b.css\n+++ b/b.css\n@@ -1 +1 @@\n-x\n+y\n';
    const m = splitDiff(text);
    expect([...m.keys()]).toEqual(['a.tsx', 'b.css']);
    expect(m.get('a.tsx')).toMatchObject({ additions: 2, deletions: 1 });
    expect(m.get('b.css')).toMatchObject({ additions: 1, deletions: 1 });
  });
});

describe('collectChanges', () => {
  it('says so when the folder is not a git repository', async () => {
    const r = await collectChanges(dir);
    expect(r.repo).toBe(false);
  });

  it('lists changed and new files, with the ones Brushup edited first and its own folder left out', async () => {
    git('init', '-q');
    git('config', 'user.email', 't@t.t');
    git('config', 'user.name', 't');
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src', 'page.tsx'), '<p>Hello</p>\n');
    await writeFile(path.join(dir, 'src', 'other.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    await writeFile(path.join(dir, 'src', 'page.tsx'), '<p>Hi there</p>\n');
    await writeFile(path.join(dir, 'src', 'other.ts'), 'export const a = 2;\n');
    await writeFile(path.join(dir, 'new.txt'), 'new\n');
    await mkdir(path.join(dir, '.brushup'));
    await writeFile(path.join(dir, '.brushup', 'edits.jsonl'), JSON.stringify({ at: new Date().toISOString(), files: ['src/page.tsx'] }) + '\n');
    const r = await collectChanges(dir);
    if (!r.repo) throw new Error(r.reason);
    expect(r.files.map((f) => [f.file, f.status, f.byBrushup])).toEqual([
      ['src/page.tsx', 'M', true],
      ['new.txt', '?', false],
      ['src/other.ts', 'M', false],
    ]);
    const page = r.files[0];
    expect(page).toMatchObject({ additions: 1, deletions: 1 });
    expect(page.diff).toContain('+<p>Hi there</p>');
    expect(r.files.find((f) => f.file === 'new.txt')!.diff).toBe('');
  });

  it('reports a clean tree as no files', async () => {
    git('init', '-q');
    git('config', 'user.email', 't@t.t');
    git('config', 'user.name', 't');
    await writeFile(path.join(dir, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const r = await collectChanges(dir);
    expect(r.repo && r.files).toEqual([]);
  });
});

describe('dirtyFiles', () => {
  const init = () => {
    git('init', '-q');
    git('config', 'user.email', 't@t.t');
    git('config', 'user.name', 't');
  };

  it('names the tracked files that differ from the last commit, and only those', async () => {
    init();
    await writeFile(path.join(dir, 'clean.txt'), 'a\n');
    await writeFile(path.join(dir, 'dirty.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    await writeFile(path.join(dir, 'dirty.txt'), 'changed\n');
    await writeFile(path.join(dir, 'untracked.txt'), 'new\n');
    expect(await dirtyFiles(dir, ['clean.txt', 'dirty.txt', 'untracked.txt', 'missing.txt'])).toEqual(['dirty.txt']);
  });

  it('counts a staged change as different too', async () => {
    init();
    await writeFile(path.join(dir, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    await writeFile(path.join(dir, 'a.txt'), 'staged\n');
    git('add', 'a.txt');
    expect(await dirtyFiles(dir, ['a.txt'])).toEqual(['a.txt']);
  });

  it('has nothing to say outside git, before the first commit, or for no files', async () => {
    expect(await dirtyFiles(dir, ['a.txt'])).toEqual([]);
    init();
    await writeFile(path.join(dir, 'a.txt'), 'a\n');
    git('add', '.');
    expect(await dirtyFiles(dir, ['a.txt'])).toEqual([]); // nothing committed yet, so nothing to be mixed with
    expect(await dirtyFiles(dir, [])).toEqual([]);
  });
});

describe('warning before the first write to a file with uncommitted changes', () => {
  const page = (body: string) => `export default function A() {\n  return (\n    <main>\n${body}\n    </main>\n  );\n}\n`;
  const idAt = (code: string, marker: string) => {
    const at = code.lastIndexOf('<', code.indexOf(marker));
    const before = code.slice(0, at).split('\n');
    return `src/A.tsx:${before.length}:${before[before.length - 1].length}`;
  };

  async function project(opts: { dirty: boolean; repo?: boolean }) {
    const { mkdir } = await import('node:fs/promises');
    const { DevProject } = await import('../src/server/dev-project');
    await mkdir(path.join(dir, 'src'));
    const code = page('      <p id="a">One</p>\n      <p id="b">Two</p>');
    await writeFile(path.join(dir, 'src', 'A.tsx'), code);
    if (opts.repo !== false) {
      git('init', '-q');
      git('config', 'user.email', 't@t.t');
      git('config', 'user.name', 't');
      git('add', '.');
      git('commit', '-q', '-m', 'init');
    }
    if (opts.dirty) await writeFile(path.join(dir, 'src', 'A.tsx'), code.replace('One', 'One, edited by hand'));
    const now = async () => (await import('node:fs/promises')).readFile(path.join(dir, 'src', 'A.tsx'), 'utf8');
    return { project: new DevProject(dir), code: await now(), now, text: (c: string, marker: string, value: string) => ({ kind: 'text' as const, id: idAt(c, marker), tag: 'p', text: value }) };
  }

  it('warns the first time, naming the file, and not again for that file', async () => {
    const t = await project({ dirty: true });
    const first = await t.project.edit(t.text(t.code, 'id="a"', 'Uno'));
    expect(first.warning).toMatch(/src\/A\.tsx already had uncommitted changes, so Brushup's edits are now mixed in with them in git/);
    const second = await t.project.edit(t.text(await t.now(), 'id="b"', 'Dos'));
    expect(second.warning).toBeUndefined();
  });

  it('stays quiet for a file that matches the last commit, and for a project outside git', async () => {
    const clean = await project({ dirty: false });
    expect((await clean.project.edit(clean.text(clean.code, 'id="a"', 'Uno'))).warning).toBeUndefined();
  });

  it('stays quiet when the project is not in git at all', async () => {
    const none = await project({ dirty: true, repo: false });
    expect((await none.project.edit(none.text(none.code, 'id="a"', 'Uno'))).warning).toBeUndefined();
  });
});
