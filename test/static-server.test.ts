import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server/index';

let dir: string;
let server: RunningServer | null = null;
let port = 0;
let wsUrl = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-static-'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body><h1>Hi</h1></body></html>');
  server = await startServer(path.join(dir, 'index.html'), 45000 + Math.floor(Math.random() * 500));
  port = Number(new URL(server.url).port);
  const html = await (await fetch(server.url)).text();
  wsUrl = JSON.parse(/window\.__brushup=(\{.*?\})<\/script>/.exec(html)![1]).ws;
});
afterEach(async () => {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

/** Open a socket and report whether the server accepted the upgrade. */
const tryConnect = (url: string, headers: Record<string, string> = {}) =>
  new Promise<'open' | 'rejected'>((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => (ws.close(), resolve('open')));
    ws.on('error', () => resolve('rejected'));
    ws.on('close', () => resolve('rejected'));
  });

describe('static-mode WebSocket access', () => {
  it('puts a per-run token in the page it serves', () => {
    expect(wsUrl).toMatch(new RegExp(`^ws://127\\.0\\.0\\.1:${port}/__brushup/ws\\?token=[0-9a-f]{32}$`));
  });

  it('accepts the page\'s own origin with the token', async () => {
    expect(await tryConnect(wsUrl, { Origin: `http://127.0.0.1:${port}` })).toBe('open');
  });

  it('rejects a connection with no token or the wrong token', async () => {
    expect(await tryConnect(`ws://127.0.0.1:${port}/__brushup/ws`)).toBe('rejected');
    expect(await tryConnect(`ws://127.0.0.1:${port}/__brushup/ws?token=${'0'.repeat(32)}`)).toBe('rejected');
  });

  it('rejects another website even with a valid token (Origin check)', async () => {
    expect(await tryConnect(wsUrl, { Origin: 'http://evil.example' })).toBe('rejected');
  });

  it('rejects a spoofed Host header (DNS rebinding)', async () => {
    expect(await tryConnect(wsUrl, { Host: `evil.example:${port}` })).toBe('rejected');
  });
});

describe('canvas connection', () => {
  it('tells a canvas where the project lives so it can link files to an editor', async () => {
    const msgs = await new Promise<{ type: string; root?: string }[]>((resolve) => {
      const got: { type: string; root?: string }[] = [];
      const ws = new WebSocket(wsUrl, { headers: { Origin: `http://127.0.0.1:${port}` } });
      ws.on('message', (d) => got.push(JSON.parse(d.toString())));
      setTimeout(() => (ws.close(), resolve(got)), 300);
    });
    const info = msgs.find((m) => m.type === 'info');
    expect(info?.root).toMatch(new RegExp(`${path.basename(dir)}$`));
  });
});
