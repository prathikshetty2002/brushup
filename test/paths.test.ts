import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectRelative } from '../src/core/paths';

describe('projectRelative', () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'brushup-paths-')));
    mkdirSync(path.join(dir, 'real/src'), { recursive: true });
    writeFileSync(path.join(dir, 'real/src/App.tsx'), 'x');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is the path below the root with forward slashes', () => {
    expect(projectRelative(path.join(dir, 'real'), path.join(dir, 'real/src/App.tsx'))).toBe('src/App.tsx');
  });

  it('is null for files outside the root, the root itself, and files that do not exist', () => {
    expect(projectRelative(path.join(dir, 'real/src'), path.join(dir, 'real/other.tsx'))).toBeNull();
    expect(projectRelative(path.join(dir, 'real'), path.join(dir, 'real'))).toBeNull();
    expect(projectRelative(path.join(dir, 'real/src'), path.join(dir, 'elsewhere/x.tsx'))).toBeNull();
  });

  it('still finds the file when the root and the file are spelled differently (symlink, 8.3 name, drive-letter case)', () => {
    const alias = path.join(dir, 'alias');
    try {
      symlinkSync(path.join(dir, 'real'), alias, 'junction');
    } catch {
      return; // no permission to link on this machine: the plain cases above still ran
    }
    // the bundler reports the file by its real path while the root is the alias, and the other way round
    expect(projectRelative(alias, path.join(dir, 'real/src/App.tsx'))).toBe('src/App.tsx');
    expect(projectRelative(path.join(dir, 'real'), path.join(alias, 'src/App.tsx'))).toBe('src/App.tsx');
    // but an alias of something else is still outside
    expect(projectRelative(path.join(alias, 'src'), path.join(dir, 'real/other.tsx'))).toBeNull();
  });
});
