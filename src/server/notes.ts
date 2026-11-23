import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';

export type NoteKind = 'element' | 'section' | 'component';

/**
 * How to find the element again. Prefers the exact source tags the build
 * stamped on it; the fingerprint (tag, classes, text) is the fallback when
 * source moved, so a note survives refactors and works with no plugin at all.
 */
export interface Anchor {
  tag: string;
  classes: string[];
  /** First ~80 chars of the element's own text. */
  text: string;
  /** `file:line:col` of the host element in source, when the build tagged it. */
  src?: string;
  /** `file:line:col#Name` of the component usage that rendered it. */
  use?: string;
  /** Which of several elements sharing the same source (list items) it was. */
  index: number;
  /** Page the note was made on (location.pathname). */
  page: string;
}

export interface Note {
  id: string;
  kind: NoteKind;
  /** Name for a section/component ("Hero", "Pricing cards"). */
  label: string;
  text: string;
  anchor: Anchor;
  status: 'open' | 'done';
  /** What the agent says it did, set when it marks the note done (max 500 chars). */
  reply?: string;
  createdAt: string;
  updatedAt: string;
}

const KINDS = new Set<NoteKind>(['element', 'section', 'component']);
const clip = (v: unknown, max: number) =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, max);

/** Accepts untrusted input from the canvas and returns a well-formed note, or null. */
export function sanitizeNote(raw: unknown, existing?: Note): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const text = clip(r.text, 4000).trim();
  if (!text) return null;
  const a = (r.anchor ?? existing?.anchor ?? {}) as Record<string, any>;
  if (!a.tag) return null;
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? randomBytes(4).toString('hex'),
    kind: KINDS.has(r.kind) ? r.kind : 'element',
    label: clip(r.label, 120).trim(),
    text,
    anchor: {
      tag: clip(a.tag, 40).toLowerCase(),
      classes: Array.isArray(a.classes) ? a.classes.slice(0, 40).map((c: unknown) => clip(c, 80)) : [],
      text: clip(a.text, 80),
      src: a.src ? clip(a.src, 400) : undefined,
      use: a.use ? clip(a.use, 400) : undefined,
      index: Number.isInteger(a.index) && a.index >= 0 ? a.index : 0,
      page: clip(a.page || '/', 300),
    },
    status: r.status === 'done' ? 'done' : 'open',
    ...(clip(r.reply ?? existing?.reply, 500).trim() ? { reply: clip(r.reply ?? existing?.reply, 500).trim() } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

const code = (s: string) => '`' + s.replace(/`/g, "'") + '`';

/** Where a note is marked done: the one notes file, or its own file when the notes are shared through git. */
const WHERE_DONE = { private: '`.brushup/notes.json`', shared: 'its file in `.brushup/notes/` (named by its id)' } as const;

/** The human- and agent-readable copy of the open notes. */
export function renderNotesMarkdown(notes: Note[], layout: 'private' | 'shared' = 'private'): string {
  // Numbers are positions in the full list, so "note 3" is the same pin on the canvas and in this file.
  const open = notes.map((n, i) => ({ n, num: i + 1 })).filter((x) => x.n.status === 'open');
  const lines = [
    '# Brushup design notes',
    '',
    'Notes the user pinned on the design canvas. Each says where the element lives in source when known.',
    'Make the change each note asks for, keep any manual tweaks listed in `.brushup/edits.jsonl`, and when a note is handled set its `"status"` to `"done"` in ' + WHERE_DONE[layout] + '.',
    '',
  ];
  if (!open.length) lines.push('_No open notes._', '');
  open.forEach(({ n, num }) => {
    const a = n.anchor;
    const kind = n.kind === 'element' ? 'element' : n.kind;
    lines.push(`## ${num}. ${n.label ? `${n.label} (${kind})` : kind}`, '');
    lines.push(n.text.trim(), '');
    const where: string[] = [];
    if (a.use) {
      const [loc, name] = a.use.split('#');
      where.push(`component ${code(`<${name ?? '?'}>`)} used at ${code(loc)}`);
    }
    if (a.src) where.push(`rendered by ${code(a.src)}`);
    if (!where.length) where.push('source location unknown (find it by the text/classes below)');
    lines.push(`- Where: ${where.join('; ')}; page ${code(a.page)}`);
    const cls = a.classes.length ? ` class=${code(a.classes.join(' '))}` : '';
    lines.push(`- Element: ${code(`<${a.tag}>`)}${cls}${a.text ? ` containing "${a.text.replace(/\s+/g, ' ')}"` : ''}`);
    lines.push(`- id: ${code(n.id)}`, '');
  });
  return lines.join('\n');
}

/** Notes in date order, ties broken by id, so every machine that has the same notes numbers them the same way. */
const inOrder = (notes: Note[]) => [...notes].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));

/**
 * Notes live in `.brushup/notes.json` (source of truth) with a readable
 * `.brushup/notes.md` beside it. The file is re-read on every operation and
 * watched, so edits made by the user or an agent (for example marking a note
 * done) show up on the canvas.
 *
 * Shared notes (`brushup init --share-notes`) use the same store with a different layout: one file per note in
 * `.brushup/notes/`, committed to git. Two people adding notes then add two files and never conflict, which a single JSON array
 * could not promise. The layout is detected from the folder on every operation, so no restart is needed. `notes.md` stays a local,
 * git-ignored copy in both.
 */
export class NotesStore {
  private readonly dir: string;
  private readonly file: string;
  /** Shared layout: one file per note. */
  private readonly sharedDir: string;
  /** The notes as last written or announced in the shared layout, so a change we made ourselves isn't announced back. */
  private snapshot = '';
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private own = new Set<string>();

  constructor(readonly root: string) {
    this.dir = path.join(root, '.brushup');
    this.file = path.join(this.dir, 'notes.json');
    this.sharedDir = path.join(this.dir, 'notes');
  }

  /** Whether the notes are shared through git: true once `.brushup/notes/` exists. */
  async shared(): Promise<boolean> {
    try {
      await readdir(this.sharedDir);
      return true;
    } catch {
      return false;
    }
  }

  /** Read untrusted note JSON into well-formed notes, keeping the stored dates (sanitizeNote stamps "now"; reading must not, or `since` could never tell what changed). */
  private clean(parsed: unknown[]): Note[] {
    const stamp = (v: unknown, fallback: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);
    return parsed
      .map((n) => {
        const clean = sanitizeNote(n, n as Note);
        const dates = n as { createdAt?: unknown; updatedAt?: unknown };
        return clean && { ...clean, createdAt: stamp(dates?.createdAt, clean.createdAt), updatedAt: stamp(dates?.updatedAt, clean.updatedAt) };
      })
      .filter((n): n is Note => !!n && !!n.id);
  }

  async list(): Promise<Note[]> {
    if (await this.shared()) {
      const files = (await readdir(this.sharedDir).catch(() => [] as string[])).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
      const parsed = await Promise.all(
        files.map(async (f) => {
          try {
            return JSON.parse(await readFile(path.join(this.sharedDir, f), 'utf8')) as unknown;
          } catch {
            return null; // unreadable or a merge conflict in the file: skip it, keep the rest
          }
        }),
      );
      return inOrder(this.clean(parsed.filter((n) => n && typeof n === 'object')));
    }
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(parsed) ? this.clean(parsed) : [];
    } catch {
      return [];
    }
  }

  private async persist(notes: Note[]) {
    await mkdir(this.dir, { recursive: true });
    if (await this.shared()) return this.persistShared(notes);
    const json = JSON.stringify(notes, null, 2) + '\n';
    this.own.add(json);
    const write = async (name: string, content: string) => {
      const tmp = path.join(this.dir, `.${name}.${process.pid}.tmp`);
      await writeFile(tmp, content);
      await rename(tmp, path.join(this.dir, name));
    };
    await write('notes.json', json);
    await write('notes.md', renderNotesMarkdown(notes));
  }

  /** One file per note: only the notes that changed are rewritten, and a removed note's file is deleted. */
  private async persistShared(notes: Note[]) {
    const ordered = inOrder(notes);
    this.snapshot = JSON.stringify(ordered);
    const keep = new Set<string>();
    for (const n of ordered) {
      const name = `${n.id}.json`;
      keep.add(name);
      const content = JSON.stringify(n, null, 2) + '\n';
      const file = path.join(this.sharedDir, name);
      if ((await readFile(file, 'utf8').catch(() => null)) === content) continue;
      const tmp = path.join(this.sharedDir, `.${n.id}.${process.pid}.tmp`);
      await writeFile(tmp, content);
      await rename(tmp, file);
    }
    for (const f of await readdir(this.sharedDir).catch(() => [] as string[])) if (f.endsWith('.json') && !f.startsWith('.') && !keep.has(f)) await rm(path.join(this.sharedDir, f), { force: true });
    await writeFile(path.join(this.dir, 'notes.md'), renderNotesMarkdown(ordered, 'shared'));
  }

  /** Refresh the local, git-ignored `notes.md` from the shared notes, so a note that arrived with `git pull` is there for an agent reading the file. */
  private async syncMarkdown(list: Note[]) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, 'notes.md'), renderNotesMarkdown(list, 'shared')).catch(() => {});
  }

  /** Switch to the shared layout: one file per note in `.brushup/notes/`, moving any notes from `notes.json` across. Safe to repeat. */
  async share(): Promise<{ moved: number }> {
    if (await this.shared()) return { moved: 0 };
    const existing = await this.list();
    await mkdir(this.sharedDir, { recursive: true });
    await this.persistShared(existing);
    if (existing.length) await rm(this.file, { force: true }); // the notes live in their own files now, and two copies would drift
    return { moved: existing.length };
  }

  async save(raw: unknown): Promise<Note[]> {
    const notes = await this.list();
    const id = (raw as { id?: string } | null)?.id;
    const existing = id ? notes.find((n) => n.id === id) : undefined;
    const note = sanitizeNote(raw, existing);
    if (!note) throw new Error('A note needs some text and an element.');
    const next = existing ? notes.map((n) => (n.id === note.id ? note : n)) : [...notes, note];
    await this.persist(next);
    return next;
  }

  async remove(id: string): Promise<Note[]> {
    const next = (await this.list()).filter((n) => n.id !== id);
    await this.persist(next);
    return next;
  }

  /** Calls `onChange` when notes.json changes on disk by someone else. */
  watch(onChange: (notes: Note[]) => void) {
    if (this.watcher) return;
    mkdirSync(this.dir, { recursive: true }); // a watch on a folder that doesn't exist yet never fires, even once it does
    // Both layouts are watched: the notes file, and the shared folder (the dot-prefixed .tmp files are ones we write and rename).
    this.watcher = chokidar.watch([this.file, this.sharedDir], { ignoreInitial: true, ignored: /[\\/]\.[^\\/]*\.tmp$/ });
    const changed = async () => {
      if (await this.shared()) {
        const list = await this.list();
        const now = JSON.stringify(list);
        if (now === this.snapshot) return; // our own write, or nothing that matters changed
        this.snapshot = now;
        await this.syncMarkdown(list);
        return onChange(list);
      }
      try {
        const content = await readFile(this.file, 'utf8');
        if (this.own.delete(content)) return; // our own write
      } catch {
        /* deleted: fall through to an empty list */
      }
      onChange(await this.list());
    };
    // Notes pulled in while the server was off are in the folder but not in notes.md yet.
    void this.shared().then(async (shared) => {
      if (!shared) return;
      const list = await this.list();
      this.snapshot = JSON.stringify(list);
      await this.syncMarkdown(list);
    });
    this.watcher.on('add', changed).on('change', changed).on('unlink', changed);
  }

  close() {
    return this.watcher?.close();
  }
}
