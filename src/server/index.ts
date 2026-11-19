import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHub } from './hub';
import { removeHostFile, writeHostFile } from './host-file';
import { overlaySource } from './overlay-bundle';
import { IgnoredStore } from './ignored';
import { NotesStore } from './notes';
import { Project } from './project';
import { watchProject } from './watcher';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

/** Static mode: serve one HTML file (plus its folder) with the canvas injected. */
export async function startServer(entry: string, preferredPort = 4321): Promise<RunningServer> {
  const project = new Project(path.resolve(entry));
  const overlay = await overlaySource();
  const hub = createHub(project, new NotesStore(project.root), new IgnoredStore(project.root));
  const token = randomBytes(16).toString('hex');
  let port = preferredPort;

  // Edits write files, so only accept requests addressed to us on loopback (blocks DNS rebinding / cross-site pages).
  const hostOk = (host: string | undefined) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  const originOk = (origin: string | undefined) => !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;

  const servePage = async (res: ServerResponse, withOverlay: boolean) => {
    try {
      const { html, hash } = await project.render();
      const boot = `<script>window.__brushup=${JSON.stringify({ mode: 'static', hash, ws: `ws://127.0.0.1:${port}/__brushup/ws?token=${token}` })}</script><script src="/__brushup/overlay.js"></script>`;
      const body = withOverlay ? (html.includes('</body>') ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, boot + '</body>') : html + boot) : html;
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store', 'x-brushup-hash': hash });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  };

  const serveStatic = async (pathname: string, res: ServerResponse) => {
    const file = path.resolve(project.root, '.' + decodeURIComponent(pathname));
    const rel = path.relative(project.root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || /(^|[\\/])\./.test(rel)) return res.writeHead(403).end('Forbidden');
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    if (!hostOk(req.headers.host)) return void res.writeHead(403).end('Bad host');
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    if (pathname === '/__brushup/overlay.js') {
      res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
      return void res.end(overlay);
    }
    if (pathname === '/__brushup/page') return servePage(res, false);
    if (pathname === '/' || pathname === '/' + path.basename(project.entry)) return servePage(res, true);
    return serveStatic(pathname, res);
  };

  const server = createServer((req, res) => void handler(req, res));
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // Host and Origin stop other websites (and DNS rebinding); the token is the same per-run secret the dev-server modes use.
    if (!hostOk(req.headers.host) || !originOk(req.headers.origin) || url.pathname !== '/__brushup/ws' || url.searchParams.get('token') !== token) return void socket.destroy();
    hub.upgrade(req, socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    const tryListen = (p: number) => {
      port = p;
      server.once('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' && p < preferredPort + 10 ? tryListen(p + 1) : reject(err)));
      server.listen(p, '127.0.0.1', () => resolve());
    };
    tryListen(preferredPort);
  });

  const stopWatching = watchProject(project, (files) => void hub.announce(files));
  await writeHostFile(project.root, { mode: 'static', wsUrl: `ws://127.0.0.1:${port}/__brushup/ws?token=${token}`, pid: process.pid });

  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await stopWatching();
      await removeHostFile(project.root);
      hub.close();
      await new Promise((r) => server.close(r));
    },
  };
}
