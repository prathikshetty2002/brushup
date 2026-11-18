import { realpathSync } from 'node:fs';
import path from 'node:path';

const inside = (rel: string) => rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);

/**
 * `file` relative to `root` with forward slashes, or null if it is outside the project. The same folder can be
 * spelled two ways (a Windows 8.3 short name like `RUNNER~1`, a different drive-letter case, a symlink or junction),
 * and a bundler may report one spelling for the root and another for a file; if the plain comparison says "outside",
 * compare the real paths before believing it.
 */
export function projectRelative(root: string, file: string): string | null {
  let rel = path.relative(root, file);
  if (!inside(rel)) {
    try {
      rel = path.relative(realpathSync.native(root), realpathSync.native(file));
    } catch {
      return null;
    }
    if (!inside(rel)) return null;
  }
  return rel.split(path.sep).join('/');
}
