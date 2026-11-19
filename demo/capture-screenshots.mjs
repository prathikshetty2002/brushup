/**
 * Takes the README screenshots of Brushup running on the Cadence example site (examples/cadence).
 * Everything is real: Chrome drives the page, edits are written to the example's source, and the notes and the
 * agent's reply go through the same files the MCP server uses.
 *
 * Prerequisites: `npm install && npx vite --port 5301` running in examples/cadence, Google Chrome.
 *   node demo/capture-screenshots.mjs          # writes demo/out/shots/*.png at 2x
 * It edits the example's files; the last step puts them back with `git checkout`.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const APP = path.join(REPO, 'examples', 'cadence');
const OUT = path.join(HERE, 'out', 'shots');
const URL = process.env.CADENCE_URL ?? 'http://localhost:5301/';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
/** Clear the notes and edit log, but leave the folder itself: the dev server is watching it. */
const reset = () => Promise.all(['notes.json', 'notes.md', 'edits.jsonl', 'ignored-checks.json'].map((f) => rm(path.join(APP, '.brushup', f), { force: true })));
await reset();

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
const page = await context.newPage();

async function open() {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('[data-tab=style]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await sleep(900);
}

const shot = async (name, options = {}) => {
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });
  console.log('saved', name);
};

/**
 * A close-up of the panel for the README. The window is made taller first so the whole panel shows, with nothing
 * cut off at the bottom, then put back.
 */
const panelShot = async (name, { until } = {}) => {
  await page.setViewportSize({ width: 1680, height: 1500 });
  await sleep(700);
  // Hide the page behind it, so the picture is the panel on a clean cream background and not a sliver of the site.
  await page.evaluate(() => (document.getElementById('root').style.visibility = 'hidden'));
  const box = await page.locator('.panel').boundingBox();
  const pad = 16;
  const y = Math.max(0, box.y - pad);
  const end = until ? (await page.locator(until).boundingBox()).y + (await page.locator(until).boundingBox()).height + pad : box.y + box.height + pad;
  await shot(name, { clip: { x: box.x - pad, y, width: box.width + pad * 2, height: end - y } });
  await page.evaluate(() => (document.getElementById('root').style.visibility = ''));
  await page.setViewportSize({ width: 1680, height: 1000 });
  await sleep(500);
};

const tab = async (name) => {
  await page.locator(`[data-tab=${name}]`).click();
  await sleep(500);
};

/* 1. The hero shot: a real headline selected, the panel beside it. */
await open();
await page.locator('h1').click();
await sleep(700);
await shot('hero');
await panelShot('style', { until: '.fields' });

/* 2. Checks: the grouped list, one card open to show the explanation, the fix and where the number comes from. */
await open();
await tab('a11y');
await page.locator('.a11yhead').first().click(); // open the contrast card: the explanation, the fix and the source
await sleep(400);
await panelShot('checks');

/* 3. Layers: select a feature card and open the tree down to it, components named. */
await open();
await page.locator('article').first().click({ position: { x: 40, y: 30 } });
await sleep(500);
await tab('layers');
await sleep(500);
await panelShot('layers');

/* 4. The image section, on the testimonial photo that has no alt text. */
await open();
await page.locator('#customers img').scrollIntoViewIfNeeded();
await sleep(300);
await page.locator('#customers img').click();
await sleep(700);
await panelShot('image', { until: '.imgsec' });
await shot('image-page');

/* 5. Notes: pin a note on the pricing heading, then answer it the way Claude does (through the notes file, staged: this is not a live Claude run). */
await open();
await page.locator('#pricing h2').scrollIntoViewIfNeeded();
await sleep(300);
await page.locator('#pricing h2').click();
await sleep(500);
await page.keyboard.press('n');
await sleep(400);
await page.locator('textarea').fill('Reword this headline so it says what the price is for.');
await page.getByRole('button', { name: 'Save note' }).click();
await sleep(900);
const notesFile = path.join(APP, '.brushup', 'notes.json');
const notes = JSON.parse(await readFile(notesFile, 'utf8'));
notes[0].status = 'done';
notes[0].reply = 'Now reads “Start free. Pay when the whole team is in.” (Pricing.tsx).';
notes[0].updatedAt = new Date().toISOString();
await writeFile(notesFile, JSON.stringify(notes, null, 2) + '\n');
await sleep(1500);
await tab('notes');
await sleep(600);
await panelShot('notes');
await shot('notes-page');

/* 6. Changes: three real text edits on three different pages of the site, then the diff Brushup wrote. */
const retype = async (locator, text) => {
  await locator.scrollIntoViewIfNeeded();
  await sleep(300);
  await locator.dblclick();
  await sleep(300);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await sleep(1500);
};
await open();
await retype(page.locator('header a', { hasText: 'Sign in' }), 'Log in');
await retype(page.locator('#product a', { hasText: 'See how teams use it' }), 'See a real week');
await retype(page.locator('section a', { hasText: 'Start free' }).last(), 'Try it free');
await tab('changes');
await sleep(1200);
await page.locator('.chfile summary').first().click();
await sleep(400);
await panelShot('changes');

await browser.close();

/* Put the example back as it was. */
execFileSync('git', ['checkout', '--', 'examples/cadence/src'], { cwd: REPO });
await reset();
console.log('done');
