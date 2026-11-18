// Installs the packed package into a throwaway project and type-checks how a user would import it, for both
// require() (a .cts file) and import (a .mts file), under node16 and bundler module resolution. Catches a missing
// .d.cts, types that disagree with the exports map, and options that exist at runtime but not in the types.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = process.cwd();
const dir = mkdtempSync(path.join(tmpdir(), 'brushup-types-'));
const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
const fail = (what, out) => {
  console.error(`FAIL ${what}\n${out}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
};

const pack = spawnSync('npm', ['pack', repo, '--pack-destination', dir], { encoding: 'utf8' });
const tarball = pack.stdout.trim().split('\n').pop();
run('npm', ['init', '-y']);
if (run('npm', ['install', path.join(dir, tarball), '--no-audit', '--no-fund']).status !== 0) fail('install', 'npm install failed');
// The Vite and React types come from this repo's dev dependencies.
mkdirSync(path.join(dir, 'node_modules/@types'), { recursive: true });
for (const [name, from] of [['vite', 'vite'], ['react', 'react'], ['@types/node', '@types/node'], ['@types/react', '@types/react']]) {
  try {
    symlinkSync(path.join(repo, 'node_modules', from), path.join(dir, 'node_modules', name), 'dir');
  } catch {
    /* already installed as a dependency of the package */
  }
}

writeFileSync(path.join(dir, 'cjs.cts'), `import brushup = require('brushup/vite');
import next = require('brushup/next');
export const a = brushup.default({ style: 'tailwind', strict: false });
export const b = next.withBrushup({}, { components: false, strict: true });
// @ts-expect-error unknown options are rejected for require() users too
brushup.default({ nope: true });
`);
writeFileSync(path.join(dir, 'esm.mts'), `import brushup from 'brushup/vite';
import { withBrushup } from 'brushup/next';
import { BrushupScript } from 'brushup/next/script';
export const a = brushup({ strict: false });
export const b = withBrushup({}, { style: 'inline' });
export const c = BrushupScript();
// @ts-expect-error unknown options are rejected
brushup({ nope: true });
`);

const tsc = path.join(repo, 'node_modules/typescript/bin/tsc');
for (const [name, module, resolution, files] of [['node16', 'node16', 'node16', ['cjs.cts', 'esm.mts']], ['bundler', 'esnext', 'bundler', ['esm.mts']]]) {
  writeFileSync(path.join(dir, `tsconfig.${name}.json`), JSON.stringify({ compilerOptions: { module, moduleResolution: resolution, target: 'es2022', strict: true, noEmit: true, skipLibCheck: true, types: ['node'] }, files }));
  const r = run('node', [tsc, '-p', `tsconfig.${name}.json`]);
  if (r.status !== 0) fail(`type-check under ${name} resolution`, r.stdout + r.stderr);
  console.log(`ok   types resolve under ${name} resolution`);
}
rmSync(dir, { recursive: true, force: true });
