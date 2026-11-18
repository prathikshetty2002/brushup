import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EditError, type Edit } from '../core/edit-types';
import { parseSrc } from '../core/jsx';
import { applyJsxEdit, describeElement, TextNotHere } from '../core/jsx-patch';
import type { Scale } from '../core/tailwind';
import type { Files } from '../core/patch';
import { FileSession, type Selection, type Target } from './file-session';

export interface DevOptions {
  /**
   * How style edits are written into JSX:
   *  - 'tailwind': as arbitrary-value utility classes (`ml-[38px]`)
   *  - 'inline':   as a `style={{ ... }}` prop
   *  - 'auto':     Tailwind if the project depends on it, else inline
   */
  style?: 'auto' | 'inline' | 'tailwind';
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.brushup', 'dist', 'build', '.next', '.vite', '.turbo', 'coverage']);

function dependsOnTailwind(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => d === 'tailwindcss' || d.startsWith('@tailwindcss/'));
  } catch {
    return false;
  }
}

/** Which Tailwind the project has: the installed version if it can be read, else the declared range, else v3. */
export function tailwindScale(root: string): Scale {
  const major = (v: unknown) => /(\d+)/.exec(String(v ?? ''))?.[1];
  try {
    const installed = JSON.parse(readFileSync(path.join(root, 'node_modules/tailwindcss/package.json'), 'utf8')).version;
    if (major(installed)) return Number(major(installed)) >= 4 ? 'v4' : 'v3';
  } catch {
    /* not installed here: fall back to package.json */
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    if (Object.keys(deps).some((d) => d.startsWith('@tailwindcss/') && d !== '@tailwindcss/typography' && d !== '@tailwindcss/forms')) return 'v4';
    return Number(major(deps.tailwindcss) ?? 3) >= 4 ? 'v4' : 'v3';
  } catch {
    return 'v3';
  }
}

/**
 * A React-style app served by a dev server. Elements are addressed by the
 * `file:line:col` the Vite plugin stamped on them, and edits patch the JSX.
 */
export class DevProject extends FileSession {
  private readonly tailwind: boolean;
  private readonly scale: Scale;

  constructor(
    readonly root: string,
    options: DevOptions = {},
  ) {
    super();
    const mode = options.style ?? 'auto';
    this.tailwind = mode === 'tailwind' || (mode === 'auto' && dependsOnTailwind(root));
    this.scale = tailwindScale(root);
  }

  /** Where a `file:line:col` reference points, refusing anything outside the project or not JSX/TSX. */
  private resolve(id: string) {
    const loc = parseSrc(id);
    const file = loc && path.resolve(this.root, loc.file);
    if (!loc || !file || !/\.[jt]sx$/.test(file) || !file.startsWith(this.root + path.sep)) throw new EditError(`Bad element reference ${id}`);
    return { ...loc, file };
  }

  private async cssFiles(dir = this.root, out: string[] = []): Promise<string[]> {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= 500 || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await this.cssFiles(full, out);
      else if (entry.name.endsWith('.css')) out.push(full);
    }
    return out;
  }

  /** Last element in the file first, so patching one never shifts the line/column of one still to be patched. */
  protected override order(edits: Edit[]): Edit[] {
    const at = (e: Edit) => {
      const loc = parseSrc(e.id);
      return { file: loc?.file ?? '', line: loc?.line ?? 0, col: loc?.col ?? 0 };
    };
    return [...edits].sort((a, b) => {
      const x = at(a);
      const y = at(b);
      return x.file === y.file ? y.line - x.line || y.col - x.col : x.file < y.file ? -1 : 1;
    });
  }

  protected async loadFor(edit: Edit): Promise<Files> {
    const read = (file: string) =>
      readFile(file, 'utf8').catch(() => {
        throw new EditError(`Cannot read ${path.relative(this.root, file)}`);
      });
    const { file } = this.resolve(edit.id);
    const files: Files = { [file]: await read(file) };
    // A text edit may fall back to the host element's own file (a component usage that doesn't hold the text).
    if (edit.kind === 'text' && edit.fallback) {
      const fallback = this.resolve(edit.fallback).file;
      if (!(fallback in files)) files[fallback] = await read(fallback);
    }
    if (edit.kind === 'style' && edit.scope === 'rule') {
      for (const css of await this.cssFiles()) files[css] = await readFile(css, 'utf8');
    }
    return files;
  }

  protected transform(files: Files, edit: Edit): { files: Files; target?: Target; warning?: string } {
    const opts = { tailwind: this.tailwind, scale: this.scale };
    try {
      return applyJsxEdit(files, this.resolve(edit.id).file, edit, opts);
    } catch (err) {
      // Text written at a component's usage site (`<Button>Save</Button>`) is preferred; if the usage doesn't
      // hold it (label comes from a prop or child element), try the element the component renders.
      if (edit.kind === 'text' && edit.fallback && err instanceof TextNotHere) {
        try {
          return applyJsxEdit(files, this.resolve(edit.fallback).file, { ...edit, id: edit.fallback, fallback: undefined }, opts);
        } catch (second) {
          // Neither place holds the text: the first error says why (the usage's text is an expression).
          if (second instanceof TextNotHere) throw err;
          throw second;
        }
      }
      throw err;
    }
  }

  protected async describe(sel: Selection) {
    const { file, line, col } = this.resolve(sel.id);
    const info = describeElement(await readFile(file, 'utf8'), file, sel.id, sel.tag);
    return info && { file: path.relative(this.root, file), line, col, ...info };
  }
}
