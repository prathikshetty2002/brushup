import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DevProject, type DevOptions } from './dev-project';
import { createHub } from './hub';
import { removeHostFile, writeHostFile } from './host-file';
import { IgnoredStore } from './ignored';
import { NotesStore } from './notes';
import { overlaySource } from './overlay-bundle';
import { watchProject } from './watcher';

export interface DevHost {
  overlayUrl: string;
  wsUrl: string;
  /** Tell connected canvases the dev server is about to hot-update the page. */
  notifyHmr(): void;
  close(): Promise<void>;
}

/**
 * The Brushup side of dev-server mode: a loopback-only server that hands out
 * the overlay script and takes edits over a WebSocket. The app itself is
 * served by the user's own dev server (Vite), so none of its requests pass
 * through here. A random token, injected only into the page the dev server
 * renders, keeps other sites from talking to the socket.
 */
export async function startDevHost(root: string, options: DevOptions = {}): Promise<DevHost> {
  const session = new DevProject(root, options);
  const hub = createHub(session, new NotesStore(root), new IgnoredStore(root));
  const overlay = await overlaySource();
  const token = randomBytes(16).toString('hex');
  let port = 0;

  const hostOk = (host: string | undefined) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

  const server = createServer((req, res) => {
    if (!hostOk(req.headers.host)) return void res.writeHead(403).end('Bad host');
    if (new URL(req.url ?? '/', 'http://x').pathname === '/__brushup/overlay.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(overlay);
    }
    res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!hostOk(req.headers.host) || url.pathname !== '/__brushup/ws' || url.searchParams.get('token') !== token) return void socket.destroy();
    hub.upgrade(req, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  const stopWatching = watchProject(session, (files) => void hub.announce(files));
  const wsUrl = `ws://127.0.0.1:${port}/__brushup/ws?token=${token}`;
  await writeHostFile(root, { mode: 'dev', wsUrl, pid: process.pid });

  return {
    overlayUrl: `http://127.0.0.1:${port}/__brushup/overlay.js`,
    wsUrl,
    notifyHmr: () => hub.broadcast({ type: 'hmr' }),
    close: async () => {
      await stopWatching();
      await removeHostFile(root);
      hub.close();
      await new Promise((r) => server.close(r));
    },
  };
}
