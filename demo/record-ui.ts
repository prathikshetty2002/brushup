/**
 * Records a walkthrough of the Brushup canvas UI and flow to demo/out/brushup-ui-demo.mp4.
 *
 * Everything is real: Chrome drives the Next.js test app with Brushup installed, and the closing diff is read from
 * the source file the edits were written to. No Claude run is involved (see record-claude.ts for that).
 *
 * Prerequisites: the Next test app with Brushup installed and `next dev` running on :3456, Chrome, ffmpeg.
 *   BRUSHUP_DEMO_NEXTAPP=/path/to/app npx tsx demo/record-ui.ts
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const NEXTAPP = process.env.BRUSHUP_DEMO_NEXTAPP ?? '';
const URL = 'http://localhost:3456/';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
const W = 1440;
const H = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE = () => path.join(NEXTAPP, 'src/app/page.tsx');

/* ---------- the real source diff shown at the end ---------- */

function diffLines(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ kind: 'same', text: b[j++] }), i++;
    else if (j >= b.length || (i < a.length && dp[i + 1][j] >= dp[i][j + 1])) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j++] });
  }
  return out.filter((l) => l.kind !== 'same');
}

const OVERLAY = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
  #demo-cap { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 8px); z-index: 2147483646; max-width: 760px; padding: 11px 20px; border-radius: 4px; background: #1d1b17; color: #f6f4ee; font: 500 17px/1.35 system-ui, sans-serif; opacity: 0; transition: opacity .3s, transform .3s; pointer-events: none; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
  #demo-cap.in { opacity: 1; transform: translate(-50%, 0); }
  #demo-cap b { color: #ff8a6a; font-weight: 600; margin-right: 8px; }
  #demo-cur { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none; transform: translate(-100px,-100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
  .demo-rip { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 3px solid #d4401f; pointer-events: none; z-index: 2147483646; animation: demorip .5s ease-out forwards; }
  @keyframes demorip { to { transform: scale(4); opacity: 0; } }
  #demo-card { position: fixed; inset: 0; z-index: 2147483645; background: #f6f4ee; color: #1d1b17; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity .5s; font-family: system-ui, sans-serif; }
  #demo-card.on { opacity: 1; }
  #demo-card h1 { font: italic 400 64px Georgia, serif; margin: 0 0 14px; } #demo-card p { font-size: 22px; color: #756f62; margin: 0 0 6px; }
  #demo-card pre { margin: 22px 0 0; font: 15px/1.7 ui-monospace, monospace; text-align: left; background: #fff; border: 1px solid #d9d4c7; padding: 16px 20px; border-radius: 4px; max-width: 1000px; overflow: hidden; }
  #demo-card .add { color: #1f7a45; background: #e6f4ec; display: block; } #demo-card .del { color: #b42318; background: #fbe9e7; display: block; }
  \`;
  document.head.append(css);
  const cap = document.createElement('div'); cap.id = 'demo-cap'; document.body.append(cap);
  const cur = document.createElement('div'); cur.id = 'demo-cur';
  cur.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.7-7.8L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.body.append(cur);
  const card = document.createElement('div'); card.id = 'demo-card'; document.body.append(card);
  window.demo = {
    cap(step, text) { cap.classList.remove('in'); void cap.offsetWidth; cap.innerHTML = (step ? '<b>' + step + '</b>' : '') + text; cap.classList.add('in'); },
    hideCap() { cap.classList.remove('in'); },
    cur(x, y) { cur.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 3) + 'px)'; },
    rip(x, y) { const r = document.createElement('div'); r.className = 'demo-rip'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.append(r); setTimeout(() => r.remove(), 600); },
    card(html) { card.innerHTML = html; card.classList.add('on'); },
  };
})();
`;

async function main() {
  if (!NEXTAPP) throw new Error('Set BRUSHUP_DEMO_NEXTAPP to the Next.js test app folder.');
  await mkdir(OUT, { recursive: true });
  if (!(await fetch(URL).then((r) => r.ok).catch(() => false))) throw new Error(`Start the app first: next dev --port 3456 (in ${NEXTAPP})`);

  const original = await readFile(PAGE(), 'utf8');
  await copyFile(path.join(HERE, 'fixtures/next-page.tsx'), PAGE());
  for (const f of ['notes.json', 'notes.md', 'edits.jsonl', 'selection.json']) await rm(path.join(NEXTAPP, '.brushup', f), { force: true });
  await sleep(2500);
  const baseline = await readFile(PAGE(), 'utf8');

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'light' });
  await context.addInitScript(() => { try { localStorage.clear(); } catch { /* none */ } });
  const page: Page = await context.newPage();

  const mp4 = path.join(OUT, 'brushup-ui-demo.mp4');
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffmpegDone = new Promise<void>((resolve) => ffmpeg.on('close', () => resolve()));
  const cdp = await context.newCDPSession(page);
  let latest: Buffer | null = null;
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    latest = Buffer.from(f.data, 'base64');
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#brushup-root', { state: 'attached', timeout: 30000 });
  await page.evaluate(OVERLAY);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const startedAt = Date.now();
  let written = 0;
  const pump = setInterval(() => {
    if (!latest) return;
    const due = Math.floor(((Date.now() - startedAt) / 1000) * 30);
    while (written < due) { ffmpeg.stdin.write(latest); written++; }
  }, 20);

  const say = (step: string, text: string) => page.evaluate(([s, t]) => (window as any).demo.cap(s, t), [step, text]);
  let [cx, cy] = [W / 2, H / 2];
  const glide = async (x: number, y: number, ms = 600) => {
    const steps = Math.max(12, Math.round(ms / 16));
    const [sx, sy] = [cx, cy];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const [px, py] = [sx + (x - sx) * e, sy + (y - sy) * e];
      await page.mouse.move(px, py);
      await page.evaluate(([a, b]) => (window as any).demo.cur(a, b), [px, py]);
      await sleep(10);
    }
    [cx, cy] = [x, y];
  };
  const ripple = () => page.evaluate(([a, b]) => (window as any).demo.rip(a, b), [cx, cy]);
  const click = async (x: number, y: number) => {
    await glide(x, y);
    await ripple();
    await page.mouse.click(x, y);
  };
  const center = async (selector: string, nth = 0) => {
    const loc = page.locator(selector).nth(nth);
    await loc.waitFor({ timeout: 15000 });
    const b = (await loc.boundingBox())!;
    return [b.x + b.width / 2, b.y + b.height / 2] as const;
  };
  const clickOn = async (selector: string, nth = 0) => click(...(await center(selector, nth)));
  const dragFrom = async (from: readonly [number, number], dx: number, dy: number, ms = 800) => {
    await glide(...from);
    await ripple();
    await page.mouse.down();
    await sleep(120);
    await glide(from[0] + dx, from[1] + dy, ms);
    await page.mouse.up();
  };
  const typeSlow = async (text: string) => page.keyboard.type(text, { delay: 55 });

  /* ---------- the flow ---------- */
  await sleep(900);
  await say('1', 'Open your own app. The Brushup panel is already there, no extra tab or app');
  await sleep(2600);

  await say('2', 'Click anything on the page to select it');
  await clickOn('h1');
  await sleep(2400);

  await say('3', 'Drag a label to scrub a value. The page previews it live');
  const size = await center('label.f:has(input[data-prop="font-size"]) span');
  await dragFrom(size, 34, 0, 1000);
  await sleep(1400);
  await say('3', 'Released: it saved as a Tailwind class, with the line-height kept');
  await sleep(2600);

  await say('4', 'Or drag the handles on the page: margin, padding, size');
  await dragFrom(await center('[data-kind="mar-t"]'), 0, -16, 700);
  await sleep(1800);

  await say('5', 'Arrow keys nudge the selection. Shift moves 10px');
  await clickOn('button:has-text("Get started")');
  await sleep(700);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+ArrowRight'); await sleep(140); }
  await sleep(1800);

  await say('6', 'Double-click text to edit it in place');
  const docs = await center('button:has-text("Read the docs")');
  await glide(...docs);
  await ripple();
  await page.mouse.dblclick(...docs);
  await sleep(500);
  await page.keyboard.press('Control+A');
  await typeSlow('See the docs');
  await page.keyboard.press('Enter');
  await sleep(2000);

  await say('7', 'Draw a box from empty space to select several elements, then move them together');
  const title = (await page.locator('h1').first().boundingBox())!;
  const lede = (await page.locator('main p').first().boundingBox())!;
  await dragFrom([120, title.y - 8], title.x + title.width + 40 - 120, lede.y + lede.height + 8 - (title.y - 8), 1300);
  await sleep(1500);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Shift+ArrowDown'); await sleep(260); }
  await sleep(2000);
  await page.keyboard.press('Control+z');
  await sleep(900);
  await page.keyboard.press('Escape');
  await sleep(500);

  await say('8', 'Pin a note for Claude. Press N on any element, section or component');
  await clickOn('main section:nth-of-type(2) > *:first-child');
  await sleep(600);
  await page.keyboard.press('n');
  await sleep(700);
  await clickOn('form.composer input[name="label"]');
  await typeSlow('Feature cards');
  await clickOn('form.composer textarea');
  await typeSlow('Tighten the gap between these cards, and make titles semibold.');
  await sleep(500);
  await clickOn('form.composer button.primary');
  await sleep(2600);

  await say('9', 'Move the panel by its header, or dock it to the other side');
  const head = await center('#brushup-root header strong');
  await dragFrom(head, -520, 90, 1000);
  await sleep(1500);
  await clickOn('[data-act="dock"]');
  await sleep(1500);

  await say('10', 'Preview hides the chrome so you can see the page as it ships');
  await clickOn('[data-mode="preview"]');
  await sleep(2400);
  await clickOn('[data-mode="edit"]');
  await sleep(1000);

  await say('11', 'Undo anything with Ctrl+Z. Nothing is ever locked in');
  await page.keyboard.press('Control+z');
  await sleep(1400);
  await page.keyboard.press('Control+Shift+z');
  await sleep(1400);

  await page.evaluate(() => ((document.getElementById('brushup-root') as HTMLElement).style.display = 'none'));
  const lines = diffLines(baseline.split('\n'), (await readFile(PAGE(), 'utf8')).split('\n'));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  await page.evaluate((html) => (window as any).demo.card(html), `<h1>All of it is in your source</h1><p>Written as small edits to the files Claude generated. Zero prompts, zero screenshots.</p><pre>${lines.slice(0, 12).map((l) => `<span class="${l.kind}">${l.kind === 'add' ? '+ ' : '- '}${esc(l.text.trim().slice(0, 110))}</span>`).join('')}</pre>`);
  await page.evaluate(() => (window as any).demo.hideCap());
  await sleep(5200);

  clearInterval(pump);
  await cdp.send('Page.stopScreencast').catch(() => {});
  ffmpeg.stdin.end();
  await ffmpegDone;
  await browser.close();
  await writeFile(PAGE(), original);
  console.log(`wrote ${mp4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
