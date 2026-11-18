/**
 * Records a scripted demo of Ascend (static + dev-server modes) to demo/out/ascend-demo.mp4.
 *
 *   npm run build && npm run demo
 *
 * Needs Chrome (set CHROME=/path if not at /usr/bin/google-chrome-stable), ffmpeg, and a Vite + React
 * app that has the Ascend plugin (set ASCEND_DEMO_VAPP to its folder).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { startServer } from '../src/server/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORK = path.join(HERE, 'work');
const OUT = path.join(HERE, 'out');
const VAPP = process.env.ASCEND_DEMO_VAPP ?? '';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
const VITE_PORT = 5199;
const STAGE_PORT = 4400;
const W = 1600;
const H = 900;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- source diff shown beside the app ---------- */

interface Line {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
  n?: number;
}

function diffLines(a: string[], b: string[]): Line[] {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: 'same', text: b[j], n: ++j }), i++;
    else if (j >= b.length || (i < a.length && dp[i + 1][j] >= dp[i][j + 1])) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j], n: ++j });
  }
  return out;
}

function hunks(lines: Line[], context = 2): Line[] {
  const keep = lines.map((l, idx) => lines.slice(Math.max(0, idx - context), idx + context + 1).some((x) => x.kind === 'add' || x.kind === 'del'));
  const out: Line[] = [];
  keep.forEach((k, idx) => {
    if (k) out.push(lines[idx]);
    else if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap', text: '' });
  });
  return out[out.length - 1]?.kind === 'gap' ? out.slice(0, -1) : out;
}

let tracked: string[] = [];
const baselines = new Map<string, string>();

async function rebase(files = tracked) {
  tracked = files;
  baselines.clear();
  for (const f of files) baselines.set(f, await readFile(f, 'utf8'));
}

async function sourceView() {
  let best: { name: string; lines: Line[]; mtime: number } | null = null;
  for (const f of tracked) {
    const current = await readFile(f, 'utf8');
    const lines = hunks(diffLines(baselines.get(f)!.split('\n'), current.split('\n')));
    if (!lines.length) continue;
    const mtime = (await stat(f)).mtimeMs;
    if (!best || mtime > best.mtime) best = { name: path.basename(f), lines, mtime };
  }
  return best ?? { name: '', lines: [] };
}

function startStage() {
  const html = readFile(path.join(HERE, 'stage.html'));
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

/* ---------- the React app used for the dev-server scenes ---------- */

const APP_TSX = `import { useState } from 'react'
import './App.css'

const features = [
  { title: 'Drag to place', body: 'Move any element where it belongs.' },
  { title: 'Tune the details', body: 'Spacing, type and color, in place.' },
  { title: 'Stay in sync', body: 'When your agent edits code, the canvas follows.' },
]

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="flex items-center justify-between px-10 py-5 border-b border-stone-200">
        <div className="text-xl font-extrabold">Lumen</div>
        <p className="note">v2.0 preview</p>
      </header>

      <section className="max-w-2xl mx-auto px-6 pt-20 pb-12 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-4">Ship interfaces your agent drafted, polished by you.</h1>
        <p className="text-lg text-stone-600 mb-8">
          A canvas for the last ten percent.
        </p>
        <button
          className="rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white"
          onClick={() => setCount(count + 1)}
        >
          Clicked {count} times
        </button>
      </section>

      <section className="flex gap-6 max-w-4xl mx-auto px-6 pb-24">
        {features.map((f) => (
          <article key={f.title} className="flex-1 rounded-2xl border border-stone-200 bg-white p-6">
            <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
            <p className="text-stone-600">{f.body}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
`;

async function waitForHttp(url: string, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/* ---------- on-screen choreography ---------- */

let cx = 800;
let cy = 450;

const children: ChildProcess[] = [];
const killChildren = () => {
  for (const c of children) {
    try {
      process.kill(-c.pid!, 'SIGTERM');
    } catch {}
  }
};

async function main() {
  if (!VAPP) throw new Error('Set ASCEND_DEMO_VAPP to a Vite + React app folder that uses the ascend/vite plugin.');

  // Fresh workspaces so the demo is repeatable.
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });
  await mkdir(OUT, { recursive: true });
  for (const f of await readdir(path.join(ROOT, 'examples'))) await cp(path.join(ROOT, 'examples', f), path.join(WORK, f));
  await writeFile(path.join(VAPP, 'src/App.tsx'), APP_TSX);
  await rm(path.join(VAPP, '.ascend'), { recursive: true, force: true });
  await rm(path.join(WORK, '.ascend'), { recursive: true, force: true });

  const html = path.join(WORK, 'landing.html');
  const css = path.join(WORK, 'landing.css');
  const appTsx = path.join(VAPP, 'src/App.tsx');

  const stat1 = await startServer(html, 4321);
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], { cwd: VAPP, detached: true, stdio: 'ignore' });
  children.push(vite);
  await waitForHttp(`http://localhost:${VITE_PORT}/`);
  const stage = await startStage();

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page: Page = await context.newPage();

  // Record with Chrome's screencast piped into the system ffmpeg (no extra binaries needed).
  const mp4 = path.join(OUT, 'ascend-demo.mp4');
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const ffmpegDone = new Promise<void>((resolve) => ffmpeg.on('close', () => resolve()));
  let latest: Buffer | null = null;
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    latest = Buffer.from(f.data, 'base64');
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  // The screencast only emits on change, so write the latest frame at a constant 30fps against the wall clock.
  const startedAt = Date.now();
  let written = 0;
  const pump = setInterval(() => {
    if (!latest) return;
    const due = Math.floor(((Date.now() - startedAt) / 1000) * 30);
    while (written < due) {
      ffmpeg.stdin.write(latest);
      written++;
    }
  }, 20);
  const app = page.frameLocator('#app');

  const say = (step: string, text: string) => page.evaluate(([s, t]) => (window as any).setCaption(s, t), [step, text]);
  const card = (inner: string) => page.evaluate((h) => (window as any).showCard(h), inner);
  const hideCard = () => page.evaluate(() => (window as any).hideCard());

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
  const click = async (x: number, y: number, clickCount = 1) => {
    await glide(x, y);
    await ripple();
    await page.mouse.click(x, y, { clickCount });
  };
  const box = async (selector: string, nth = 0) => {
    const loc = app.locator(selector).nth(nth);
    await loc.waitFor();
    const b = await loc.boundingBox();
    if (!b) throw new Error(`no box for ${selector}`);
    return b;
  };
  const center = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2] as const;

  const setField = async (prop: string, value: string) => {
    const b = await box(`input[data-prop="${prop}"]`);
    await click(...center(b), 3);
    await sleep(250);
    await page.keyboard.type(value, { delay: 150 });
    await sleep(300);
    await page.keyboard.press('Enter');
  };
  const drag = async (from: readonly [number, number], dx: number, dy: number) => {
    await glide(...from);
    await ripple();
    await page.mouse.down();
    await sleep(150);
    await glide(from[0] + dx, from[1] + dy, 900);
    await page.mouse.up();
  };
  const loadApp = async (url: string, label: string) => {
    // Blank the frame first so we never mistake the previous page's overlay for the new one.
    await page.evaluate(() => (window as any).setApp('about:blank', ''));
    await sleep(400);
    await page.evaluate(([u, l]) => (window as any).setApp(u, l), [url, label]);
    await app.locator('h1').first().waitFor({ timeout: 30000 });
    await app.locator('#ascend-root').waitFor({ state: 'attached' });
    await sleep(2500); // let styles, HMR connection and the overlay socket settle
  };
  /** Click an element and confirm the canvas selected it (retrying if the page was still settling). */
  const selectAt = async (selector: string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await click(...center(await box(selector)));
      const ok = await app.locator('input[data-prop="font-size"]').waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
      if (ok) return;
      await sleep(1000);
    }
    throw new Error(`could not select ${selector}`);
  };

  await page.goto(`http://127.0.0.1:${STAGE_PORT}/`);
  await card('<h1>Asc<i>end</i></h1><p>Edit agent-generated UI on the canvas it generated.</p><p style="font-size:22px;color:#6b7280">A visual editor that writes back to your source, and follows your agent.</p>');
  await sleep(4500);
  await hideCard();
  await sleep(600);

  /* ===== static HTML mode ===== */
  await loadApp(stat1.url, 'Static HTML mode · landing.html');
  await rebase([html, css]);

  await say('1', 'Click any element to select it');
  await sleep(900);
  await selectAt('h1');
  await sleep(1500);

  await say('2', 'Change its size. The CSS rule is edited on disk');
  await rebase();
  await setField('font-size', '38');
  await sleep(3000);

  await say('3', 'Drag a card. It moves with margins, staying inside its layout');
  await rebase();
  const card1 = await box('article');
  await drag([card1.x + 10, card1.y + card1.height / 2], 44, 26);
  await sleep(3200);

  await say('4', 'Double-click text to edit it inline');
  await rebase();
  const title = await box('article h3');
  await glide(...center(title));
  await ripple();
  await page.mouse.dblclick(...center(title));
  await sleep(700);
  await page.keyboard.type('Drag it into place', { delay: 95 });
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(3000);

  await say('5', 'Undo with Ctrl+Z');
  await rebase();
  await sleep(700);
  await page.keyboard.press('Control+z');
  await sleep(3000);

  await say('6', 'Meanwhile your agent edits the files…');
  await rebase();
  await sleep(1200);
  await writeFile(html, (await readFile(html, 'utf8')).replace('Get started', 'Start free').replace('polished by you.', 'polished by <em>you</em>, instantly.'));
  await sleep(1400);
  await writeFile(css, (await readFile(css, 'utf8')).replace('background: #4338ca', 'background: #059669'));
  await sleep(1200);
  await say('6', 'The canvas updates live, and your selection stays');
  await sleep(3200);

  await say('7', 'Undo won’t overwrite the agent’s work');
  await rebase();
  await sleep(800);
  await page.keyboard.press('Control+z');
  await sleep(3600);

  /* ===== dev-server mode ===== */
  await say('', '');
  await card('<h1>Dev-server <i>mode</i></h1><p>React + Vite + Tailwind</p><p style="font-size:22px;color:#6b7280">One line in vite.config.ts. Edits are written into your JSX.</p>');
  await sleep(4200);
  await hideCard();
  await loadApp(`http://localhost:${VITE_PORT}/`, 'Dev-server mode · React + Vite + Tailwind');
  await rebase([appTsx]);

  await say('1', 'Select the heading in the running app');
  await selectAt('h1');
  await sleep(1400);

  await say('2', 'Tailwind project: the edit becomes a utility class');
  await rebase();
  await setField('font-size', '40');
  await sleep(3800);

  await say('3', 'Drag a card from a .map(): all three share one line of JSX');
  await rebase();
  const dev1 = await box('article');
  await drag([dev1.x + 10, dev1.y + dev1.height / 2], 36, 22);
  await sleep(3800);

  await say('4', 'Edit static text right in the JSX');
  await rebase();
  const logo = await box('div.font-extrabold');
  await glide(...center(logo));
  await ripple();
  await page.mouse.dblclick(...center(logo));
  await sleep(700);
  await page.keyboard.type('Lumen Studio', { delay: 95 });
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(3200);

  await say('5', 'Your agent edits the code. Vite hot-updates, the canvas follows');
  await rebase();
  await sleep(1200);
  await writeFile(appTsx, (await readFile(appTsx, 'utf8')).replace('A canvas for the last ten percent.', 'A canvas for the last ten percent, built for agents.').replace('bg-indigo-600', 'bg-emerald-600'));
  await sleep(4200);

  await say('', '');
  await card(
    '<h1>Asc<i>end</i></h1><ul><li>Edits write back to your HTML, CSS, JSX and Tailwind</li><li>Agent edits stream back to the canvas, live</li><li>Undo never clobbers the agent’s changes</li><li>Dev-server mode for React + Vite today</li></ul>',
  );
  await sleep(5500);

  clearInterval(pump);
  await cdp.send('Page.stopScreencast').catch(() => {});
  ffmpeg.stdin.end();
  await ffmpegDone;
  await context.close();
  await browser.close();
  await stage.close();
  await stat1.close();
  console.log(mp4);
}

main().then(
  () => (killChildren(), process.exit(0)),
  (err) => {
    console.error(err);
    killChildren();
    process.exit(1);
  },
);
