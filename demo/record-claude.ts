/**
 * Records a demo of Ascend working with Claude Code to demo/out/ascend-claude-demo.mp4.
 *
 * Everything on screen is real: the Next.js app and Ascend canvas are driven in Chrome, and Claude Code is run
 * live (headless, `claude -p`) with its actual tool calls streamed into the terminal panel. The setup commands
 * are real output captured from a fresh project beforehand and replayed at typing speed.
 *
 * Prerequisites (see docs/GUIDE.md): the Next test app with Ascend installed, `next dev` running on :3456,
 * `claude` logged in, Chrome, ffmpeg.
 *   ASCEND_DEMO_NEXTAPP=/path/to/app npx tsx demo/record-claude.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const NEXTAPP = process.env.ASCEND_DEMO_NEXTAPP ?? '';
const NEXT_URL = 'http://localhost:3456/';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
const TARBALL = path.join(ROOT, 'ascend-0.1.0.tgz');
const STAGE_PORT = 4401;
const W = 1600;
const H = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- source diff shown in the bottom-right panel ---------- */

interface Line { kind: 'same' | 'add' | 'del' | 'gap'; text: string; n?: number }

function diffLines(a: string[], b: string[]): Line[] {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Line[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: 'same', text: b[j], n: ++j }), i++;
    else if (j >= b.length || (i < a.length && dp[i + 1][j] >= dp[i][j + 1])) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j], n: ++j });
  }
  return out;
}

function hunks(lines: Line[], context = 1): Line[] {
  const keep = lines.map((_, idx) => lines.slice(Math.max(0, idx - context), idx + context + 1).some((x) => x.kind === 'add' || x.kind === 'del'));
  const out: Line[] = [];
  keep.forEach((k, idx) => {
    if (k) out.push(lines[idx]);
    else if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap', text: '' });
  });
  return out[out.length - 1]?.kind === 'gap' ? out.slice(0, -1) : out;
}

const PAGE = () => path.join(NEXTAPP, 'src/app/page.tsx');
let baseline = '';
const rebase = async () => void (baseline = await readFile(PAGE(), 'utf8'));
async function sourceView() {
  const lines = hunks(diffLines(baseline.split('\n'), (await readFile(PAGE(), 'utf8')).split('\n')));
  return { name: lines.length ? 'src/app/page.tsx' : '', lines };
}

function startStage() {
  const html = readFile(path.join(HERE, 'stage2.html'));
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/source') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify(await sourceView().catch(() => ({ name: '', lines: [] }))));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await html);
  });
  return new Promise<http.Server>((resolve) => server.listen(STAGE_PORT, '127.0.0.1', () => resolve(server)));
}

/* ---------- real setup output, captured from a fresh project ---------- */

async function captureSetup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ascend-demo-proj-'));
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  run('npm', ['init', '-y']);
  const install = run('npm', ['install', '-D', TARBALL]).split('\n').filter((l) => l && !/npm warn|install-scripts/i.test(l));
  const init = run(path.join(dir, 'node_modules/.bin/ascend'), ['init', '--mcp']).split('\n').filter(Boolean);
  await rm(dir, { recursive: true, force: true });
  return { install, init };
}

/* ---------- running Claude Code for real and rendering its events ---------- */

const rel = (p: string) => (p.startsWith(NEXTAPP) ? path.relative(NEXTAPP, p) : p);
const short = (s: string, n = 90) => (s.replace(/\s+/g, ' ').trim().length > n ? s.replace(/\s+/g, ' ').trim().slice(0, n - 1) + '…' : s.replace(/\s+/g, ' ').trim());

function changedLines(oldS: string, newS: string) {
  const a = oldS.split('\n'), b = newS.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { del: a.slice(p, a.length - s).slice(0, 2), add: b.slice(p, b.length - s).slice(0, 2) };
}

type Emit = (kind: string, text: string) => Promise<void>;

async function runClaude(prompt: string, tools: string[], maxTurns: number, emit: Emit, onCost: (usd: number | undefined) => void) {
  const args = ['-p', prompt, '--model', 'sonnet', '--mcp-config', '.mcp.json', '--strict-mcp-config', '--allowedTools', ...tools, '--permission-mode', 'acceptEdits', '--max-turns', String(maxTurns), '--no-session-persistence', '--output-format', 'stream-json', '--verbose'];
  const child = spawn('claude', args, { cwd: NEXTAPP, stdio: ['ignore', 'pipe', 'pipe'] });
  const killer = setTimeout(() => child.kill('SIGTERM'), 170_000);
  const toolNames = new Map<string, string>();
  let chain = Promise.resolve();
  const queue = (fn: () => Promise<void>) => (chain = chain.then(fn).catch(() => {}));

  const handle = (e: any) => {
    if (e.type === 'assistant') {
      for (const c of e.message.content) {
        if (c.type === 'text' && c.text.trim()) {
          for (const line of c.text.trim().split('\n').slice(0, 9)) if (line.trim()) queue(() => emit('a', line));
        } else if (c.type === 'tool_use') {
          toolNames.set(c.id, c.name);
          const input = c.input ?? {};
          if (c.name === 'ToolSearch') continue;
          if (c.name.startsWith('mcp__ascend__')) {
            const tool = c.name.replace('mcp__ascend__', '');
            const a = Object.entries(input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
            queue(() => emit('m', `ascend ▸ ${tool}(${short(a, 60)})`));
          } else if (c.name === 'Edit') {
            queue(async () => {
              await emit('t', `Edit(${rel(input.file_path)})`);
              const { del, add } = changedLines(input.old_string ?? '', input.new_string ?? '');
              for (const l of del) await emit('del', `- ${short(l.trim(), 78)}`);
              for (const l of add) await emit('add', `+ ${short(l.trim(), 78)}`);
            });
          } else {
            const target = input.file_path ? rel(input.file_path) : input.pattern ?? input.command ?? '';
            queue(() => emit('t', `${c.name}(${short(String(target), 70)})`));
          }
        }
      }
    } else if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) {
        if (c.type !== 'tool_result') continue;
        const name = toolNames.get(c.tool_use_id) ?? '';
        if (name === 'ToolSearch' || name === 'Edit') continue;
        const raw = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join(' ');
        let text = short(raw, 84);
        if (name === 'Read') text = `${raw.split('\n').length} lines`;
        if (name.startsWith('mcp__ascend__')) {
          try {
            const j = JSON.parse(raw);
            if (j.status) text = `status → ${j.status}`;
            else if (j.box) text = `${j.tag} · ${j.box.width}×${j.box.height}px · font ${j.typography?.['font-size']} · clipped: ${j.overflow?.clipped?.x || j.overflow?.clipped?.y ? 'yes' : 'no'}`;
            else if (j.selection) text = `${j.selection.tag} at ${j.selection.file}:${j.selection.line}`;
          } catch { /* keep raw text */ }
        }
        queue(() => emit('r', `↳ ${c.is_error ? 'error: ' : ''}${text}`));
      }
    } else if (e.type === 'result') {
      onCost(e.total_cost_usd);
    }
  };

  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { handle(JSON.parse(line)); } catch { /* not JSON */ }
    }
  });
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  clearTimeout(killer);
  await chain;
}

/* ---------- the demo ---------- */

let cx = 800, cy = 450;

async function main() {
  if (!NEXTAPP) throw new Error('Set ASCEND_DEMO_NEXTAPP to the Next.js test app folder.');
  await mkdir(OUT, { recursive: true });
  if (!(await fetch(NEXT_URL).then((r) => r.ok).catch(() => false))) throw new Error(`Start the app first: next dev --port 3456 (in ${NEXTAPP})`);

  // Fresh state: clean page, no notes/edits/selection (keep host.json, which the running server wrote).
  await copyFile(path.join(HERE, 'fixtures/next-page.tsx'), PAGE());
  for (const f of ['notes.json', 'notes.md', 'edits.jsonl', 'selection.json']) await rm(path.join(NEXTAPP, '.ascend', f), { force: true });
  await sleep(2500);
  await rebase();
  const setup = await captureSetup();
  const stage = await startStage();

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page: Page = await context.newPage();
  const app = page.frameLocator('#app');

  // Record Chrome's screencast through the system ffmpeg at a steady 30fps.
  const mp4 = path.join(OUT, 'ascend-claude-demo.mp4');
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffmpegDone = new Promise<void>((resolve) => ffmpeg.on('close', () => resolve()));
  let latest: Buffer | null = null;
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    latest = Buffer.from(f.data, 'base64');
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const startedAt = Date.now();
  let written = 0;
  const pump = setInterval(() => {
    if (!latest) return;
    const due = Math.floor(((Date.now() - startedAt) / 1000) * 30);
    while (written < due) { ffmpeg.stdin.write(latest); written++; }
  }, 20);

  const say = (step: string, text: string) => page.evaluate(([s, t]) => (window as any).setCaption(s, t), [step, text]);
  const card = (inner: string) => page.evaluate((h) => (window as any).showCard(h), inner);
  const hideCard = () => page.evaluate(() => (window as any).hideCard());
  const meter = (html: string, mode = '') => page.evaluate(([h, m]) => (window as any).setMeter(h, m), [html, mode]);
  const term = {
    clear: (title = 'terminal · my-app') => page.evaluate((t) => ((window as any).termClear(), (window as any).termTitle(t)), title),
    line: (kind: string, text: string) => page.evaluate(([k, t]) => (window as any).termLine(k, t), [kind, text]),
    type: (kind: string, text: string, cps = 38) => page.evaluate(([k, t, c]) => (window as any).termType(k, t, c), [kind, text, cps] as const),
  };
  const snippet = (name: string, lines: string[]) => page.evaluate(([n, l]) => (window as any).setSnippet(n, (l as string[]).map((text) => ({ kind: 'add', text }))), [name, lines] as const);
  const clearSnippet = () => page.evaluate(() => (window as any).clearSnippet());

  const glide = async (x: number, y: number, ms = 650) => {
    const steps = Math.max(14, Math.round(ms / 16));
    const [sx, sy] = [cx, cy];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const [px, py] = [sx + (x - sx) * e, sy + (y - sy) * e];
      await page.mouse.move(px, py);
      await page.evaluate(([a, b]) => (window as any).moveCursor(a, b), [px, py]);
      await sleep(10);
    }
    [cx, cy] = [x, y];
  };
  const ripple = () => page.evaluate(([a, b]) => (window as any).ripple(a, b), [cx, cy]);
  const click = async (x: number, y: number, opts: { shift?: boolean } = {}) => {
    await glide(x, y);
    await ripple();
    if (opts.shift) await page.keyboard.down('Shift');
    await page.mouse.click(x, y);
    if (opts.shift) await page.keyboard.up('Shift');
  };
  const box = async (selector: string, nth = 0) => {
    const loc = app.locator(selector).nth(nth);
    await loc.waitFor({ timeout: 15000 });
    const b = await loc.boundingBox();
    if (!b) throw new Error(`no box for ${selector}`);
    return b;
  };
  const center = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2] as const;
  const drag = async (from: readonly [number, number], dx: number, dy: number) => {
    await glide(...from);
    await ripple();
    await page.mouse.down();
    await sleep(120);
    await glide(from[0] + dx, from[1] + dy, 900);
    await page.mouse.up();
  };
  const grab = async (kind: string, dx: number, dy: number) => drag(center(await box(`[data-kind="${kind}"]`)), dx, dy);

  await page.goto(`http://127.0.0.1:${STAGE_PORT}/`);

  /* title */
  await card('<h1>Asc<i>end</i> + Claude Code</h1><p>Make the small UI changes yourself, instantly.</p><p style="color:#6b7280;font-size:22px">Brief Claude with notes, not screenshots.</p>');
  await sleep(5000);
  await hideCard();
  await sleep(500);

  /* 1. setup (real output, replayed) */
  await say('1', 'One-time setup in your Next.js project');
  await term.clear('terminal · my-app');
  await term.type('s', 'npm install -D ./ascend-0.1.0.tgz', 55);
  for (const l of setup.install.slice(-2)) await term.line('o', l);
  await sleep(500);
  await term.type('s', 'npx ascend init --mcp', 55);
  for (const l of setup.init) { await term.line('o', l); await sleep(250); }
  await snippet('next.config.ts', ['import { withAscend } from "ascend/next";', '', 'export default withAscend(nextConfig);']);
  await sleep(3200);
  await snippet('app/layout.tsx', ['import { AscendScript } from "ascend/next/script";', '', '<body>', '  {children}', '  <AscendScript />', '</body>']);
  await sleep(3800);
  await clearSnippet();

  /* 2. run the app */
  await say('2', 'Run your app as usual. The Ascend panel appears on the page');
  await term.type('s', 'npm run dev', 55);
  await term.line('o', '▲ Next.js 16.4  ·  Local: http://localhost:3456');
  await page.evaluate((u) => (window as any).setApp(u), NEXT_URL);
  await app.locator('#ascend-root').waitFor({ state: 'attached', timeout: 30000 });
  await app.locator('h1').first().waitFor({ timeout: 30000 });
  await sleep(2500);

  /* 3. trivial changes: no Claude */
  await term.clear('claude · my-app');
  await term.line('o', 'claude is idle. Nothing below needs a prompt.');
  await meter('Claude prompts: <b>0</b> · tokens: <b>0</b>', 'zero');
  await say('3', 'Small changes: do them by hand. No prompt, no screenshot, no tokens');
  await sleep(1200);
  await rebase();

  await say('3a', 'Resize a card. The handle writes a Tailwind class, snapped to 4px');
  const c1 = await box('[data-slot=card]');
  await click(c1.x + 10, c1.y + 6);
  await sleep(900);
  await grab('resize-e', -36, 0);
  await sleep(3000);

  await say('3b', 'The three cards share one line of JSX, so all three change');
  await sleep(2600);
  await rebase();

  await say('3c', 'Padding handle (green): drag inward to grow it');
  await grab('pad-l', 16, 0);
  await sleep(3000);
  await rebase();

  await say('3d', 'Shift+click two buttons, then nudge both: one edit, one undo');
  const b1 = await box('button:has-text("Get started")');
  await click(...center(b1));
  const b2 = await box('button:has-text("Read the docs")');
  await click(...center(b2), { shift: true });
  await sleep(700);
  await page.keyboard.press('Shift+ArrowDown');
  await sleep(500);
  await page.keyboard.press('Shift+ArrowDown');
  await sleep(3200);
  await rebase();

  await say('3e', 'Double-click text to rewrite it in place');
  const notify = await box('button:has-text("Notify me")');
  await glide(...center(notify));
  await ripple();
  await page.mouse.dblclick(...center(notify));
  await sleep(600);
  await page.keyboard.type('Get early access', { delay: 85 });
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(3200);

  /* 4. notes */
  await say('4', 'Need Claude? Pin a note on what you mean: element, section or component');
  await rebase();
  const h1 = await box('h1');
  await click(h1.x + 40, h1.y + h1.height / 2);
  await sleep(700);
  await page.keyboard.press('n');
  await sleep(600);
  await app.locator('form.composer select[name=kind]').selectOption('section');
  await app.locator('form.composer input[name=label]').click();
  await page.keyboard.type('Hero', { delay: 80 });
  await app.locator('form.composer textarea').click();
  await page.keyboard.type('Heading feels cramped under the badge. Add more space above it and make it a little smaller on mobile.', { delay: 22 });
  await sleep(500);
  await app.locator('form.composer button[type=submit]').click();
  await sleep(1500);

  const cta = await box('button:has-text("Get started")');
  await click(...center(cta));
  await sleep(600);
  await page.keyboard.press('n');
  await sleep(600);
  await app.locator('form.composer input[name=label]').click();
  await page.keyboard.type('Primary CTA', { delay: 80 });
  await app.locator('form.composer textarea').click();
  await page.keyboard.type('Make the primary button more prominent: a bit larger text and more horizontal padding.', { delay: 22 });
  await sleep(500);
  await app.locator('form.composer button[type=submit]').click();
  await sleep(2600);

  /* 5. Claude Code handles the notes (real run) */
  await say('5', 'Tell Claude Code to handle the notes. It reads them, finds the file and line, and edits');
  await rebase();
  await term.clear('claude · my-app');
  await term.type('u', 'Handle the open Ascend design notes for this project.', 42);
  await meter('Claude prompts: <b>1</b> · working…', 'busy');
  let cost: number | undefined;
  await runClaude(
    'Handle the open Ascend design notes for this project.',
    ['mcp__ascend__ascend_get_notes', 'mcp__ascend__ascend_update_note', 'mcp__ascend__ascend_get_selection', 'mcp__ascend__ascend_recent_edits', 'mcp__ascend__ascend_inspect', 'Read', 'Edit', 'Glob', 'Grep'],
    14,
    (k, t) => term.line(k, t).then(() => undefined),
    (usd) => (cost = usd),
  );
  await meter(`Claude prompts: <b>1</b>${cost ? ` · $${cost.toFixed(2)}` : ''}`, 'zero');
  await say('5', 'Both notes handled and marked done. Your hand edits are still there');
  await sleep(5500);

  /* 6. ask the live canvas instead of sending a screenshot */
  await say('6', 'No screenshots: Claude asks the live canvas how an element renders');
  await rebase();
  const h1b = await box('h1');
  await click(h1b.x + 40, h1b.y + h1b.height / 2);
  await sleep(1000);
  await term.clear('claude · my-app');
  const q = 'Using the Ascend tools: how wide is the element I have selected, does it overflow, and what font size is it? Do not edit anything.';
  await term.type('u', q, 70);
  await meter('Claude prompts: <b>2</b> · working…', 'busy');
  let cost2: number | undefined;
  await runClaude(
    q,
    ['mcp__ascend__ascend_get_selection', 'mcp__ascend__ascend_inspect'],
    6,
    (k, t) => term.line(k, t).then(() => undefined),
    (usd) => (cost2 = usd),
  );
  await meter(`Claude prompts: <b>2</b>${cost2 ? ` · $${(cost2 + (cost ?? 0)).toFixed(2)} total` : ''}`, 'zero');
  await sleep(5500);

  /* closing */
  await say('', '');
  await card('<h1>Asc<i>end</i></h1><ul><li>Small changes by hand: resize, spacing, move, text. Zero prompts</li><li>Notes tell Claude exactly what you mean, and where</li><li>Claude reads notes, edits the right line, marks them done</li><li>Claude asks the live canvas instead of needing screenshots</li></ul>');
  await sleep(6500);

  clearInterval(pump);
  await cdp.send('Page.stopScreencast').catch(() => {});
  ffmpeg.stdin.end();
  await ffmpegDone;
  await context.close();
  await browser.close();
  await stage.close();
  console.log(mp4);
}

main().then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
