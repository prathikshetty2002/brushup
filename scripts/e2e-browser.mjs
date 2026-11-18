// Drives the real canvas in a real browser against the static-HTML mode and checks the edits land in the file.
//   node scripts/e2e-browser.mjs chromium|firefox|webkit      (needs `npx playwright-core install <browser>`)
//   BRUSHUP_CHROME=/usr/bin/google-chrome-stable node scripts/e2e-browser.mjs chromium   (use an installed Chrome)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';

const name = process.argv[2] ?? 'chromium';
const type = { chromium, firefox, webkit }[name];
if (!type) throw new Error('Usage: node scripts/e2e-browser.mjs chromium|firefox|webkit');

const dir = mkdtempSync(path.join(tmpdir(), 'brushup-e2e-'));
const file = path.join(dir, 'index.html');
writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><title>e2e</title>
<style>body{margin:0;font-family:sans-serif}h1{font-size:40px;margin:20px}p{margin:20px}</style></head>
<body><h1>Hello</h1><p>World</p></body></html>
`);
const port = 4400 + Math.floor(Math.random() * 400);
const server = spawn('node', [path.resolve('dist/cli.js'), file, '--port', String(port)], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${name}] ${label}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 6000) => {
  for (let t = 0; t < ms; t += 150) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};

let browser;
try {
  for (let i = 0; i < 40; i++) {
    if (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false)) break;
    await sleep(250);
  }
  browser = await type.launch({ headless: true, ...(name === 'chromium' && process.env.BRUSHUP_CHROME ? { executablePath: process.env.BRUSHUP_CHROME, args: ['--no-sandbox'] } : {}) });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('#brushup-root', { state: 'attached', timeout: 15000 });
  check('canvas loads', await page.locator('.panel').first().isVisible());

  // select by clicking, then edit a field in the panel
  await page.click('h1[data-brushup-id]', { position: { x: 20, y: 10 } });
  check('clicking selects and shows the element', /<h1>/.test((await page.locator('[data-pane=style] .info').textContent()) ?? ''));
  const size = page.locator('input[data-prop="font-size"]');
  await size.fill('36');
  await size.press('Tab');
  check('a panel edit is written to the file', await until(() => /font-size:\s*36px/.test(readFileSync(file, 'utf8'))));

  // drag to move: margins change in the file
  const before = readFileSync(file, 'utf8');
  const box = await page.locator('p[data-brushup-id]').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 8, { steps: 6 });
  await page.mouse.up();
  check('dragging moves the element and writes it', await until(() => readFileSync(file, 'utf8') !== before));

  // inline text edit
  await page.dblclick('h1[data-brushup-id]');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Brushup works');
  await page.keyboard.press('Enter');
  check('double-click text editing is written to the file', await until(() => readFileSync(file, 'utf8').includes('Brushup works')));

  // undo
  await page.keyboard.press('ControlOrMeta+Z');
  check('undo reverts the last edit', await until(() => !readFileSync(file, 'utf8').includes('Brushup works')));
  check('no page errors', errors.length === 0, errors.join('; '));
} catch (err) {
  check('run', false, String(err).slice(0, 300));
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    /* best effort */
  }
}
process.exit(failed ? 1 : 0);
