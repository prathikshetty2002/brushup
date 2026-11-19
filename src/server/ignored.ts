import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A check the user dismissed, kept with the project in `.brushup/ignored-checks.json` so it stays dismissed across
 * sessions, ports and browsers. `one` is a single finding (a rule on one element); `kind` is every finding of a rule.
 */
export interface IgnoredCheck {
  key: string;
  scope: 'one' | 'kind';
  rule: string;
  /** What the user sees in the Ignored list: the element for `one`, the rule's name for `kind`. */
  label: string;
  /** Where it was dismissed, so one finding on /pricing doesn't hide the same element on /about. Empty for `kind`. */
  page: string;
  at: string;
}

const clip = (v: unknown, max: number) =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, max);

/** Accepts untrusted input from the canvas and returns a well-formed entry, or null. */
export function sanitizeIgnored(raw: unknown): IgnoredCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = clip(r.key, 400).trim();
  const rule = clip(r.rule, 60).trim();
  if (!key || !rule) return null;
  return { key, scope: r.scope === 'kind' ? 'kind' : 'one', rule, label: clip(r.label, 200).trim() || rule, page: clip(r.page, 300), at: new Date().toISOString() };
}

export class IgnoredStore {
  private readonly dir: string;
  private readonly file: string;

  constructor(readonly root: string) {
    this.dir = path.join(root, '.brushup');
    this.file = path.join(this.dir, 'ignored-checks.json');
  }

  async list(): Promise<IgnoredCheck[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(parsed) ? parsed.map(sanitizeIgnored).filter((i): i is IgnoredCheck => !!i) : [];
    } catch {
      return [];
    }
  }

  private async write(items: IgnoredCheck[]) {
    await mkdir(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `.ignored-checks.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(items, null, 2) + '\n');
    await rename(tmp, this.file);
  }

  async add(raw: unknown): Promise<IgnoredCheck[]> {
    const item = sanitizeIgnored(raw);
    if (!item) throw new Error('Nothing to ignore.');
    const items = (await this.list()).filter((i) => i.key !== item.key);
    items.push(item);
    await this.write(items);
    return items;
  }

  async remove(key: string): Promise<IgnoredCheck[]> {
    const items = (await this.list()).filter((i) => i.key !== key);
    await this.write(items);
    return items;
  }
}
