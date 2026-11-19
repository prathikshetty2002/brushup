import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IgnoredStore, sanitizeIgnored } from '../src/server/ignored';
import { startServer, type RunningServer } from '../src/server/index';

describe('sanitizeIgnored', () => {
  it('keeps a well-formed entry, trims it, and refuses one with no key or rule', () => {
    const ok = sanitizeIgnored({ key: ' contrast|<p> “x”|/ ', scope: 'one', rule: 'contrast', label: '<p> “x”', page: '/' })!;
    expect(ok).toMatchObject({ key: 'contrast|<p> “x”|/', scope: 'one', rule: 'contrast', label: '<p> “x”', page: '/' });
    expect(Date.parse(ok.at)).not.toBeNaN();
    expect(sanitizeIgnored({ rule: 'contrast' })).toBeNull();
    expect(sanitizeIgnored({ key: 'k' })).toBeNull();
    expect(sanitizeIgnored('nope')).toBeNull();
  });

  it('bounds hostile input and treats an unknown scope as one finding', () => {
    const bad = sanitizeIgnored({ key: 'k'.repeat(5000), rule: 'r\u0000x', label: 'L'.repeat(5000), scope: 'everything' })!;
    expect(bad.key).toHaveLength(400);
    expect(bad.rule).toBe('rx');
    expect(bad.label).toHaveLength(200);
    expect(bad.scope).toBe('one');
  });
});

describe('IgnoredStore', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-ign-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('is empty to begin with, and adds, dedupes by key and removes', async () => {
    const store = new IgnoredStore(dir);
    expect(await store.list()).toEqual([]);
    await store.add({ key: 'a', rule: 'spacing-grid', label: '<h1>' });
    await store.add({ key: 'b', rule: 'contrast', label: '<p>' });
    const again = await store.add({ key: 'a', rule: 'spacing-grid', label: '<h1> new label' });
    expect(again.map((i) => [i.key, i.label])).toEqual([['b', '<p>'], ['a', '<h1> new label']]);
    expect((await store.remove('b')).map((i) => i.key)).toEqual(['a']);
    expect(JSON.parse(await readFile(path.join(dir, '.brushup', 'ignored-checks.json'), 'utf8'))).toHaveLength(1);
  });

  it('rejects nothing-to-ignore and survives a corrupt file', async () => {
    const store = new IgnoredStore(dir);
    await expect(store.add({})).rejects.toThrow(/Nothing to ignore/);
    await store.add({ key: 'a', rule: 'r' });
    await writeFile(path.join(dir, '.brushup', 'ignored-checks.json'), '{ not json');
    expect(await store.list()).toEqual([]);
  });
});

describe('over the canvas socket', () => {
  let dir: string;
  let server: RunningServer | null = null;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-ign-srv-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body><h1>Hi</h1></body></html>');
    server = await startServer(path.join(dir, 'index.html'), 45600 + Math.floor(Math.random() * 300));
  });
  afterEach(async () => {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  const connect = async (role: 'canvas' | 'agent' = 'canvas') => {
    const html = await (await fetch(server!.url)).text();
    const ws = new WebSocket(JSON.parse(/window\.__brushup=(\{.*?\})<\/script>/.exec(html)![1]).ws, { headers: { Origin: new URL(server!.url).origin } });
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    if (role === 'agent') ws.send(JSON.stringify({ type: 'hello', role: 'agent' }));
    return { ws, msgs };
  };
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 60 && !fn(); i++) await new Promise((r) => setTimeout(r, 25));
  };

  it('stores an ignore, tells every canvas, sends the list to a new one, and removes it again', async () => {
    const a = await connect();
    const b = await connect();
    a.ws.send(JSON.stringify({ type: 'ignore-add', n: 1, item: { key: 'k1', scope: 'one', rule: 'spacing-grid', label: '<h1>', page: '/' } }));
    await until(() => b.msgs.some((m) => m.type === 'ignored' && m.items.length === 1));
    expect(a.msgs.find((m) => m.type === 'result' && m.n === 1)).toMatchObject({ ok: true });
    expect(b.msgs.find((m) => m.type === 'ignored' && m.items.length === 1).items[0]).toMatchObject({ key: 'k1', rule: 'spacing-grid' });
    expect(JSON.parse(await readFile(path.join(dir, '.brushup', 'ignored-checks.json'), 'utf8'))[0].key).toBe('k1');
    const late = await connect();
    await until(() => late.msgs.some((m) => m.type === 'ignored'));
    expect(late.msgs.find((m) => m.type === 'ignored').items).toHaveLength(1); // the first thing a new canvas hears
    a.ws.send(JSON.stringify({ type: 'ignore-remove', n: 2, key: 'k1' }));
    await until(() => b.msgs.filter((m) => m.type === 'ignored').length >= 3);
    expect(b.msgs.filter((m) => m.type === 'ignored').pop().items).toEqual([]);
    [a, b, late].forEach((c) => c.ws.close());
  });

  it('refuses a malformed ignore, and does not let an agent connection change the list', async () => {
    const a = await connect();
    a.ws.send(JSON.stringify({ type: 'ignore-add', n: 5, item: { nothing: true } }));
    await until(() => a.msgs.some((m) => m.type === 'result' && m.n === 5));
    expect(a.msgs.find((m) => m.type === 'result' && m.n === 5)).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing to ignore/) });
    const agent = await connect('agent');
    agent.ws.send(JSON.stringify({ type: 'ignore-add', n: 6, item: { key: 'x', rule: 'r' } }));
    await new Promise((r) => setTimeout(r, 200));
    expect(await new IgnoredStore(dir).list()).toEqual([]);
    [a, agent].forEach((c) => c.ws.close());
  });
});
