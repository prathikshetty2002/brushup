import type { Plugin } from 'vite';
import { instrument } from './core/jsx';
import { projectRelative } from './core/paths';
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
const VIRTUAL = 'virtual:brushup-client';
const RESOLVED = '\0' + VIRTUAL;
/** The root route of React Router / Remix, which renders the HTML on the server (so `transformIndexHtml` never runs). */
const ROOT_ROUTE = /(^|\/)(app|src\/app|src)\/root\.[jt]sx$/;
const SSR_FRAMEWORK = /^(react-router|remix)/;

export default function brushup(options: BrushupOptions = {}): Plugin {
  let root = process.cwd();
  let host: DevHost | undefined;
  let serverRendered = false;

  return {
    name: 'brushup',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      serverRendered = config.plugins.some((p) => SSR_FRAMEWORK.test(p.name));
    },

    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },

    /** The page loader for server-rendered frameworks: runs in the browser only, once, and skips if the HTML hook already did it. */
    load(id) {
      if (id !== RESOLVED) return null;
      if (!host) return 'export {};';
      return `if (typeof window !== 'undefined' && !window.__brushup) {
  window.__brushup = { mode: 'dev', ws: ${JSON.stringify(host.wsUrl)}, hash: '' };
  const s = document.createElement('script');
  s.src = ${JSON.stringify(host.overlayUrl)};
  document.body.appendChild(s);
}
export {};`;
    },

    async configureServer(server) {
      host = await startDevHost(root, options);
      server.httpServer?.once('close', () => void host?.close());
      server.config.logger.info(`  ➜  Brushup canvas active (edits write back to your JSX)`);
    },

    transform(code, id) {
      const file = id.split('?')[0];
      if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/')) return null;
      const rel = projectRelative(root, file);
      if (rel === null) return null;
      const out = instrument(code, file, rel) as { code: string; map: never } | null;
      // Server-rendered apps have no index.html to put the script in, so the root route pulls it in instead.
      // Appended (imports hoist), so it never shifts the line numbers the source tags depend on.
      if (serverRendered && ROOT_ROUTE.test(rel.replace(/\\/g, '/'))) {
        return { code: `${out?.code ?? code}\nimport ${JSON.stringify(VIRTUAL)};\n`, map: (out?.map ?? null) as never };
      }
      return out;
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
