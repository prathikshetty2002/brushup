import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDevHost, type DevHost } from '../src/server/dev-host';
import { NotesStore } from '../src/server/notes';
import { readHostFile } from '../src/server/host-file';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dir: string;
let client: Client | null = null;
let host: DevHost | null = null;
const sockets: WebSocket[] = [];

/** Start the real MCP server as a subprocess and connect to it over stdio, as Claude Code would. */
async function connect() {
  const transport = new StdioClientTransport({ command: path.join(ROOT, 'node_modules/.bin/tsx'), args: [path.join(ROOT, 'src/mcp/bin.ts'), '--root', dir], stderr: 'ignore' });
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

const text = (r: any) => r.content[0].text as string;
const json = (r: any) => JSON.parse(text(r));

/** A stand-in for the browser overlay: connects like a canvas page and answers questions. */
async function fakeCanvas(onAsk: (ask: any) => any, label = 'canvas') {
  const info = await readHostFile(dir);
  const ws = new WebSocket(info!.wsUrl);
  sockets.push(ws);
  const asked: any[] = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== 'ask') return;
    asked.push({ label, ask: msg.ask });
    const out = onAsk(msg.ask);
    ws.send(JSON.stringify({ type: 'answer', id: msg.id, ...(out.error ? { ok: false, error: out.error } : { ok: true, data: out }) }));
  });
  await new Promise((r) => ws.once('open', r));
  return { ws, asked };
}

beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'ascend-e2e-'))));
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await client?.close();
  client = null;
  await host?.close();
  host = null;
  await rm(dir, { recursive: true, force: true });
});

describe('ascend-mcp over stdio', () => {
  it('lists its five tools with read-only hints where they apply', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['ascend_get_notes', 'ascend_get_selection', 'ascend_inspect', 'ascend_recent_edits', 'ascend_update_note']);
    const hint = (n: string) => tools.find((t) => t.name === n)!.annotations?.readOnlyHint;
    expect(hint('ascend_get_notes')).toBe(true);
    expect(hint('ascend_inspect')).toBe(true);
    expect(hint('ascend_update_note')).toBe(false);
  }, 30000);

  it('reads notes and marks one done through the protocol', async () => {
    const [n] = await new NotesStore(dir).save({ kind: 'section', label: 'Hero', text: 'Add spacing', anchor: { tag: 'h1', classes: [], text: 'Hi', src: 'src/page.tsx:3:4', index: 0, page: '/' } });
    const c = await connect();
    const notes = json(await c.callTool({ name: 'ascend_get_notes', arguments: {} }));
    expect(notes.notes[0]).toMatchObject({ id: n.id, number: 1, name: 'Hero', where: { renderedBy: 'src/page.tsx:3:4' } });
    await c.callTool({ name: 'ascend_update_note', arguments: { id: n.id, status: 'done' } });
    expect(json(await c.callTool({ name: 'ascend_get_notes', arguments: {} })).count).toBe(0);
    expect(json(await c.callTool({ name: 'ascend_get_notes', arguments: { status: 'done' } })).count).toBe(1);
  }, 30000);

  it('rejects invalid arguments with a protocol-level error', async () => {
    const c = await connect();
    const r = await c.callTool({ name: 'ascend_update_note', arguments: { id: 'x', status: 'banana' } }).catch((e) => e);
    expect(r instanceof Error || (r as any).isError).toBe(true);
  }, 30000);

  it('says clearly when no Ascend server is running', async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: 'ascend_inspect', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/not running/i);
  }, 30000);
});

describe('ascend_inspect against a live Ascend server', () => {
  beforeEach(async () => {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'package.json'), '{}');
    host = await startDevHost(dir);
  });

  it('reaches the open canvas and returns what it answers', async () => {
    const canvas = await fakeCanvas((ask) => ({ tag: 'h1', box: { width: 640 }, echoed: ask }));
    const c = await connect();
    const r = await c.callTool({ name: 'ascend_inspect', arguments: { note_id: 'n1' } });
    expect(json(r).tag).toBe('h1');
    expect(json(r).echoed).toEqual({ kind: 'inspect', noteId: 'n1' });
    expect(canvas.asked).toHaveLength(1);
  }, 30000);

  it('relays the canvas\'s own error (nothing selected)', async () => {
    await fakeCanvas(() => ({ error: 'Nothing is selected on the canvas.' }));
    const c = await connect();
    const r: any = await c.callTool({ name: 'ascend_inspect', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Nothing is selected on the canvas.');
  }, 30000);

  it('says so when the server runs but no browser has the canvas open', async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: 'ascend_inspect', arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/No Ascend canvas is open/);
  }, 30000);

  it('asks the canvas tab the user touched most recently', async () => {
    const a = await fakeCanvas(() => ({ from: 'A' }), 'A');
    const b = await fakeCanvas(() => ({ from: 'B' }), 'B');
    await new Promise((r) => setTimeout(r, 50));
    a.ws.send(JSON.stringify({ type: 'select', selection: null })); // the user clicked in tab A
    await new Promise((r) => setTimeout(r, 100));
    const c = await connect();
    expect(json(await c.callTool({ name: 'ascend_inspect', arguments: {} })).from).toBe('A');
    expect(b.asked).toHaveLength(0);
  }, 30000);

  it('does not let an agent connection impersonate a canvas or flood the canvas with other people\'s questions', async () => {
    const canvas = await fakeCanvas(() => ({ ok: 1 }));
    const info = await readHostFile(dir);
    const stranger = new WebSocket(info!.wsUrl);
    sockets.push(stranger);
    await new Promise((r) => stranger.once('open', r));
    // never said hello as an agent: its questions are ignored, its answers are ignored
    stranger.send(JSON.stringify({ type: 'ask', id: 'x', ask: { kind: 'inspect' } }));
    stranger.send(JSON.stringify({ type: 'hello', role: 'agent' }));
    stranger.send(JSON.stringify({ type: 'answer', id: 'x', ok: true, data: { forged: true } }));
    await new Promise((r) => setTimeout(r, 150));
    expect(canvas.asked).toHaveLength(0);
  }, 30000);
});
