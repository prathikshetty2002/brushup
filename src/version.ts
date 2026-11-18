import { createRequire } from 'node:module';

/** The installed package's version, read from its package.json (dist/ and src/ sit at different depths). */
export const VERSION: string = (() => {
  const require = createRequire(import.meta.url);
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const pkg = require(rel) as { name?: string; version?: string };
      if (pkg.name === 'brushup' && pkg.version) return pkg.version;
    } catch {
      /* try the next location */
    }
  }
  return 'unknown';
})();
