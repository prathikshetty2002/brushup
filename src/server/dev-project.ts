import { readdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EditError, type Edit, type Staleness } from '../core/edit-types';
import { fileHash, parseSrc, parseVer } from '../core/jsx';
import { applyJsxEdit, describeElement, TextNotHere } from '../core/jsx-patch';
import type { Scale } from '../core/tailwind';
import { needleOf, placesIn, SKIPPED, TEXT_FILES, writePlace } from '../core/text-search';
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
  /**
   * When the file changed under the page (the agent edited it), find the element again by what it says in the source
   * and refuse if that's ambiguous. `false` keeps the older, looser behaviour: trust the recorded position.
   */
  strict?: boolean;
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
  private readonly strict: boolean;
  /** Per file: the hashes of every version we produced in an unbroken run of our own writes, and the latest. */
  private readonly own = new Map<string, { hashes: Set<string>; last: string }>();

  readonly root: string;

  constructor(root: string, options: DevOptions = {}) {
    super();
    // Vite reports its root with forward slashes (`C:/proj`) on Windows; every path built from it later uses the
    // platform separator, so compare against one normalised spelling or no edit is accepted.
    this.root = path.resolve(root);
    root = this.root;
    const mode = options.style ?? 'auto';
    this.tailwind = mode === 'tailwind' || (mode === 'auto' && dependsOnTailwind(root));
    this.scale = tailwindScale(root);
    this.strict = options.strict !== false;
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
    // A text edit the element's own source can't take may be found elsewhere by its value: load the files that mention it.
    if (edit.kind === 'text' && edit.was && edit.was.trim().length >= 3) {
      let refused = false;
      try {
        this.transform(files, edit, files);
      } catch (err) {
        refused = err instanceof TextNotHere;
      }
      if (refused) await this.addTextCandidates(files, edit.was);
    }
    return files;
  }

  protected override written(from: Files, to: Files) {
    for (const file of Object.keys(to)) {
      const before = fileHash(from[file] ?? '');
      const after = fileHash(to[file]);
      const run = this.own.get(file);
      if (run && run.last === before) (run.hashes.add(after), (run.last = after));
      else this.own.set(file, { hashes: new Set([before, after]), last: after }); // someone else edited in between: start over
    }
  }

  /**
   * Did anyone but us change `file` since the page was rendered? The tag carries the file's hash from then:
   * equal means nothing moved; a hash from our own unbroken run of writes means only we changed it (positions may lag
   * by one HMR round, which the loose position check tolerates); anything else is an outside edit.
   */
  private staleness(token: string | undefined, file: string, before: Files): Staleness | undefined {
    const ver = parseVer(token);
    if (!ver || !this.strict) return undefined;
    const current = fileHash(before[file] ?? '');
    if (ver.file === current) return 'none';
    const run = this.own.get(file);
    return run && run.last === current && run.hashes.has(ver.file) ? 'own' : 'external';
  }

  protected transform(files: Files, edit: Edit, before: Files): { files: Files; target?: Target; warning?: string } {
    try {
      return this.structured(files, edit, before);
    } catch (err) {
      // The text isn't written at the element (props, state, a filtered list, a translation file): the text on the
      // page is the key, so look for the one string in the project that says exactly that.
      if (edit.kind === 'text' && err instanceof TextNotHere) {
        const found = this.byValue(files, edit);
        if (found) return found;
      }
      throw err;
    }
  }

  /** The one place in the loaded files that writes `edit.was`, edited; null if nothing does; refuses if several do. */
  private byValue(files: Files, edit: Edit & { kind: 'text' }): { files: Files; target: Target; warning: string } | null {
    const was = edit.was?.replace(/\s+/g, ' ').trim() ?? '';
    if (was.length < 3) return null;
    const places = Object.keys(files).flatMap((f) => (TEXT_FILES.test(f) && !SKIPPED.test(path.relative(this.root, f)) ? placesIn(files[f], f, was) : []));
    if (!places.length) return null;
    const where = (p: (typeof places)[number]) => `${path.relative(this.root, p.file).split(path.sep).join('/')}:${p.line}`;
    if (places.length > 1) {
      throw new TextNotHere(`"${was.slice(0, 60)}" is written in ${places.length} places (${places.slice(0, 5).map(where).join(', ')}${places.length > 5 ? ', …' : ''}), so Brushup can't tell which one this is.`);
    }
    const [at] = places;
    return {
      files: { ...files, [at.file]: writePlace(files[at.file], at, edit.text) },
      target: 'text',
      warning: `Written where it's defined (${where(at)}); everything that uses that text changes too`,
    };
  }

  /** Project files that write `text`, added to `files` so the value search can see them. */
  private async addTextCandidates(files: Files, text: string) {
    const needle = needleOf(text);
    if (!needle) return;
    let scanned = 0;
    let found = 0;
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (found >= 40 || scanned >= 4000 || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (SKIPPED.test(path.relative(this.root, full))) continue;
        if (entry.isDirectory()) await visit(full);
        else if (TEXT_FILES.test(entry.name) && !(full in files)) {
          scanned++;
          if ((await stat(full).catch(() => null))?.size! > 400_000) continue;
          const code = await readFile(full, 'utf8').catch(() => '');
          if (code.includes(needle)) (files[full] = code), found++;
        }
      }
    };
    await visit(this.root);
  }

  private structured(files: Files, edit: Edit, before: Files): { files: Files; target?: Target; warning?: string } {
    const opts = { tailwind: this.tailwind, scale: this.scale };
    const file = this.resolve(edit.id).file;
    // Always set from the server's own comparison: a client can't claim the file is unchanged.
    const checked = { ...edit, stale: this.staleness(edit.ver, file, before) } as Edit;
    try {
      return applyJsxEdit(files, file, checked, opts);
    } catch (err) {
      // Text written at a component's usage site (`<Button>Save</Button>`) is preferred; if the usage doesn't
      // hold it (label comes from a prop or child element), try the element the component renders.
      if (edit.kind === 'text' && edit.fallback && err instanceof TextNotHere) {
        const hostFile = this.resolve(edit.fallback).file;
        try {
          return applyJsxEdit(files, hostFile, { ...edit, id: edit.fallback, ver: edit.fallbackVer, fallback: undefined, fallbackVer: undefined, stale: this.staleness(edit.fallbackVer, hostFile, before) }, opts);
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
