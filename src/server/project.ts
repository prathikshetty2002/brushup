import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EditError, type Edit } from '../core/edit-types';
import { annotate, mapHtml } from '../core/html-map';
import { applyEdit, linkedStylesheets, type Files } from '../core/patch';
import { FileSession, sha, type Selection, type Target } from './file-session';

export { sha };
export type { Selection };

/** A plain HTML page (plus the local stylesheets it links). */
export class Project extends FileSession {
  readonly root: string;

  constructor(readonly entry: string) {
    super();
    this.root = path.dirname(entry);
  }

  /** A static page keeps its images beside it, and refers to them by name. */
  protected assets() {
    return { dir: this.root, urlFor: (file: string) => file };
  }

  protected async loadFor(): Promise<Files> {
    const html = await readFile(this.entry, 'utf8');
    const files: Files = { [this.entry]: html };
    for (const css of linkedStylesheets(mapHtml(html), this.root)) {
      try {
        files[css] = await readFile(css, 'utf8');
      } catch {
        /* missing stylesheet: leave it out, rules in it just can't be edited */
      }
    }
    return files;
  }

  protected checkBase(files: Files, baseHash: string) {
    if (sha(files[this.entry]) !== baseHash) {
      throw new EditError('The source changed since the canvas last rendered it. Try again.');
    }
  }

  protected transform(files: Files, edit: Edit, _before: Files): { files: Files; target?: Target } {
    return { files: applyEdit(files, this.entry, edit), target: edit.kind === 'text' ? 'text' : undefined };
  }

  override async hash(): Promise<string> {
    return sha(await readFile(this.entry, 'utf8'));
  }

  /** The page as the browser should see it: ids injected, plus the hash edits must be based on. */
  async render(): Promise<{ html: string; hash: string }> {
    const source = await readFile(this.entry, 'utf8');
    return { html: annotate(mapHtml(source)), hash: sha(source) };
  }

  override async locate(id: string) {
    const el = mapHtml(await readFile(this.entry, 'utf8')).byId.get(id);
    return el ? `${path.relative(this.root, this.entry)}:${el.line}` : undefined;
  }

  protected async describe(sel: Selection) {
    const doc = mapHtml(await readFile(this.entry, 'utf8'));
    const el = doc.byId.get(sel.id);
    if (!el) return null;
    const text = (el.node.childNodes as { nodeName: string; value?: string }[])
      .filter((n) => n.nodeName === '#text')
      .map((n) => n.value)
      .join('')
      .trim()
      .slice(0, 120);
    return { file: path.relative(this.root, this.entry), line: el.line, tag: el.tag, id: el.attrs.id ?? null, classes: el.classes, text };
  }
}
