import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectChanges, splitDiff } from '../src/server/changes';

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
