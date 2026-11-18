// Fails if a CommonJS entry point (dist/*.cjs) require()s a dependency that is ESM-only. Node before 20.19 / 22.12
// cannot require() an ES module, so such a dependency breaks `next.config.js` users on those versions even though
// newer Node (and our own test run) hides it.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dist = path.resolve('dist');
const bad = [];
for (const file of readdirSync(dist).filter((f) => f.endsWith('.cjs'))) {
  const code = readFileSync(path.join(dist, file), 'utf8');
  const needed = new Set([...code.matchAll(/require\("([^".][^"]*)"\)/g)].map((m) => m[1]).filter((n) => !n.startsWith('node:')));
  for (const name of needed) {
    const pkgName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(path.join(path.dirname(require.resolve(`${pkgName}/package.json`)), 'package.json'), 'utf8'));
    } catch {
      pkg = JSON.parse(readFileSync(path.resolve('node_modules', pkgName, 'package.json'), 'utf8'));
    }
    const exportsText = JSON.stringify(pkg.exports ?? '');
    const esmOnly = pkg.type === 'module' && !/"require"|\.cjs/.test(exportsText) && !(pkg.main ?? '').endsWith('.cjs');
    if (esmOnly) bad.push(`${file} requires ${name}, which is ESM-only (${pkgName}@${pkg.version})`);
  }
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log('CommonJS entry points only require CommonJS-compatible dependencies');
