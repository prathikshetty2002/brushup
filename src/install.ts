import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { VERSION } from './version';

export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';

async function has(file: string) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

/** Which package manager the project uses, from its lock file (npm when there is none). */
export async function detectManager(root: string): Promise<Manager> {
  if (await has(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await has(path.join(root, 'yarn.lock'))) return 'yarn';
  if ((await has(path.join(root, 'bun.lockb'))) || (await has(path.join(root, 'bun.lock')))) return 'bun';
  return 'npm';
}

/** Whether the project lists brushup already. 'none' means there is no package.json to add it to. */
export async function brushupDependency(root: string): Promise<'present' | 'missing' | 'none'> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return 'none';
  }
  return pkg.dependencies?.brushup || pkg.devDependencies?.brushup ? 'present' : 'missing';
}

/** The command that adds brushup as a dev dependency, pinned to the version that is running so the two always match. */
export function installCommand(manager: Manager, version = VERSION): { command: string; args: string[] } {
  const spec = version === 'unknown' ? 'brushup' : `brushup@${version}`;
  if (manager === 'npm') return { command: 'npm', args: ['install', '-D', spec] };
  if (manager === 'bun') return { command: 'bun', args: ['add', '-d', spec] };
  return { command: manager, args: ['add', '-D', spec] };
}

export type Runner = (command: string, args: string[], cwd: string) => Promise<void>;

/** Runs the package manager with fixed arguments (no shell string), showing its own output. */
export const run: Runner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    // On Windows the package managers are .cmd files, which only start through a shell; the arguments are fixed, not user input.
    const child = execFile(command, args, { cwd, shell: process.platform === 'win32' }, (err) => (err ? reject(err) : resolve()));
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });

export type InstallResult = { status: 'installed'; manager: Manager } | { status: 'present' } | { status: 'no-package-json' } | { status: 'failed'; manager: Manager; command: string; message: string };

/** Add brushup to the project when it isn't listed yet, so `npx brushup init` is the whole setup. */
export async function installSelf(root: string, runner: Runner = run): Promise<InstallResult> {
  const state = await brushupDependency(root);
  if (state === 'present') return { status: 'present' };
  if (state === 'none') return { status: 'no-package-json' };
  const manager = await detectManager(root);
  const { command, args } = installCommand(manager);
  try {
    await runner(command, args, root);
    return { status: 'installed', manager };
  } catch (err) {
    return { status: 'failed', manager, command: [command, ...args].join(' '), message: (err as Error).message.split('\n')[0] };
  }
}
