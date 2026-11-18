import path from 'node:path';
import type { Plugin } from 'vite';
import { instrument } from './core/jsx';
import type { DevOptions } from './server/dev-project';
import { startDevHost, type DevHost } from './server/dev-host';

export type BrushupOptions = DevOptions;

/**
 * Vite plugin for dev-server mode. In `vite dev` it
 *  1. stamps every JSX host element with `data-brushup-src="file:line:col"`,
 *  2. starts the Brushup edit server (loopback only), and
 *  3. injects the canvas overlay into the page.
 * It does nothing in `vite build`.
 */
export default function brushup(options: BrushupOptions = {}): Plugin {
  let root = process.cwd();
  let host: DevHost | undefined;

  return {
    name: 'brushup',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
    },

    async configureServer(server) {
      host = await startDevHost(root, options);
      server.httpServer?.once('close', () => void host?.close());
      server.config.logger.info(`  ➜  Brushup canvas active (edits write back to your JSX)`);
    },

    transform(code, id) {
      const file = id.split('?')[0];
      if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/')) return null;
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (rel.startsWith('..')) return null;
      return instrument(code, file, rel) as { code: string; map: never } | null;
    },

    transformIndexHtml() {
      if (!host) return;
      return [
        { tag: 'script', children: `window.__brushup=${JSON.stringify({ mode: 'dev', ws: host.wsUrl, hash: '' })};`, injectTo: 'head-prepend' },
        { tag: 'script', attrs: { src: host.overlayUrl }, injectTo: 'body' },
      ];
    },

    handleHotUpdate() {
      host?.notifyHmr();
    },
  };
}
