import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject } from '../src/init';
import { wireLayout, wireNextConfig, wireProject, wireViteConfig } from '../src/wire';

describe('wireNextConfig', () => {
  it('wraps an ESM default export and adds the import', () => {
    const out = wireNextConfig(`import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n`) as string;
    expect(out).toContain('import { withBrushup } from "brushup/next";');
    expect(out).toContain('export default withBrushup(nextConfig);');
    expect(out.indexOf('withBrushup } from')).toBeGreaterThan(out.indexOf('import type'));
  });

  it('wraps an inline object and keeps single quotes', () => {
    const out = wireNextConfig(`import x from 'x';\nexport default { reactStrictMode: true };\n`) as string;
    expect(out).toContain("from 'brushup/next'");
    expect(out).toContain('export default withBrushup({ reactStrictMode: true });');
  });

  it('handles a config with no imports', () => {
    const out = wireNextConfig(`const nextConfig = {};\nexport default nextConfig;\n`) as string;
    expect(out.startsWith('import { withBrushup } from "brushup/next";\n')).toBe(true);
  });

  it('wraps module.exports with require', () => {
    const out = wireNextConfig(`/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nmodule.exports = nextConfig;\n`) as string;
    expect(out).toContain('const { withBrushup } = require("brushup/next");');
    expect(out).toContain('module.exports = withBrushup(nextConfig);');
  });

  it('is idempotent and leaves shapes it does not know', () => {
    const once = wireNextConfig(`const c = {};\nexport default c;\n`) as string;
    expect(wireNextConfig(once)).toBe('unchanged');
    expect(wireNextConfig(`export default function config() { return {}; }\n`)).toBeNull();
    expect(wireNextConfig(`export const x = 1;\n`)).toBeNull();
    expect(wireNextConfig(`this is not code {{{`)).toBeNull();
  });
});

describe('wireLayout', () => {
  const layout = `import type { Metadata } from "next";\nimport "./globals.css";\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <body className="x">\n        {children}\n      </body>\n    </html>\n  );\n}\n`;

  it('adds the tag before </body> with matching indentation, and the import', () => {
    const out = wireLayout(layout) as string;
    expect(out).toContain('        {children}\n        <BrushupScript />\n      </body>');
    expect(out).toContain('import { BrushupScript } from "brushup/next/script";');
  });

  it('keeps "use client" first and is idempotent', () => {
    const out = wireLayout(`"use client";\nexport default function L({ children }) { return <html><body>{children}</body></html>; }\n`) as string;
    expect(out.startsWith('"use client";')).toBe(true);
    expect(out).toContain('<BrushupScript /></body>');
    expect(wireLayout(out)).toBe('unchanged');
  });

  it('gives up when there is no body', () => {
    expect(wireLayout(`export default function L() { return null; }\n`)).toBeNull();
  });
});

describe('wireViteConfig', () => {
  it('appends brushup() to the plugins array', () => {
    const out = wireViteConfig(`import react from '@vitejs/plugin-react'\nimport { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss()],\n})\n`) as string;
    expect(out).toContain('plugins: [react(), tailwindcss(), brushup()]');
    expect(out).toContain("import brushup from 'brushup/vite'");
  });

  it('handles an empty array, is idempotent, and skips what it cannot place', () => {
    expect(wireViteConfig(`export default { plugins: [] };\n`)).toContain('plugins: [brushup()]');
    expect(wireViteConfig(`import brushup from "brushup/vite";\nexport default {};\n`)).toBe('unchanged');
    expect(wireViteConfig(`export default defineConfig({});\n`)).toBeNull();
    expect(wireViteConfig(`module.exports = { plugins: [] };\n`)).toBeNull();
  });
});

describe('import style', () => {
  it('follows the file: no semicolon when its imports have none, one when they do or there are none', () => {
    expect(wireViteConfig(`import react from '@vitejs/plugin-react'\nexport default { plugins: [react()] }\n`)).toContain("import brushup from 'brushup/vite'\n");
    expect(wireViteConfig(`import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };\n`)).toContain('import brushup from "brushup/vite";');
    expect(wireViteConfig(`export default { plugins: [] };\n`)).toContain('import brushup from "brushup/vite";\n');
  });
});

describe('wireViteConfig finds the top-level plugins only', () => {
  it('ignores plugins nested in worker or test options, even when they come first', () => {
    const out = wireViteConfig(`export default defineConfig({\n  worker: { plugins: () => [] },\n  test: { plugins: [a()] },\n  plugins: [react()],\n});\n`) as string;
    expect(out).toContain('plugins: [react(), brushup()]');
    expect(out).toContain('worker: { plugins: () => [] }');
    expect(out).toContain('test: { plugins: [a()] }');
  });

  it('follows a function, a satisfies/as wrapper and a named const', () => {
    expect(wireViteConfig(`export default defineConfig(({ mode }) => ({ plugins: [react()] }));\n`)).toContain('[react(), brushup()]');
    expect(wireViteConfig(`export default defineConfig(() => {\n  return { plugins: [react()] };\n});\n`)).toContain('[react(), brushup()]');
    expect(wireViteConfig(`export default { plugins: [react()] } satisfies UserConfig;\n`)).toContain('[react(), brushup()]');
    expect(wireViteConfig(`const config = { plugins: [react()] };\nexport default config;\n`)).toContain('[react(), brushup()]');
  });

  it('gives up when the exported config has no plugins array of its own', () => {
    expect(wireViteConfig(`export default defineConfig({ test: { plugins: [a()] } });\n`)).toBeNull();
  });
});

describe('wireProject / init', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-wire-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('wires a Next project end to end and a second run changes nothing', async () => {
    await mkdir(path.join(dir, 'src/app'), { recursive: true });
    await writeFile(path.join(dir, 'next.config.ts'), `const nextConfig = {};\nexport default nextConfig;\n`);
    await writeFile(path.join(dir, 'src/app/layout.tsx'), `export default function L({ children }) {\n  return <html><body>\n    {children}\n  </body></html>;\n}\n`);
    expect((await initProject(dir)).wire).toEqual({ next: { config: 'updated', layout: 'updated' } });
    expect(await readFile(path.join(dir, 'next.config.ts'), 'utf8')).toContain('withBrushup(nextConfig)');
    expect(await readFile(path.join(dir, 'src/app/layout.tsx'), 'utf8')).toContain('<BrushupScript />');
    expect((await initProject(dir)).wire).toEqual({ next: { config: 'unchanged', layout: 'unchanged' } });
  });

  it('reports manual when the layout is missing, and does nothing with wire:false', async () => {
    await writeFile(path.join(dir, 'next.config.js'), `module.exports = {};\n`);
    expect((await wireProject(dir)).next).toEqual({ config: 'updated', layout: 'manual' });
    await writeFile(path.join(dir, 'vite.config.ts'), `export default { plugins: [] };\n`);
    expect((await initProject(dir, { wire: false })).wire).toBeUndefined();
    expect(await readFile(path.join(dir, 'vite.config.ts'), 'utf8')).not.toContain('brushup');
  });

  it('wires a Vite project', async () => {
    await writeFile(path.join(dir, 'vite.config.ts'), `import react from '@vitejs/plugin-react'\nexport default { plugins: [react()] }\n`);
    expect((await initProject(dir)).wire).toEqual({ vite: 'updated' });
  });
});
