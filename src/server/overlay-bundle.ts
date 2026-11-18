import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The in-page overlay as a single script. A published build ships it
 * pre-bundled next to the server (`overlay.js`); when running from source
 * (tsx, tests) it is bundled on the fly.
 */
export async function overlaySource(): Promise<string> {
  try {
    return await readFile(new URL('./overlay.js', import.meta.url), 'utf8');
  } catch {
    // Only reached when running from source (tsx, tests): a published build ships dist/overlay.js. esbuild is a dev dependency.
    const { build } = await import('esbuild');
    const entry = fileURLToPath(new URL('../overlay/index.ts', import.meta.url));
    const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', target: 'es2020', minify: false });
    return result.outputFiles[0].text;
  }
}
