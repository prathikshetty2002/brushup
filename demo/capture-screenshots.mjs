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
await rm(path.join(APP, '.brushup'), { recursive: true, force: true });

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
const panelShot = async (name) => {
  await page.setViewportSize({ width: 1680, height: 1500 });
  await sleep(700);
  const box = await page.locator('.panel').boundingBox();
  const pad = 14;
  await shot(name, { clip: { x: box.x - pad, y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } });
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
await panelShot('style');

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
await panelShot('image');
await shot('image-page');

/* 5. Notes: pin a note on the pricing heading, then answer it the way Claude does (through the notes file). */
await open();
await page.locator('#pricing h2').scrollIntoViewIfNeeded();
await sleep(300);
await page.locator('#pricing h2').click();
await sleep(500);
await page.keyboard.press('n');
await sleep(400);
await page.locator('textarea').fill('Make this headline punchier and keep it to one line.');
await page.getByRole('button', { name: 'Save note' }).click();
await sleep(900);
const notesFile = path.join(APP, '.brushup', 'notes.json');
const notes = JSON.parse(await readFile(notesFile, 'utf8'));
notes[0].status = 'done';
notes[0].reply = 'Changed it to "Start free. Pay when the whole team is in." in Pricing.tsx, one line at every width.';
notes[0].updatedAt = new Date().toISOString();
await writeFile(notesFile, JSON.stringify(notes, null, 2) + '\n');
await sleep(1500);
await tab('notes');
await sleep(600);
await panelShot('notes');
await shot('notes-page');

/* 6. Changes: make three real edits, then show the diff Brushup wrote. */
await open();
await page.locator('h1').dblclick();
await page.keyboard.press('Control+A');
await page.keyboard.type('Your team’s week, on one page.');
await page.keyboard.press('Enter');
await sleep(1500);
const cta = page.locator('#product a', { hasText: 'Start free' }).first();
await cta.click();
await sleep(500);
await page.keyboard.press('Shift+ArrowRight');
await sleep(1200);
await page.locator('#product p', { hasText: 'Free for teams' }).click();
await sleep(400);
await page.keyboard.press('Shift+ArrowDown');
await sleep(1500);
await tab('changes');
await sleep(1200);
await page.locator('.chfile summary').first().click();
await sleep(400);
await panelShot('changes');

await browser.close();

/* Put the example back as it was. */
execFileSync('git', ['checkout', '--', 'examples/cadence/src'], { cwd: REPO });
await rm(path.join(APP, '.brushup'), { recursive: true, force: true });
console.log('done');
