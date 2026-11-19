/**
 * A rough, conservative estimate of the tokens a canvas edit saves: what it would have cost to ask an agent for the same tweak.
 * It is an estimate and is always shown as one. Brushup never sees the agent's side, so nothing here is measured.
 *
 * What one "ask the agent" round trip adds, counting only the new tokens it carries:
 *  - prompt:     a sentence or two describing the tweak, about 100 tokens.
 *  - screenshot: Anthropic's vision docs give 1,560 tokens for a 1920x1080 screenshot (standard tier; 2,691 on the high-resolution
 *                tier), from ⌈width/28⌉ × ⌈height/28⌉ visual tokens. Only visual tweaks need one.
 *  - file read:  the agent reads the component first. Published estimates for a ~300-line file are 1,200 to 2,000 tokens
 *                (blog measurements, not controlled), so 1,500.
 *  - reply:      the edit itself and a short answer, about 300 tokens.
 *  - thinking:   the agent reasons before acting, and thinking is billed as output. Anthropic publishes no average (adaptive
 *                thinking decides per request, and on easy requests may skip it); its docs suggest starting a simple task's budget
 *                at the 1,024-token minimum, and one small public test of a rename found only a handful of thinking tokens. 500
 *                is a middle assumption, and the least certain figure here.
 *  - process:    the extra tool calls an agent makes around the edit: finding the file and checking the result. Three calls at
 *                about 150 tokens of call overhead each (public estimates run 50 to 200) plus about 400 tokens of search output.
 * Not counted, so the real saving is larger: the whole conversation is re-sent with every request (one logging-proxy test found
 * about 33k tokens of fixed overhead per request; Anthropic's cost docs describe the re-sending, and its tool-use docs list a
 * 286 to 354 token tool-use system prompt per request), and the follow-up "a bit more to the left" rounds that visual tweaks
 * usually take.
 *
 * Sources: platform.claude.com/docs/en/build-with-claude/vision (image tokens); platform.claude.com/docs/en/build-with-claude/
 * extended-thinking (thinking is billed as output; budgets); code.claude.com/docs/en/costs (the full conversation is sent with
 * every request); the file-read, tool-call and overhead figures are from public blog measurements.
 */
export const TOKENS = { prompt: 100, screenshot: 1560, fileRead: 1500, reply: 300, thinking: 500, process: 850 } as const;

/** A text, delete, duplicate or image edit is described in words; a style, move or wrap one is described by looking (and needs a screenshot). */
export const SIMPLE_TOKENS = TOKENS.prompt + TOKENS.fileRead + TOKENS.reply + TOKENS.thinking + TOKENS.process;
export const VISUAL_TOKENS = SIMPLE_TOKENS + TOKENS.screenshot;

/** Edits to the same element this close together are one tweak (a nudge held down, a drag then a fix), not many prompts. */
export const SAME_TWEAK_MS = 30_000;

const VISUAL_KINDS = new Set(['style', 'moveUp', 'moveDown', 'wrap']);

export interface LogEntry {
  at?: string;
  edit?: { kind?: string; id?: string };
  edits?: { kind?: string; id?: string }[];
  undo?: unknown;
  redo?: unknown;
}

export interface Savings {
  /** Tweaks: edits grouped as described above, with undone ones removed. */
  changes: number;
  /** Individual canvas edits behind them. */
  edits: number;
  /** The estimate. */
  tokens: number;
}

interface Action {
  t: number;
  visual: boolean;
  key: string;
  edits: number;
}

/** Read an edit log (JSON lines), skipping any line that is not valid. */
export function parseLog(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object') out.push(e);
    } catch {
      /* a corrupt line is skipped */
    }
  }
  return out;
}

/**
 * The estimate for the edits in `log` made at or after `since` (ms since the epoch). An undone edit does not count, and a redo
 * brings it back, the way the canvas's own history does.
 */
export function estimateSavings(log: LogEntry[], since = 0): Savings {
  const done: Action[] = [];
  const undone: Action[] = [];
  for (const e of log) {
    const list = e.edits ?? (e.edit ? [e.edit] : []);
    const t = e.at ? Date.parse(e.at) : NaN;
    if (list.length && Number.isFinite(t)) {
      done.push({ t, visual: list.some((x) => VISUAL_KINDS.has(String(x.kind))), key: String(list[0].id ?? ''), edits: list.length });
      undone.length = 0;
    } else if ('undo' in e) {
      const a = done.pop();
      if (a) undone.push(a);
    } else if ('redo' in e) {
      const a = undone.pop();
      if (a) done.push(a);
    }
  }
  let changes = 0;
  let edits = 0;
  let tokens = 0;
  let last: { key: string; t: number; visual: boolean } | null = null;
  for (const a of done.filter((x) => x.t >= since)) {
    edits += a.edits;
    const same = last && last.key === a.key && a.t - last.t <= SAME_TWEAK_MS;
    if (same) {
      // Part of the same tweak: it only adds a screenshot's worth if the tweak turned visual.
      if (a.visual && !last!.visual) tokens += TOKENS.screenshot;
      last = { key: a.key, t: a.t, visual: last!.visual || a.visual };
    } else {
      changes++;
      tokens += a.visual ? VISUAL_TOKENS : SIMPLE_TOKENS;
      last = { key: a.key, t: a.t, visual: a.visual };
    }
  }
  return { changes, edits, tokens };
}

/** A token count as `1.9k` or `31k`, and anything under a thousand to the nearest ten. */
export function roundTokens(n: number): string {
  if (n < 1000) return String(Math.round(n / 10) * 10);
  return n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(n / 1000)}k`;
}
