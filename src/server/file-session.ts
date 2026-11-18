import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { EditError, type Edit, type Target } from '../core/edit-types';
import type { Files } from '../core/patch';

export type { Target };
export const sha = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);

export interface EditOutcome {
  files: string[];
  target?: Target;
  /** Something the user should know about how the edit was written (shown on the canvas). */
  warning?: string;
}

export interface Selection {
  id: string;
  tag: string;
}

interface Snapshot {
  /** path -> contents before / after the edit */
  before: Files;
  after: Files;
}

/**
 * Shared machinery for every kind of project: files on disk are the source of
 * truth, each edit re-reads them, patches in memory, and writes the result once.
 * Subclasses say which files an edit needs and how to patch them.
 */
export abstract class FileSession {
  abstract readonly root: string;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Hashes of content we just wrote, so the watcher can ignore our own echo. */
  private ownWrites = new Map<string, Set<string>>();

  protected abstract loadFor(edit: Edit): Promise<Files>;
  /** `before` is every file as it was read from disk for this change, untouched by earlier edits in the same batch. */
  protected abstract transform(files: Files, edit: Edit, before: Files): { files: Files; target?: Target; warning?: string };
  /** Called after a change has been written (an edit, undo or redo): `from` is what was on disk, `to` what is there now. */
  protected written(_from: Files, _to: Files): void {}
  /** Describe the selected element for `.brushup/selection.json`, or null if it can no longer be found. */
  protected abstract describe(sel: Selection): Promise<object | null>;
  /**
   * The order a batch is applied in. A patch can move later text on the same line (JSX columns), so a mode whose
   * references are positions applies them last-to-first; the default keeps the order given.
   */
  protected order(edits: Edit[]): Edit[] {
    return edits;
  }
  /** Throw an EditError if the canvas was rendered from different source than what's on disk. */
  protected checkBase(_files: Files, _hash: string): void {}

  /** Turn the canvas's element reference into `file:line` for notes, when the mode can. */
  async locate(_ref: string): Promise<string | undefined> {
    return undefined;
  }

  /** Hash the canvas must send with edits; empty when the mode doesn't need one. */
  async hash(): Promise<string> {
    return '';
  }

  /** Apply an edit made on the canvas. */
  async edit(edit: Edit, baseHash = ''): Promise<EditOutcome> {
    return this.editMany([edit], baseHash);
  }

  /**
   * Apply several edits as one change: read the files once, patch in memory, write once, and record a single
   * undo step (so a multi-selection edit is one Ctrl+Z).
   */
  async editMany(edits: Edit[], baseHash = ''): Promise<EditOutcome> {
    if (!edits.length) return { files: [] };
    if (edits.length > 200) throw new EditError('Too many edits in one change.');
    const ordered = this.order(edits);
    const before: Files = {};
    for (const edit of ordered) Object.assign(before, await this.loadFor(edit));
    this.checkBase(before, baseHash);
    let after = before;
    let target: Target | undefined;
    const warnings = new Set<string>();
    for (const edit of ordered) {
      const out = this.transform(after, edit, before);
      after = out.files;
      target = out.target ?? target;
      if (out.warning) warnings.add(out.warning);
    }
    const warning = warnings.size ? [...warnings].join('; ') : undefined;
    const changed = diff(before, after);
    if (!Object.keys(changed).length) return { files: [], target, warning };
    await this.write(changed);
    this.written(pick(before, changed), changed);
    this.undoStack.push({ before: pick(before, changed), after: changed });
    this.undoStack = this.undoStack.slice(-100);
    this.redoStack = [];
    const files = Object.keys(changed);
    const where = files.map((f) => path.relative(this.root, f));
    // ident/hints are for locating and writing the edit; the agent-facing log only needs what the user did.
    const logged = ordered.map(({ ident, hints, ver, fallbackVer, stale, ...rest }: Edit & { ident?: unknown; hints?: unknown; ver?: unknown; fallbackVer?: unknown; stale?: unknown }) => rest);
    await this.log(logged.length === 1 ? { edit: logged[0], files: where } : { edits: logged, files: where });
    return { files, target, warning };
  }

  async undo(): Promise<EditOutcome> {
    return this.step(this.undoStack, this.redoStack, 'before');
  }

  async redo(): Promise<EditOutcome> {
    return this.step(this.redoStack, this.undoStack, 'after');
  }

  /** Move one snapshot from `source` to `target`, writing its `to` side to disk. */
  private async step(source: Snapshot[], target: Snapshot[], to: 'before' | 'after'): Promise<EditOutcome> {
    const snap = source.pop();
    if (!snap) throw new EditError(to === 'before' ? 'Nothing to undo' : 'Nothing to redo');
    const expected = to === 'before' ? snap.after : snap.before;
    const current = await Promise.all(Object.keys(expected).map((f) => readFile(f, 'utf8').catch(() => null)));
    // Don't clobber edits the agent made after ours.
    if (Object.values(expected).some((content, i) => current[i] !== content)) {
      source.push(snap);
      throw new EditError('The source changed since that edit, so it can no longer be reverted safely.');
    }
    await this.write(snap[to]);
    this.written(expected, snap[to]);
    target.push(snap);
    const files = Object.keys(snap[to]);
    await this.log({ [to === 'before' ? 'undo' : 'redo']: files.map((f) => path.relative(this.root, f)) });
    return { files };
  }

  private async write(changed: Files) {
    for (const [file, content] of Object.entries(changed)) {
      const set = this.ownWrites.get(file) ?? new Set<string>();
      set.add(sha(content));
      this.ownWrites.set(file, set);
      const tmp = path.join(path.dirname(file), `.brushup-${process.pid}-${path.basename(file)}.tmp`);
      await writeFile(tmp, content);
      await rename(tmp, file);
    }
  }

  /** True (once) if `content` is something we wrote ourselves. */
  consumeOwnWrite(file: string, content: string): boolean {
    const set = this.ownWrites.get(file);
    const h = sha(content);
    if (!set?.has(h)) return false;
    set.delete(h);
    return true;
  }

  /** What the agent can read to learn what the user did and what is selected. */
  private async log(entry: object) {
    const dir = path.join(this.root, '.brushup');
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, 'edits.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  }

  async setSelection(sel: Selection | null) {
    const dir = path.join(this.root, '.brushup');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'selection.json');
    if (!sel) return writeFile(file, 'null\n');
    const info = await this.describe(sel);
    if (info) await writeFile(file, JSON.stringify(info, null, 2) + '\n');
  }
}

function diff(before: Files, after: Files): Files {
  const out: Files = {};
  for (const f of Object.keys(after)) if (after[f] !== before[f]) out[f] = after[f];
  return out;
}

function pick(files: Files, keys: Files): Files {
  return Object.fromEntries(Object.keys(keys).map((k) => [k, files[k]]));
}
