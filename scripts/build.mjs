// Builds the publishable bundle:
//   dist/overlay.js      in-page canvas
//   dist/vite.js         Vite plugin + edit server
//   dist/next.js         Next.js config wrapper (withBrushup)
//   dist/next-loader.cjs build loader that tags JSX (webpack + Turbopack)
//   dist/next-script.js  <BrushupScript /> component
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

await build({ entryPoints: ['src/overlay/index.ts'], bundle: true, outfile: 'dist/overlay.js', format: 'iife', target: 'es2020' });

const node = { bundle: true, platform: 'node', target: 'node20', packages: 'external' };
await build({ ...node, entryPoints: ['src/vite.ts'], outfile: 'dist/vite.js', format: 'esm' });
// CommonJS twins, for `require('brushup/vite')` in a CJS vite.config / `require('brushup/next')` in next.config.js.
// import.meta.url is rewritten to the file's own URL, and the exports are merged onto the default function.
const cjs = {
  ...node,
  format: 'cjs',
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  footer: { js: 'module.exports = Object.assign(module.exports.default, module.exports);' },
};
await build({ ...cjs, entryPoints: ['src/vite.ts'], outfile: 'dist/vite.cjs' });
await build({ ...cjs, entryPoints: ['src/next/index.ts'], outfile: 'dist/next.cjs' });
await build({ ...node, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', format: 'esm', banner: { js: '#!/usr/bin/env node' } });
await build({ ...node, entryPoints: ['src/mcp/bin.ts'], outfile: 'dist/mcp.js', format: 'esm', banner: { js: '#!/usr/bin/env node' } });
await build({ ...node, entryPoints: ['src/next/index.ts'], outfile: 'dist/next.js', format: 'esm' });
await build({
  ...node,
  // Self-contained: dependencies are bundled in because CommonJS interop with ESM-first packages
  // (magic-string) is unreliable inside Next's loader runner.
  packages: 'bundle',
  entryPoints: ['src/next/loader.ts'],
  outfile: 'dist/next-loader.cjs',
  format: 'cjs',
  // loader runners call module.exports as the loader function
  footer: { js: 'module.exports = module.exports.default;' },
});
await build({ ...node, platform: 'neutral', entryPoints: ['src/next/script.ts'], outfile: 'dist/next-script.js', format: 'esm', external: ['react'], mainFields: ['module', 'main'] });

// A package with "type": "module" reads .d.ts as ES module types, so require() consumers need their own .d.cts.
const declare = (name, text) => Promise.all([writeFile(`dist/${name}.d.ts`, text), writeFile(`dist/${name}.d.cts`, text)]);

await declare(
  'vite',
  `import type { Plugin } from 'vite';

export interface BrushupOptions {
  /** How style edits are written: Tailwind utilities, inline style props, or auto-detect (default). */
  style?: 'auto' | 'inline' | 'tailwind';
  /** When the agent edits a file under the page, find elements again by their source and refuse if unsure. Default true; false trusts recorded positions. */
  strict?: boolean;
}

export default function brushup(options?: BrushupOptions): Plugin;
`,
);

await declare(
  'next',
  `export interface BrushupNextOptions {
  /** How style edits are written: Tailwind utilities, inline style props, or auto-detect (default). */
  style?: 'auto' | 'inline' | 'tailwind';
  /** When the agent edits a file under the page, find elements again by their source and refuse if unsure. Default true; false trusts recorded positions. */
  strict?: boolean;
  /** Also tag component usages (<Button>) so edits reach the usage site. Default true. */
  components?: boolean;
}

/** Wrap your Next.js config: export default withBrushup(nextConfig) */
export function withBrushup<T = any>(nextConfig?: T, options?: BrushupNextOptions): (phase: string, context?: unknown) => Promise<any>;
export default withBrushup;
`,
);

await writeFile(
  'dist/next-script.d.ts',
  `import type { ReactElement } from 'react';

/** Put <BrushupScript /> in your root layout, inside <body>. Renders nothing in production. */
export function BrushupScript(): ReactElement | null;
export default BrushupScript;
`,
);

console.log('built dist/{overlay,vite,next,next-loader,next-script,cli,mcp}');
