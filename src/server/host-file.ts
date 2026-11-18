import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * `.brushup/host.json` tells other local processes (the MCP server) where the running canvas server is.
 * The dev-server modes include a per-run token in `wsUrl`, so the file is readable only by the project's owner
 * in practice (it sits in the project folder next to the code the same user can already edit).
 */
export interface HostInfo {
  mode: 'static' | 'dev';
  /** WebSocket URL to connect to (includes the token in dev-server modes). */
  wsUrl: string;
  pid: number;
}

const fileFor = (root: string) => path.join(root, '.brushup', 'host.json');

export async function writeHostFile(root: string, info: HostInfo) {
  await mkdir(path.dirname(fileFor(root)), { recursive: true });
  await writeFile(fileFor(root), JSON.stringify(info), { mode: 0o600 });
}

/** Remove the file, but only if it still describes this process (another server may have replaced it). */
export async function removeHostFile(root: string, pid = process.pid) {
  const current = await readHostFile(root);
  if (current?.pid === pid) await rm(fileFor(root), { force: true });
}

export async function readHostFile(root: string): Promise<HostInfo | null> {
  try {
    const parsed = JSON.parse(await readFile(fileFor(root), 'utf8'));
    return typeof parsed?.wsUrl === 'string' && typeof parsed?.pid === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
