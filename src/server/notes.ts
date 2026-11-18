import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

const code = (s: string) => '`' + s.replace(/`/g, "'") + '`';

/** The human- and agent-readable copy of the open notes. */
export function renderNotesMarkdown(notes: Note[]): string {
  // Numbers are positions in the full list, so "note 3" is the same pin on the canvas and in this file.
  const open = notes.map((n, i) => ({ n, num: i + 1 })).filter((x) => x.n.status === 'open');
  const lines = [
    '# Brushup design notes',
    '',
    'Notes the user pinned on the design canvas. Each says where the element lives in source when known.',
    'Make the change each note asks for, keep any manual tweaks listed in `.brushup/edits.jsonl`, and when a note is handled set its `"status"` to `"done"` in `.brushup/notes.json`.',
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

/**
 * Notes live in `.brushup/notes.json` (source of truth) with a readable
 * `.brushup/notes.md` beside it. The file is re-read on every operation and
 * watched, so edits made by the user or an agent (for example marking a note
 * done) show up on the canvas.
 */
export class NotesStore {
  private readonly dir: string;
  private readonly file: string;
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private own = new Set<string>();

  constructor(readonly root: string) {
    this.dir = path.join(root, '.brushup');
    this.file = path.join(this.dir, 'notes.json');
  }

  async list(): Promise<Note[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(parsed) ? parsed.map((n) => sanitizeNote(n, n)).filter((n): n is Note => !!n && !!n.id) : [];
    } catch {
      return [];
    }
  }

  private async persist(notes: Note[]) {
    await mkdir(this.dir, { recursive: true });
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
    this.watcher = chokidar.watch(this.file, { ignoreInitial: true });
    const changed = async () => {
      try {
        const content = await readFile(this.file, 'utf8');
        if (this.own.delete(content)) return; // our own write
      } catch {
        /* deleted: fall through to an empty list */
      }
      onChange(await this.list());
    };
    this.watcher.on('add', changed).on('change', changed).on('unlink', changed);
  }

  close() {
    return this.watcher?.close();
  }
}
