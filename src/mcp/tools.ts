import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NotesStore, type Note } from '../server/notes';
import { askCanvas, type CanvasAnswer } from './canvas-client';

/** Everything a tool needs, so tests can swap the canvas for a stub. */
export interface ToolContext {
  root: string;
  ask?: (ask: Record<string, unknown>) => Promise<CanvasAnswer>;
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string): ToolResult => ({ ok: false, error });
const brushupFile = (ctx: ToolContext, name: string) => path.join(ctx.root, '.brushup', name);

/** Short `file:line` / `file:line#Component` for a source reference. */
const shortRef = (ref?: string) => (ref ? ref.replace(/:\d+(#|$)/, '$1') : undefined);

function describeNote(n: Note, number: number) {
  return {
    id: n.id,
    number, // the pin number the user sees on the canvas
    kind: n.kind,
    name: n.label || undefined,
    note: n.text,
    status: n.status,
    reply: n.reply,
    page: n.anchor.page,
    where: {
      component: n.anchor.use ? `<${n.anchor.use.split('#')[1]}> used at ${n.anchor.use.split('#')[0]}` : undefined,
      renderedBy: n.anchor.src,
    },
    element: { tag: n.anchor.tag, classes: n.anchor.classes.slice(0, 12), classesTotal: n.anchor.classes.length, text: n.anchor.text || undefined },
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

/** A `since` cursor from the caller: an ISO time, or an error message. */
function parseSince(since?: string): { at: number } | { error: string } {
  if (since === undefined) return { at: -Infinity };
  const at = Date.parse(since);
  return Number.isNaN(at) ? { error: `"since" must be an ISO date-time such as 2026-01-31T09:30:00Z. Pass the "cursor" a previous call returned.` } : { at };
}

/**
 * Notes the user pinned on the canvas, with where each lives in source. `since` returns only notes created or changed
 * after that time, and the `cursor` in the answer is what to pass next time, so an agent never re-reads what it has seen.
 */
export async function getNotes(ctx: ToolContext, input: { status?: 'open' | 'done' | 'all'; page?: string; since?: string }): Promise<ToolResult> {
  const since = parseSince(input.since);
  if ('error' in since) return fail(since.error);
  const cursor = new Date().toISOString();
  const all = await new NotesStore(ctx.root).list();
  const want = input.status ?? 'open';
  const notes = all
    .map((n, i) => ({ n, view: describeNote(n, i + 1) }))
    .filter(({ n, view }) => (want === 'all' || view.status === want) && (!input.page || view.page === input.page) && Date.parse(n.updatedAt) > since.at)
    .map(({ view }) => view);
  return ok({ count: notes.length, cursor, notes });
}

/** Mark a note done (or reopen it), optionally saying what was done. Only `.brushup/notes.json` changes. */
export async function updateNote(ctx: ToolContext, input: { id: string; status: 'open' | 'done'; reply?: string }): Promise<ToolResult> {
  const store = new NotesStore(ctx.root);
  const note = (await store.list()).find((n) => n.id === input.id);
  if (!note) return fail(`No note with id ${input.id}. Use brushup_get_notes to see the ids.`);
  const saved = (await store.save({ ...note, status: input.status, reply: input.reply ?? note.reply })).find((n) => n.id === note.id);
  return ok({ id: note.id, status: input.status, reply: saved?.reply });
}

/** The element currently selected on the canvas, as last written by the canvas. */
export async function getSelection(ctx: ToolContext): Promise<ToolResult> {
  const file = brushupFile(ctx, 'selection.json');
  try {
    const selection = JSON.parse(await readFile(file, 'utf8'));
    if (!selection) return ok({ selection: null, hint: 'Nothing is selected on the canvas.' });
    return ok({ selection, updatedAt: (await stat(file)).mtime.toISOString() });
  } catch {
    return ok({ selection: null, hint: 'Nothing has been selected on the canvas yet.' });
  }
}

interface LoggedEdit {
  kind: 'style' | 'text';
  id: string;
  props?: Record<string, string>;
  text?: string;
}

const summarize = (e: LoggedEdit) =>
  e.kind === 'text' ? { target: shortRef(e.id), change: `text → "${(e.text ?? '').slice(0, 80)}"` } : { target: shortRef(e.id), change: Object.entries(e.props ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ') };

/** The user's recent manual edits on the canvas. Agents should keep these, not revert them. */
export async function getRecentEdits(ctx: ToolContext, input: { limit?: number; since?: string }): Promise<ToolResult> {
  const since = parseSince(input.since);
  if ('error' in since) return fail(since.error);
  const cursor = new Date().toISOString();
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 10), 1), 50);
  let lines: string[] = [];
  try {
    lines = (await readFile(brushupFile(ctx, 'edits.jsonl'), 'utf8')).split('\n').filter(Boolean);
  } catch {
    /* no edits yet */
  }
  const parsed = lines
    .map((line) => {
      try {
        const e = JSON.parse(line);
        const action = e.undo ? 'undo' : e.redo ? 'redo' : 'edit';
        const edits: LoggedEdit[] = e.edits ?? (e.edit ? [e.edit] : []);
        return { at: e.at, action, locked: action !== 'undo', files: e.files ?? e.undo ?? e.redo ?? [], changes: edits.map(summarize) };
      } catch {
        return null; // a corrupt line must not use up the limit
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null && Date.parse(e.at) > since.at);
  const entries = parsed.slice(-limit).reverse(); // newest first
  return ok({ count: entries.length, cursor, rule: 'Edits marked locked were made by the user on purpose and are already in source. Keep them; do not revert, overwrite or redo them.', edits: entries });
}

/**
 * How an element renders right now (computed styles, size, overflow), straight from the open canvas. `note_ids`
 * inspects several notes' elements in one call; each answers on its own, so one that can't be found doesn't hide the rest.
 */
export async function inspect(ctx: ToolContext, input: { note_id?: string; note_ids?: string[] }): Promise<ToolResult> {
  const ask = ctx.ask ?? ((q) => askCanvas(ctx.root, q));
  if (input.note_ids?.length) {
    const elements = [];
    for (const noteId of input.note_ids.slice(0, 10)) {
      const answer = await ask({ kind: 'inspect', noteId });
      elements.push(answer.ok ? { note_id: noteId, ...(answer.data as object) } : { note_id: noteId, error: answer.error });
    }
    return ok({ count: elements.length, elements });
  }
  const answer = await ask({ kind: 'inspect', noteId: input.note_id });
  return answer.ok ? ok(answer.data) : fail(answer.error);
}
