import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brushupDependency, detectManager, installCommand, installSelf } from '../src/install';

const project = async (files: Record<string, string>) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-install-'));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
};

describe('detectManager', () => {
  it('reads the lock file, and falls back to npm', async () => {
    expect(await detectManager(await project({ 'pnpm-lock.yaml': '' }))).toBe('pnpm');
    expect(await detectManager(await project({ 'yarn.lock': '' }))).toBe('yarn');
    expect(await detectManager(await project({ 'bun.lockb': '' }))).toBe('bun');
    expect(await detectManager(await project({ 'bun.lock': '' }))).toBe('bun');
    expect(await detectManager(await project({ 'package-lock.json': '{}' }))).toBe('npm');
    expect(await detectManager(await project({}))).toBe('npm');
  });
});

describe('installCommand', () => {
  it('adds brushup as a dev dependency, pinned to the running version', () => {
    expect(installCommand('npm', '0.1.9')).toEqual({ command: 'npm', args: ['install', '-D', 'brushup@0.1.9'] });
    expect(installCommand('pnpm', '0.1.9')).toEqual({ command: 'pnpm', args: ['add', '-D', 'brushup@0.1.9'] });
    expect(installCommand('yarn', '0.1.9').args).toEqual(['add', '-D', 'brushup@0.1.9']);
    expect(installCommand('bun', '0.1.9').args).toEqual(['add', '-d', 'brushup@0.1.9']);
    expect(installCommand('npm', 'unknown').args).toEqual(['install', '-D', 'brushup']);
  });
});

describe('installSelf', () => {
  const pkg = (extra: object) => JSON.stringify({ name: 'app', ...extra });

  it('installs when the project does not list brushup, with the project\'s own package manager', async () => {
    const dir = await project({ 'package.json': pkg({}), 'pnpm-lock.yaml': '' });
    const calls: string[][] = [];
    const r = await installSelf(dir, async (command, args, cwd) => void calls.push([command, ...args, cwd]));
    expect(r).toEqual({ status: 'installed', manager: 'pnpm' });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('pnpm');
    expect(calls[0].at(-1)).toBe(dir);
  });

  it('does nothing when brushup is already a dependency or devDependency', async () => {
    for (const where of ['dependencies', 'devDependencies']) {
      const dir = await project({ 'package.json': pkg({ [where]: { brushup: '^0.1.8' } }) });
      let ran = false;
      expect(await installSelf(dir, async () => void (ran = true))).toEqual({ status: 'present' });
      expect(ran).toBe(false);
    }
  });

  it('leaves a folder with no package.json alone', async () => {
    const dir = await project({});
    let ran = false;
    expect(await brushupDependency(dir)).toBe('none');
    expect(await installSelf(dir, async () => void (ran = true))).toEqual({ status: 'no-package-json' });
    expect(ran).toBe(false);
  });

  it('reports a failed install with the command to run by hand, without throwing', async () => {
    const dir = await project({ 'package.json': pkg({}) });
    const r = await installSelf(dir, async () => {
      throw new Error('network down\nmore detail');
    });
    expect(r).toMatchObject({ status: 'failed', manager: 'npm', message: 'network down' });
    expect((r as { command: string }).command).toMatch(/^npm install -D brushup/);
  });
});
