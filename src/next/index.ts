import { fileURLToPath } from 'node:url';
import type { DevOptions } from '../server/dev-project';
import { startDevHost } from '../server/dev-host';
import { pidAlive, readHostFile } from '../server/host-file';

export interface BrushupNextOptions extends DevOptions {
  /** Also tag component usages (`<Button>`) so edits reach the usage site. Default true. */
  components?: boolean;
}

const LOADER = fileURLToPath(new URL('./next-loader.cjs', import.meta.url));
const DEV_PHASE = 'phase-development-server';

interface HostAddress {
  wsUrl: string;
  overlayUrl: string;
}

async function reachable(overlayUrl: string): Promise<boolean> {
  try {
    return (await fetch(overlayUrl, { method: 'HEAD', signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

/**
 * Next evaluates its config more than once (and again on every config edit), so
 * the edit server is shared: reuse the running one recorded in `.brushup/host.json`,
 * start one only when none answers.
 */
async function ensureHost(root: string, options: DevOptions): Promise<HostAddress> {
  const known = await readHostFile(root);
  if (known && known.mode === 'dev' && pidAlive(known.pid)) {
    const overlayUrl = known.wsUrl.replace(/^ws:/, 'http:').replace(/\/__brushup\/ws.*$/, '/__brushup/overlay.js');
    if (await reachable(overlayUrl)) return { wsUrl: known.wsUrl, overlayUrl };
  }
  const host = await startDevHost(root, options); // writes .brushup/host.json
  return { wsUrl: host.wsUrl, overlayUrl: host.overlayUrl };
}

type Rule = { loaders?: unknown[]; [key: string]: unknown };

/**
 * Wrap your Next.js config:  `export default withBrushup(nextConfig)`.
 * In `next dev` it tags JSX with source locations (Turbopack and webpack), starts the loopback edit server and
 * exposes its address to `<BrushupScript />`. In `next build` and production it does nothing.
 */
export function withBrushup(nextConfig: any = {}, options: BrushupNextOptions = {}) {
  return async (phase: string, context?: unknown) => {
    const base = typeof nextConfig === 'function' ? await nextConfig(phase, context) : nextConfig;
    if (phase !== DEV_PHASE) return base;

    const root = process.cwd();
    const host = await ensureHost(root, options);
    const boot = JSON.stringify({ overlay: host.overlayUrl, ws: host.wsUrl });
    process.env.NEXT_PUBLIC_BRUSHUP = boot; // server-side renders in this process (and its children) read it directly

    const use = { loader: LOADER, options: { root, usage: options.components !== false } };
    const rules: Record<string, Rule> = { ...(base.turbopack?.rules ?? {}) };
    for (const glob of ['*.tsx', '*.jsx']) {
      const existing = rules[glob] ?? {};
      // Loaders run last-to-first: ours goes last so it sees the original source.
      rules[glob] = { ...existing, loaders: [...(existing.loaders ?? []), use] };
    }

    return {
      ...base,
      env: { ...base.env, NEXT_PUBLIC_BRUSHUP: boot },
      turbopack: { ...base.turbopack, rules },
      webpack(config: any, ctx: any) {
        const out = typeof base.webpack === 'function' ? base.webpack(config, ctx) : config;
        out.module.rules.push({ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: [use] });
        return out;
      },
    };
  };
}

export default withBrushup;
