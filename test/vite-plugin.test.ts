import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import brushup from '../src/vite';

let dir: string;
let closeServer: (() => void) | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-vite-'));
  await mkdir(path.join(dir, 'app'));
});
afterEach(async () => {
  closeServer?.();
  closeServer = undefined;
  await rm(dir, { recursive: true, force: true });
});

const JSX = 'export default function A() { return <div><p>Hi</p></div>; }\n';

/** Drive the plugin the way Vite does: resolve config, start the server, then transform files. */
async function start(plugins: { name: string }[]) {
  const p = brushup() as any;
  p.configResolved({ root: dir, plugins });
  await p.configureServer({ httpServer: { once: (_: string, cb: () => void) => (closeServer = cb) }, config: { logger: { info() {} } } });
  const run = (code: string, rel: string) => p.transform.call({}, code, path.join(dir, rel));
  return { p, run };
}

describe('the Vite plugin in a server-rendered framework (React Router, Remix)', () => {
  it('loads the overlay from the root route, appended so line numbers stay put', async () => {
    const { run } = await start([{ name: 'react-router' }]);
    const out = run(JSX, 'app/root.tsx');
    expect(out.code).toContain('data-brushup-src="app/root.tsx:1:');
    expect(out.code.trimEnd().endsWith('import "virtual:brushup-client";')).toBe(true);
    expect(out.code.split('\n')[0]).toContain('export default function A()'); // nothing was put before the first line
  });

  it('serves a loader that sets the config and adds the overlay script, once and in the browser only', async () => {
    const { p } = await start([{ name: 'remix' }]);
    expect(p.resolveId('virtual:brushup-client')).toBe('\0virtual:brushup-client');
    expect(p.resolveId('react')).toBeNull();
    const code = p.load('\0virtual:brushup-client') as string;
    expect(code).toContain("typeof window !== 'undefined' && !window.__brushup");
    expect(code).toMatch(/ws: "ws:\/\/127\.0\.0\.1:\d+\/__brushup\/ws\?token=[0-9a-f]+"/);
    expect(code).toMatch(/s\.src = "http:\/\/127\.0\.0\.1:\d+\/__brushup\/overlay\.js/);
    expect(p.load('something-else')).toBeNull();
  });

  it('leaves other files alone, and every app that is not server-rendered', async () => {
    const a = await start([{ name: 'react-router' }]);
    expect(a.run(JSX, 'app/routes/home.tsx').code).not.toContain('virtual:brushup-client');
    closeServer?.();
    const b = await start([{ name: 'vite:react-babel' }]);
    expect(b.run(JSX, 'app/root.tsx').code).not.toContain('virtual:brushup-client'); // a plain Vite app uses index.html instead
    expect(b.run(JSX, 'app/root.tsx').code).toContain('data-brushup-src'); // but is tagged as usual
  });

  it('matches a src/ layout too, and Windows-style paths', async () => {
    await mkdir(path.join(dir, 'src'));
    const { run } = await start([{ name: 'react-router' }]);
    expect(run(JSX, 'src/root.jsx').code).toContain('virtual:brushup-client');
  });
});
