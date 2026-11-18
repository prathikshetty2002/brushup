import { readFile } from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FileSession } from './file-session';

const IGNORED = /(^|[\\/])(node_modules|\.git|\.ascend|dist|build|\.next|\.vite|\.turbo)([\\/]|$)|\.ascend-[^\\/]*\.tmp$/;

/**
 * Watches the project folder and reports files changed by someone else (the
 * agent, the user's editor). Writes Ascend made itself are filtered out via
 * the content-hash record on Project.
 */
export function watchProject(project: FileSession, onChange: (files: string[]) => void) {
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    const files = [...pending];
    pending = new Set();
    timer = undefined;
    if (files.length) onChange(files);
  };

  const touched = async (file: string) => {
    try {
      const content = await readFile(file, 'utf8');
      if (project.consumeOwnWrite(file, content)) return;
    } catch {
      /* binary or deleted: treat as an external change */
    }
    pending.add(path.relative(project.root, file));
    clearTimeout(timer);
    timer = setTimeout(flush, 40);
  };

  const watcher = chokidar.watch(project.root, { ignored: (p: string) => IGNORED.test(path.relative(project.root, p)), ignoreInitial: true });
  watcher.on('add', touched).on('change', touched).on('unlink', touched);
  return () => watcher.close();
}
