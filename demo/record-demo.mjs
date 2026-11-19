/**
 * Records the README demo: Brushup on the Cadence example site, start to finish, in real Chrome.
 * Everything on screen is real: the edits are written to the example's source and the diff at the end is read back
 * from git. The cursor, the click ripples and the captions are drawn on top of the page for the recording only.
 *
 * Prerequisites: `npm install && npx vite --port 5301` running in examples/cadence, Google Chrome, ffmpeg.
 *   node demo/record-demo.mjs        # writes demo/out/brushup-demo.mp4
 * It edits the example's files; the last step puts them back with `git checkout`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const APP = path.join(REPO, 'examples', 'cadence');
const OUT = path.join(HERE, 'out');
const URL = process.env.CADENCE_URL ?? 'http://localhost:5301/';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
const W = 1600;
const H = 900;
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The things drawn over the page for the recording: a cursor, click ripples, captions and a closing card. */
const OVERLAY = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
  #demo-cap { position: fixed; left: 50%; top: 82px; transform: translate(-50%, -10px); z-index: 2147483647; max-width: 900px; padding: 12px 22px; border-radius: 10px; background: rgba(22,24,29,.94); color: #fff; font: 500 19px/1.35 Inter, system-ui, sans-serif; opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; text-align: center; box-shadow: 0 12px 34px rgba(0,0,0,.28); }
  #demo-cap.in { opacity: 1; transform: translate(-50%, 0); }
  #demo-cap b { color: #ff8f6e; font-weight: 600; margin-right: 10px; }
  #demo-cur { position: fixed; left: 0; top: 0; width: 28px; height: 28px; z-index: 2147483647; pointer-events: none; transform: translate(-100px,-100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
  .demo-rip { position: fixed; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 3px solid #c73a19; pointer-events: none; z-index: 2147483647; animation: demorip .55s ease-out forwards; }
  @keyframes demorip { to { transform: scale(4.2); opacity: 0; } }
  #demo-card { position: fixed; inset: 0; z-index: 2147483647; background: #faf8f3; color: #1d1b17; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity .6s; font-family: Inter, system-ui, sans-serif; text-align: center; }
  #demo-card.on { opacity: 1; }
  #demo-card h1 { font: italic 600 84px/1 Georgia, 'Times New Roman', serif; margin: 0 0 22px; letter-spacing: -.02em; }
  #demo-card h1 i { color: #c73a19; font-style: italic; }
  #demo-card p { font-size: 26px; color: #5f5a4e; margin: 0 0 34px; }
  #demo-card code { font: 500 22px ui-monospace, 'SF Mono', monospace; background: #fff; border: 1px solid #e2ddd0; padding: 14px 24px; border-radius: 10px; color: #1d1b17; }
  \`;
  document.head.append(css);
  const host = document.documentElement; // after the Brushup panel in the page, so these paint over it
  const cap = document.createElement('div'); cap.id = 'demo-cap'; host.append(cap);
  const cur = document.createElement('div'); cur.id = 'demo-cur';
  cur.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.7-7.8L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  host.append(cur);
  const card = document.createElement('div'); card.id = 'demo-card'; host.append(card);
  window.demo = {
    cap(step, text) { cap.classList.remove('in'); void cap.offsetWidth; cap.innerHTML = (step ? '<b>' + step + '</b>' : '') + text; cap.classList.add('in'); },
    hideCap() { cap.classList.remove('in'); },
    cur(x, y) { cur.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)'; },
    rip(x, y) { const r = document.createElement('div'); r.className = 'demo-rip'; r.style.left = x + 'px'; r.style.top = y + 'px'; host.append(r); setTimeout(() => r.remove(), 650); },
    card(html) { card.innerHTML = html; card.classList.add('on'); },
  };
})();
`;

await mkdir(OUT, { recursive: true });
if (!(await fetch(URL).then((r) => r.ok).catch(() => false))) throw new Error(`Start the example first: npx vite --port 5301 (in ${APP})`);
const reset = () => Promise.all(['notes.json', 'notes.md', 'edits.jsonl', 'ignored-checks.json'].map((f) => rm(path.join(APP, '.brushup', f), { force: true })));
await reset();

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'light' });
await context.addInitScript(() => { try { localStorage.clear(); } catch { /* none */ } });
const page = await context.newPage();

const mp4 = path.join(OUT, 'brushup-demo.mp4');
const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffmpegDone = new Promise((resolve) => ffmpeg.on('close', () => resolve()));
const cdp = await context.newCDPSession(page);
let latest = null;
cdp.on('Page.screencastFrame', (f) => {
  latest = Buffer.from(f.data, 'base64');
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.locator('[data-tab=style]').waitFor();
await page.evaluate(() => document.fonts.ready);
await page.evaluate(OVERLAY);
await sleep(800);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const startedAt = Date.now();
let written = 0;
const pump = setInterval(() => {
  if (!latest) return;
  const due = Math.floor(((Date.now() - startedAt) / 1000) * FPS);
  while (written < due) {
    ffmpeg.stdin.write(latest);
    written++;
  }
}, 15);

/* ---- helpers: a cursor that glides, clicks that ripple, captions, smooth scrolling ---- */
const say = (step, text) => {
  console.log(`${((Date.now() - startedAt) / 1000).toFixed(1)}s  ${step}: ${text}`);
  return page.evaluate(([s, t]) => window.demo.cap(s, t), [step, text]);
};
const hush = () => page.evaluate(() => window.demo.hideCap());
let [cx, cy] = [W / 2, H / 2];
const glide = async (x, y, ms = 650) => {
  const steps = Math.max(14, Math.round(ms / 16));
  const [sx, sy] = [cx, cy];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const [px, py] = [sx + (x - sx) * e, sy + (y - sy) * e];
    await page.mouse.move(px, py);
    await page.evaluate(([a, b]) => window.demo.cur(a, b), [px, py]);
    await sleep(10);
  }
  [cx, cy] = [x, y];
};
const ripple = () => page.evaluate(([a, b]) => window.demo.rip(a, b), [cx, cy]);
const centerOf = async (loc) => {
  await loc.waitFor({ timeout: 15000 });
  const b = await loc.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
const click = async (loc, offset = [0, 0], opts = {}) => {
  const [x, y] = await centerOf(loc);
  await glide(x + offset[0], y + offset[1]);
  await ripple();
  await page.mouse.click(x + offset[0], y + offset[1], opts);
};
const clickCorner = async (loc, inset = 14) => {
  const b = await loc.boundingBox();
  await glide(b.x + inset, b.y + inset);
  await ripple();
  await page.mouse.click(b.x + inset, b.y + inset);
};
const doubleClick = async (loc) => {
  const [x, y] = await centerOf(loc);
  await glide(x, y);
  await ripple();
  await page.mouse.dblclick(x, y);
};
const scrollTo = async (selector, align = 0.38) => {
  await page.evaluate(([sel, a]) => {
    const el = document.querySelector(sel);
    const top = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * a;
    window.scrollTo({ top, behavior: 'smooth' });
  }, [selector, align]);
  await sleep(1100);
};
const tab = async (name) => click(page.locator(`[data-tab=${name}]`));
const type = (text, delay = 55) => page.keyboard.type(text, { delay });

/* ---- the story ---- */
await sleep(1200);
await say('Cadence', 'A real React + Tailwind site. Brushup is running on it.');
await sleep(2600);

// 1. select, retype
await say('1', 'Click anything to select it.');
await click(page.locator('h1'));
await sleep(1700);
await say('2', 'Double-click to retype it. Written straight to your JSX.');
await doubleClick(page.locator('h1'));
await sleep(500);
await page.keyboard.press('Control+A');
await sleep(250);
await type('Your team’s week, on one page.');
await sleep(500);
await page.keyboard.press('Enter');
await sleep(2200);

// 2. resize a button with the style panel
await say('3', 'Resize, space, recolour. It writes Tailwind classes, not inline styles.');
await click(page.locator('#product a', { hasText: 'Start free' }));
await sleep(1300);
await click(page.locator('[data-prop="height"]'));
await page.keyboard.press('Control+A');
await sleep(200);
await type('56', 90);
await page.keyboard.press('Enter');
await sleep(2600);

// 3. structure: swap the two buttons, delete the badge, undo it
await say('4', 'Reorder with Alt + arrows. Delete anything, and undo it.');
await click(page.locator('#product a', { hasText: 'See how teams use it' }));
await sleep(1300);
await page.keyboard.press('Alt+ArrowUp');
await sleep(2600);
await click(page.locator('#product span', { hasText: 'New: weekly rituals' }));
await sleep(1100);
await page.keyboard.press('Delete');
await sleep(2200);
await click(page.locator('.undo'));
await sleep(2200);

// 4. checks
await say('5', 'Checks finds real problems, and says which standard each comes from.');
await tab('a11y');
await sleep(1500);
await click(page.locator('.a11yhead').first());
await sleep(2600);
await say('6', 'One click fixes it. Written to your source.');
await click(page.locator('.a11ybody .apply').first());
await sleep(2500);

// 5. alt text
await say('7', 'A photo with no alt text? Write it right here.');
await click(page.locator('.a11yhead', { hasText: 'maya.svg' }));
await sleep(1300);
await click(page.getByRole('button', { name: 'Write alt text' }));
await sleep(1100);
await type('Maya Kowalski, Head of Product at Fieldstone', 42);
await page.keyboard.press('Enter');
await sleep(2400);

// 6. the diff
await say('8', 'Every edit is a small change to your files. Here is the diff.');
await tab('changes');
await sleep(1500);
await click(page.locator('.chfile summary').first());
await sleep(3600);
await hush();

// closing card
await page.evaluate(() => window.demo.card('<h1>Brushup<i>.</i></h1><p>Edit the page. The source follows.</p><code>npm i -D brushup &amp;&amp; npx brushup init</code>'));
await sleep(3800);

clearInterval(pump);
ffmpeg.stdin.end();
await ffmpegDone;
await browser.close();

/* Put the example back as it was. */
execFileSync('git', ['checkout', '--', 'examples/cadence/src'], { cwd: REPO });
await reset();
console.log(`recorded ${mp4} (${(written / FPS).toFixed(1)}s)`);
