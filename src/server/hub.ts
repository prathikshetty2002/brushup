import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { EditError, StaleElement, type Edit } from '../core/edit-types';
import { collectChanges } from './changes';
import type { IgnoredStore } from './ignored';
import { TextNotHere } from '../core/jsx-patch';
import type { EditOutcome, FileSession, Selection } from './file-session';
import type { NotesStore } from './notes';

type ClientMessage =
  | { type: 'edit'; n: number; edit: Edit; hash: string }
  | { type: 'edits'; n: number; edits: Edit[]; hash: string }
  | { type: 'undo' | 'redo'; n: number }
  | { type: 'changes'; n: number }
  | { type: 'upload'; n: number; name: string; data: string }
  | { type: 'ignore-add'; n: number; item: unknown }
  | { type: 'ignore-remove'; n: number; key: string }
  | { type: 'select'; selection: Selection | null }
  | { type: 'note-save'; n: number; note: unknown }
  | { type: 'note-delete'; n: number; id: string }
  | { type: 'hello'; role: 'agent' | 'canvas' }
  | { type: 'ask'; id: string; ask: unknown }
  | { type: 'answer'; id: string; ok: boolean; data?: unknown; error?: string };

interface ClientInfo {
  /** 'canvas' is a browser page running the overlay; 'agent' is a tool such as the MCP server asking it questions. */
  role: 'canvas' | 'agent';
  lastSeen: number;
}

const ASK_TIMEOUT_MS = 5000;
const MAX_ASK_BYTES = 8 * 1024;

/**
 * The canvas's WebSocket endpoint, shared by the static and dev-server modes:
 * canvas edits come in, results and "files changed" notices go out. The caller
 * authenticates the HTTP upgrade (host/origin/token) before handing it over.
 */
export function createHub(session: FileSession, notes?: NotesStore, ignored?: IgnoredStore) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const clients = new Map<WebSocket, ClientInfo>();
  /** Questions an agent asked the canvas that are still waiting for an answer. */
  const pending = new Map<string, { agent: WebSocket; timer: NodeJS.Timeout }>();
  notes?.watch((list) => broadcast({ type: 'notes', notes: list }));

  const send = (ws: WebSocket, msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  /** Canvas pages get every notice; agents only get answers to what they asked. */
  const broadcast = (msg: object) => clients.forEach((info, c) => info.role === 'canvas' && send(c, msg));

  /** The canvas the user touched most recently (several tabs can be open). */
  const activeCanvas = () => [...clients].filter(([, i]) => i.role === 'canvas').sort((a, b) => b[1].lastSeen - a[1].lastSeen)[0]?.[0];

  const finish = (id: string, answer: { ok: boolean; data?: unknown; error?: string }) => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    send(entry.agent, { type: 'answer', id, ...answer });
  };

  const reload = async (files: string[]) =>
    broadcast({ type: 'reload', hash: await session.hash().catch(() => ''), css: files.some((f) => f.endsWith('.css')) });

  const onMessage = async (ws: WebSocket, raw: string) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const info = clients.get(ws);
    if (info?.role === 'canvas') info.lastSeen = Date.now();
    if (msg.type === 'hello') {
      if (info && msg.role === 'agent') info.role = 'agent';
      return;
    }
    if (msg.type === 'ask') {
      if (info?.role !== 'agent' || typeof msg.id !== 'string' || JSON.stringify(msg.ask ?? null).length > MAX_ASK_BYTES) return;
      const canvas = activeCanvas();
      if (!canvas) return void send(ws, { type: 'answer', id: msg.id, ok: false, error: 'No Brushup canvas is open in a browser. Open the app with the Brushup panel visible.' });
      const timer = setTimeout(() => finish(msg.id, { ok: false, error: 'The canvas did not answer in time.' }), ASK_TIMEOUT_MS);
      pending.set(msg.id, { agent: ws, timer });
      return void send(canvas, { type: 'ask', id: msg.id, ask: msg.ask });
    }
    if (msg.type === 'answer') {
      if (info?.role === 'canvas') finish(msg.id, { ok: !!msg.ok, data: msg.data, error: msg.error });
      return;
    }
    if (msg.type === 'upload') {
      if (info?.role !== 'canvas') return;
      if (typeof msg.name !== 'string' || typeof msg.data !== 'string') return void send(ws, { type: 'result', n: msg.n, ok: false, error: 'That upload was malformed.' });
      try {
        const saved = await session.saveAsset(msg.name, Buffer.from(msg.data, 'base64'));
        send(ws, { type: 'result', n: msg.n, ok: true, src: saved.src, saved: saved.file });
      } catch (err) {
        send(ws, { type: 'result', n: msg.n, ok: false, error: err instanceof EditError ? err.message : `Could not save the image: ${(err as Error).message}` });
      }
      return;
    }
    if (msg.type === 'ignore-add' || msg.type === 'ignore-remove') {
      if (info?.role !== 'canvas') return;
      if (!ignored) return void send(ws, { type: 'result', n: msg.n, ok: false, error: 'Ignoring checks is not available here.' });
      try {
        const list = msg.type === 'ignore-add' ? await ignored.add(msg.item) : await ignored.remove(String(msg.key));
        send(ws, { type: 'result', n: msg.n, ok: true });
        broadcast({ type: 'ignored', items: list });
      } catch (err) {
        send(ws, { type: 'result', n: msg.n, ok: false, error: (err as Error).message });
      }
      return;
    }
    if (msg.type === 'changes') {
      if (info?.role !== 'canvas') return;
      return void send(ws, { type: 'result', n: msg.n, ok: true, changes: await collectChanges(session.root) });
    }
    if (msg.type === 'select') return void session.setSelection(msg.selection).catch(() => {});
    if (msg.type === 'note-save' || msg.type === 'note-delete') {
      if (!notes) return void send(ws, { type: 'result', n: msg.n, ok: false, error: 'Notes are not available here.' });
      try {
        if (msg.type === 'note-save') {
          // Static mode stamps synthetic ids that change with the file; record the real file:line instead.
          const anchor = (msg.note as { anchor?: { sid?: string; src?: string } } | null)?.anchor;
          if (anchor?.sid) {
            anchor.src = (await session.locate(anchor.sid).catch(() => undefined)) ?? anchor.src;
            delete anchor.sid;
          }
        }
        const list = msg.type === 'note-save' ? await notes.save(msg.note) : await notes.remove(msg.id);
        send(ws, { type: 'result', n: msg.n, ok: true });
        broadcast({ type: 'notes', notes: list });
      } catch (err) {
        send(ws, { type: 'result', n: msg.n, ok: false, error: (err as Error).message });
      }
      return;
    }
    try {
      const out: EditOutcome =
        msg.type === 'edit' ? await session.edit(msg.edit, msg.hash) : msg.type === 'edits' ? await session.editMany(Array.isArray(msg.edits) ? msg.edits : [], msg.hash) : msg.type === 'undo' ? await session.undo() : await session.redo();
      send(ws, { type: 'result', n: msg.n, ok: true, hash: await session.hash(), target: out.target, warning: out.warning, select: out.select });
      // Always refresh, even for a no-op edit, so the canvas drops any temporary drag/typing preview.
      await reload(out.files);
    } catch (err) {
      const message = err instanceof EditError ? err.message : `Unexpected error: ${(err as Error).message}`;
      send(ws, { type: 'result', n: msg.n, ok: false, error: message, stale: err instanceof StaleElement, textSource: err instanceof TextNotHere, hash: await session.hash().catch(() => '') });
    }
  };

  return {
    broadcast,
    /** Tell every canvas that files were changed by someone other than the canvas. */
    announce: reload,
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.set(ws, { role: 'canvas', lastSeen: Date.now() });
        send(ws, { type: 'info', root: session.root }); // lets the canvas build open-in-editor links
        // An agent says hello right after connecting; canvas pages get the notes straight away.
        void notes?.list().then((list) => clients.get(ws)?.role === 'canvas' && send(ws, { type: 'notes', notes: list }));
        void ignored?.list().then((items) => clients.get(ws)?.role === 'canvas' && send(ws, { type: 'ignored', items }));
        ws.on('close', () => {
          clients.delete(ws);
          for (const [id, entry] of pending) if (entry.agent === ws) (clearTimeout(entry.timer), pending.delete(id));
        });
        ws.on('message', (data) => void onMessage(ws, data.toString()));
      });
    },
    close() {
      void notes?.close();
      wss.close();
      clients.forEach((_, c) => c.terminate());
    },
  };
}
