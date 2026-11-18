import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject } from '../src/init';

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'ascend-init-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('ascend init', () => {
  it('creates CLAUDE.md when missing', async () => {
    expect((await initProject(dir)).claudeMd).toBe('created');
    expect(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toContain('.ascend/notes.md');
  });

  it('appends to an existing CLAUDE.md without touching the rest, and is idempotent', async () => {
    await writeFile(path.join(dir, 'CLAUDE.md'), '# My project\n\nUse pnpm.\n');
    expect((await initProject(dir)).claudeMd).toBe('updated');
    const once = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(once.startsWith('# My project\n\nUse pnpm.\n')).toBe(true);
    expect((await initProject(dir)).claudeMd).toBe('unchanged');
    expect(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(once);
    expect(once.match(/ascend:start/g)).toHaveLength(1);
  });

  it('adds .ascend/ to an existing .gitignore only once', async () => {
    await writeFile(path.join(dir, '.gitignore'), 'node_modules');
    expect((await initProject(dir)).gitignore).toBe('updated');
    expect((await initProject(dir)).gitignore).toBe('unchanged');
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.ascend/\n');
  });

  it('does not create a .gitignore', async () => {
    expect((await initProject(dir)).gitignore).toBe('absent');
  });
});

describe('ascend init --mcp', () => {
  it('creates .mcp.json with the server', async () => {
    expect((await initProject(dir, { mcp: true })).mcp).toBe('created');
    expect(JSON.parse(await readFile(path.join(dir, '.mcp.json'), 'utf8'))).toEqual({ mcpServers: { ascend: { command: 'npx', args: ['ascend-mcp'] } } });
  });

  it('adds beside existing servers without touching them, and is idempotent', async () => {
    await writeFile(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } }, extra: 1 }));
    expect((await initProject(dir, { mcp: true })).mcp).toBe('updated');
    const config = JSON.parse(await readFile(path.join(dir, '.mcp.json'), 'utf8'));
    expect(config.mcpServers.other).toEqual({ command: 'x' });
    expect(config.extra).toBe(1);
    expect(config.mcpServers.ascend.args).toEqual(['ascend-mcp']);
    expect((await initProject(dir, { mcp: true })).mcp).toBe('unchanged');
  });

  it('leaves an unparseable .mcp.json alone', async () => {
    await writeFile(path.join(dir, '.mcp.json'), '{ not json');
    expect((await initProject(dir, { mcp: true })).mcp).toBe('invalid-json');
    expect(await readFile(path.join(dir, '.mcp.json'), 'utf8')).toBe('{ not json');
  });

  it('is off unless asked for', async () => {
    expect((await initProject(dir)).mcp).toBeUndefined();
  });
});
