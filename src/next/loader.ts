import path from 'node:path';
import { instrument } from '../core/jsx';
import { projectRelative } from '../core/paths';

interface LoaderContext {
  resourcePath: string;
  rootContext?: string;
  getOptions?: () => { root?: string; usage?: boolean };
  callback(err: Error | null, content?: string, map?: unknown): void;
}

/**
 * Webpack-style loader (also run by Turbopack via `turbopack.rules`) that tags
 * JSX with source locations, in development only. Runs on the original TS/JSX
 * source, before any other transform.
 */
function brushupLoader(this: LoaderContext, source: string, map?: unknown) {
  const options = this.getOptions?.() ?? {};
  const file = this.resourcePath;
  const root = options.root ?? this.rootContext ?? process.cwd();
  const rel = projectRelative(root, file);
  if (!/\.[jt]sx$/.test(file) || rel === null || file.includes(`${path.sep}node_modules${path.sep}`)) {
    return this.callback(null, source, map);
  }
  const out = instrument(source, file, rel, { usage: options.usage !== false });
  if (!out) return this.callback(null, source, map);
  this.callback(null, out.code, JSON.parse(out.map.toString()));
}

export default brushupLoader;
