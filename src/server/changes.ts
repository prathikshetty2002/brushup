import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ChangedFile {
  file: string;
  /** 'M' modified, 'A' added, 'D' deleted, 'R' renamed, '?' not tracked yet. */
  status: string;
  additions: number;
  deletions: number;
  /** The unified diff for this file; empty for untracked and binary files. */
  diff: string;
  /** Brushup wrote to this file in a canvas edit (as logged in .brushup/edits.jsonl). */
  byBrushup: boolean;
}

export type Changes = { repo: false; reason: string } | { repo: true; branch: string; files: ChangedFile[]; truncated: boolean };

const MAX_BYTES = 600 * 1024;

const git = (cwd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    // Fixed arguments, no shell, and no external diff or text-conversion programs from the repo's config.
    execFile('git', ['--no-pager', '-c', 'core.quotepath=off', ...args], { cwd, maxBuffer: MAX_BYTES * 2, timeout: 10_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });

/** The files Brushup has written to, from the edit log the canvas keeps (paths relative to the project). */
async function brushupFiles(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    for (const line of (await readFile(path.join(root, '.brushup', 'edits.jsonl'), 'utf8')).split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        for (const f of [...(e.files ?? []), ...(e.undo ?? []), ...(e.redo ?? [])]) if (typeof f === 'string') out.add(f.replace(/\\/g, '/'));
      } catch {
        /* a corrupt line is skipped */
      }
    }
  } catch {
    /* no edits yet */
  }
  return out;
}

/** Split `git diff` output into one chunk per file, with line counts. */
export function splitDiff(text: string): Map<string, { diff: string; additions: number; deletions: number }> {
  const files = new Map<string, { diff: string; additions: number; deletions: number }>();
  for (const chunk of text.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
    if (!header) continue;
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    files.set(header[2], { diff: chunk, additions, deletions });
  }
  return files;
}

/** What has changed in the project's working tree since the last commit, with the files Brushup edited marked. */
export async function collectChanges(root: string): Promise<Changes> {
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { repo: false, reason: 'This project is not in a git repository (or git is not installed), so there is nothing to compare against.' };
  }
  try {
    const [branch, status, diffText, mine] = await Promise.all([
      git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD'),
      git(root, ['status', '-s', '--no-renames', '--', '.']),
      git(root, ['diff', 'HEAD', '-U1', '--no-color', '--no-ext-diff', '--no-textconv', '--relative', '--', '.']).catch(() => git(root, ['diff', '-U1', '--no-color', '--no-ext-diff', '--no-textconv', '--relative', '--', '.'])),
      brushupFiles(root),
    ]);
    const diffs = splitDiff(diffText);
    const files: ChangedFile[] = [];
    for (const line of status.split('\n')) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2).trim() || 'M';
      let file = line.slice(3);
      if (file.includes(' -> ')) file = file.split(' -> ')[1];
      file = file.replace(/^"|"$/g, '');
      if (file.startsWith('.brushup/')) continue; // Brushup's own notes and logs are not the user's change
      const d = diffs.get(file);
      files.push({ file, status: code[0] === '?' ? '?' : code[0], additions: d?.additions ?? 0, deletions: d?.deletions ?? 0, diff: d?.diff ?? '', byBrushup: mine.has(file) });
    }
    files.sort((a, b) => Number(b.byBrushup) - Number(a.byBrushup) || a.file.localeCompare(b.file));
    let size = 0;
    let truncated = false;
    for (const f of files) {
      size += f.diff.length;
      if (size > MAX_BYTES) ((f.diff = ''), (truncated = true));
    }
    return { repo: true, branch: branch.trim(), files, truncated };
  } catch (err) {
    return { repo: false, reason: `Could not read the git changes: ${(err as Error).message.split('\n')[0]}` };
  }
}

/**
 * Which of these files (paths relative to the project) already differ from the last commit, so a warning can say that
 * Brushup's next write will be mixed in with them. A file git doesn't track yet, a project that isn't in git, or any
 * trouble running git all count as "nothing to warn about".
 */
export async function dirtyFiles(root: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
    await git(root, ['rev-parse', '--verify', 'HEAD']); // no commit yet: nothing to be mixed with
  } catch {
    return [];
  }
  const checks = await Promise.all(
    files.map(async (file) => {
      try {
        await git(root, ['ls-files', '--error-unmatch', '--', file]); // exits 1 for a file git doesn't track: nothing to mix with
      } catch {
        return null;
      }
      try {
        await git(root, ['diff', '--quiet', 'HEAD', '--', file]); // exits 0 when it matches the last commit
        return null;
      } catch (err) {
        return (err as { code?: number }).code === 1 ? file : null; // 1 means it differs; any other failure means no warning
      }
    }),
  );
  return checks.filter((f): f is string => f !== null);
}
