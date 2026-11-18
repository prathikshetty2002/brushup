// The part of Brushup most likely to differ between operating systems: dev-server mode. Builds a tiny Vite or
// Next.js app in a temp folder, installs the packed Brushup into it, runs `brushup init`, starts the dev server, opens
// the page in a real browser, edits through the panel and checks the change lands in the source file.
//   node scripts/e2e-dev.mjs vite|next chromium|firefox|webkit [path/to/brushup-*.tgz]
// BRUSHUP_CHROME=/path/to/chrome uses an installed Chrome for `chromium`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';

const [framework = 'vite', browserName = 'chromium', tarballArg] = process.argv.slice(2);
if (!['vite', 'next'].includes(framework) || !{ chromium, firefox, webkit }[browserName]) throw new Error('Usage: node scripts/e2e-dev.mjs vite|next chromium|firefox|webkit [tarball]');
const win = process.platform === 'win32';
const label = `${framework}/${browserName}/${process.platform}`;
const tarball = path.resolve(tarballArg ?? readdirSync('.').find((f) => /^brushup-.*\.tgz$/.test(f)) ?? '');
if (!existsSync(tarball)) throw new Error('Pack Brushup first (npm pack) or pass the tarball path');

const dir = mkdtempSync(path.join(tmpdir(), `brushup-dev-${framework}-`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const control = process.env.BRUSHUP_E2E_CONTROL === '1'; // no Brushup wiring: does the bare app work on this machine?
class Done extends Error {}
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${label}] ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 10000) => {
  for (let t = 0; t < ms; t += 200) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
};
// A hung install, dev server or browser must fail the run rather than hold it.
setTimeout(() => {
  console.error(`FAIL [${label}] timed out after 9 minutes`);
  process.exit(2);
}, 9 * 60_000).unref();

const w = (file, text) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
};

if (framework === 'vite') {
  w('package.json', JSON.stringify({ name: 'app', private: true, type: 'module' }));
  w('index.html', '<!doctype html><html><head><meta charset="utf-8"><title>app</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>');
  w('vite.config.js', "import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n");
  w('src/main.jsx', "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n");
  w('src/App.jsx', 'export default function App() {\n  return (\n    <main>\n      <h1>Hello Brushup</h1>\n      <p>A paragraph.</p>\n    </main>\n  );\n}\n');
} else {
  w('package.json', JSON.stringify({ name: 'app', private: true }));
  w('next.config.mjs', 'const nextConfig = {};\nexport default nextConfig;\n');
  w('app/layout.jsx', 'export default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <body>\n        {children}\n      </body>\n    </html>\n  );\n}\n');
  w('app/page.jsx', 'export default function Home() {\n  return (\n    <main>\n      <h1>Hello Brushup</h1>\n      <p>A paragraph.</p>\n    </main>\n  );\n}\n');
}
const sourceFile = path.join(dir, framework === 'vite' ? 'src/App.jsx' : 'app/page.jsx');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', shell: win && cmd === 'npm', ...opts });
const deps = framework === 'vite' ? ['vite', '@vitejs/plugin-react', 'react', 'react-dom'] : ['next', 'react', 'react-dom'];
let server;
let browser;
let serverLog = '';
let page;
let failureDetails = () => '';
let serverPort = 0;
try {
  const install = run('npm', ['install', ...deps, tarball, '--no-audit', '--no-fund']);
  check('installs the framework and the packed Brushup', install.status === 0, install.stderr.slice(-400));
  if (install.status !== 0) throw new Error('install failed');

  const init = control ? { status: 0, stdout: 'skipped (control run)', stderr: '' } : run(process.execPath, [path.join(dir, 'node_modules/brushup/dist/cli.js'), 'init', '.', '--mcp']);
  check('brushup init wires the project', init.status === 0 && (control || /brushup/.test(readFileSync(path.join(dir, framework === 'vite' ? 'vite.config.js' : 'next.config.mjs'), 'utf8'))), init.stdout + init.stderr);
  if (framework === 'next' && !control) check('init puts <BrushupScript /> in the layout', readFileSync(path.join(dir, 'app/layout.jsx'), 'utf8').includes('BrushupScript'));

  const port = 5200 + Math.floor(Math.random() * 600);
  serverPort = port;
  const bin = framework === 'vite' ? path.join(dir, 'node_modules/vite/bin/vite.js') : path.join(dir, 'node_modules/next/dist/bin/next');
  server = spawn(process.execPath, framework === 'vite' ? [bin, '--port', String(port), '--strictPort', '--host', '127.0.0.1'] : [bin, 'dev', '--port', String(port), '--hostname', '127.0.0.1'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (d) => (serverLog = (serverLog + d).slice(-4000)));
  const url = `http://127.0.0.1:${port}/`;
  const up = await until(() => fetch(url).then((r) => r.status < 500).catch(() => false), 240000);
  check('dev server starts', up);
  if (!up) throw new Error('dev server did not start');

  browser = await { chromium, firefox, webkit }[browserName].launch({ headless: true, ...(browserName === 'chromium' && process.env.BRUSHUP_CHROME ? { executablePath: process.env.BRUSHUP_CHROME, args: ['--no-sandbox'] } : {}) });
  page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => (errors.push(String(e)), consoleErrors.push(`pageerror: ${e}`)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    if (m.type() === 'error' && /hydrat/i.test(m.text())) errors.push(m.text());
  });
  failureDetails = () => `console errors: ${consoleErrors.slice(0, 6).join(' | ')}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (control) {
    check('the bare app renders its heading (no Brushup involved)', await page.locator('h1').first().waitFor({ timeout: 30000 }).then(() => true, () => false));
    throw new Done();
  }
  await page.waitForSelector('#brushup-root', { state: 'attached', timeout: 120000 });
  check('the canvas loads', await page.locator('.panel').first().isVisible());

  // refs must be project-relative with forward slashes on every OS, and carry a version token
  const tagged = await page.locator('h1[data-brushup-src]').first().evaluate((el) => ({ src: el.getAttribute('data-brushup-src'), sv: el.getAttribute('data-brushup-sv') }));
  check('element refs use forward slashes and are project-relative', /^(src\/App\.jsx|app\/page\.jsx):\d+:\d+$/.test(tagged.src ?? ''), String(tagged.src));
  check('element refs carry a version token', /^[0-9a-z]+\.[0-9a-z]+\.\d+\.\d+$/.test(tagged.sv ?? ''), String(tagged.sv));

  await page.click('h1[data-brushup-src]', { position: { x: 20, y: 10 } });
  check('selecting shows the file and line', /(App\.jsx|page\.jsx):\d+/.test((await page.locator('[data-pane=style] .info').textContent()) ?? ''));
  const size = page.locator('input[data-prop="font-size"]');
  await size.fill('36');
  await size.press('Tab');
  check('a panel edit is written into the source', await until(() => /fontSize:\s*36/.test(readFileSync(sourceFile, 'utf8')), 20000), readFileSync(sourceFile, 'utf8'));

  // the page hot-updates and a second edit still finds the element
  await sleep(1500);
  await page.locator('input[data-prop="font-size"]').fill('40');
  await page.locator('input[data-prop="font-size"]').press('Tab');
  check('a second edit lands on the same element', await until(() => /fontSize:\s*40/.test(readFileSync(sourceFile, 'utf8')), 20000));

  await page.locator('[data-act="undo"]').click(); // the keyboard shortcut is ignored while a panel field has focus
  check('undo reverts the last edit', await until(() => /fontSize:\s*36/.test(readFileSync(sourceFile, 'utf8')), 20000));
  const html = readFileSync(sourceFile, 'utf8');
  check('the rest of the file is untouched', html.includes('<p>A paragraph.</p>') && html.includes('Hello Brushup'));
  check('no page or hydration errors', errors.length === 0, errors.join('; ').slice(0, 300));
} catch (err) {
  if (!(err instanceof Done)) check('run', false, String(err).slice(0, 400));
  if (!(err instanceof Done)) {
  // What the browser and the dev server were doing when it went wrong.
  console.log(`--- diagnostics [${label}]`);
  console.log(failureDetails());
  try {
    console.log('page body:', ((await page?.evaluate(() => document.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '').slice(0, 700))) ?? '').replace(/\s+/g, ' '));
    console.log('tagged elements:', await page?.evaluate(() => document.querySelectorAll('[data-brushup-src]').length));
  } catch {
    /* page already gone */
  }
  if (framework === 'vite') {
    for (const p of ['@vite/client', 'src/main.jsx']) {
      const r = await fetch(`http://127.0.0.1:${serverPort}/${p}`).catch((e) => ({ status: String(e), headers: new Headers() }));
      console.log(`GET /${p} -> ${r.status} content-type: ${r.headers.get('content-type')}`);
    }
  }
  console.log('dev server output (tail):\n' + serverLog.slice(-1500));
  }
} finally {
  await browser?.close().catch(() => {});
  if (server?.pid) {
    if (win) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else server.kill('SIGKILL');
  }
  await sleep(500);
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  } catch {
    /* the OS cleans its temp folder */
  }
}
process.exit(failed ? 1 : 0);
