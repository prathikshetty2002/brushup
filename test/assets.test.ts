import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditError } from '../src/core/edit-types';
import { assetStem, imageKind, MAX_ASSET_BYTES, saveImage } from '../src/server/assets';
import { startServer, type RunningServer } from '../src/server/index';

/** The first bytes of each format, padded: enough to be recognised, which is all the checks look at. */
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40)]);
const avif = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(40)]);

describe('imageKind', () => {
  it('recognises the five formats by their bytes', () => {
    expect([png, jpg, gif, webp, avif].map(imageKind)).toEqual(['png', 'jpg', 'gif', 'webp', 'avif']);
  });

  it('refuses anything else, however it is named, including svg, html and scripts', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<!doctype html><script>alert(1)</script>', '#!/bin/sh\nrm -rf /\n', 'just some text, long enough']) expect(imageKind(Buffer.from(text))).toBeNull();
    expect(imageKind(Buffer.alloc(0))).toBeNull();
    expect(imageKind(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe('assetStem', () => {
  it('makes a safe name out of any file name, and never an empty one', () => {
    expect(assetStem('My Photo (1).PNG')).toBe('my-photo-1');
    expect(assetStem('../../etc/passwd')).toBe('passwd');
    expect(assetStem('C:\\Users\\me\\logo.v2.png')).toBe('logo-v2');
    expect(assetStem('.htaccess')).toBe('image');
    expect(assetStem('日本語.png')).toBe('image');
    expect(assetStem('a'.repeat(200) + '.png')).toHaveLength(60);
  });
});

describe('saveImage', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-asset-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('saves into the folder (making it), named by what the bytes are, not what the user called it', async () => {
    const out = path.join(dir, 'public');
    expect(await saveImage(out, 'Hero Banner.jpeg', png)).toBe('hero-banner.png'); // it is a png, whatever the name said
    expect(await readFile(path.join(out, 'hero-banner.png'))).toEqual(png);
  });

  it('never overwrites a file that is there: it adds a number', async () => {
    await saveImage(dir, 'logo.png', png);
    expect(await saveImage(dir, 'logo.png', png)).toBe('logo-1.png');
    expect(await saveImage(dir, 'logo.png', png)).toBe('logo-2.png');
    expect(await saveImage(dir, 'logo.png', jpg)).toBe('logo.jpg'); // a different kind of image does not collide
    expect((await readdir(dir)).sort()).toEqual(['logo-1.png', 'logo-2.png', 'logo.jpg', 'logo.png']);
    expect((await readFile(path.join(dir, 'logo.png'))).equals(png)).toBe(true); // the first one is untouched
  });

  it('stays inside the folder however the name tries to climb out', async () => {
    const inner = path.join(dir, 'public');
    await mkdir(inner);
    await saveImage(inner, '../../escape.png', png);
    await saveImage(inner, '/etc/cron.d/x.png', png);
    expect(await readdir(inner)).toEqual(expect.arrayContaining(['escape.png', 'x.png']));
    expect((await readdir(dir)).sort()).toEqual(['public']);
  });

  it('refuses empty, oversize and not-an-image files with a message that says what to do', async () => {
    await expect(saveImage(dir, 'a.png', Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(saveImage(dir, 'a.png', Buffer.concat([png, Buffer.alloc(MAX_ASSET_BYTES)]))).rejects.toThrow(/limit here is 2\.5 MB/);
    await expect(saveImage(dir, 'a.png', Buffer.from('<svg onload="alert(1)"></svg>'))).rejects.toThrow(/SVG can't be uploaded/);
    await expect(saveImage(dir, 'a.png', Buffer.from('not an image at all, just text'))).rejects.toBeInstanceOf(EditError);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('uploading from the canvas', () => {
  let dir: string;
  let server: RunningServer | null = null;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-upload-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body><img src="a.png"></body></html>');
    server = await startServer(path.join(dir, 'index.html'), 45900 + Math.floor(Math.random() * 90));
  });
  afterEach(async () => {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  const send = async (msg: object, role: 'canvas' | 'agent' = 'canvas') => {
    const html = await (await fetch(server!.url)).text();
    const ws = new WebSocket(JSON.parse(/window\.__brushup=(\{.*?\})<\/script>/.exec(html)![1]).ws, { headers: { Origin: new URL(server!.url).origin } });
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    if (role === 'agent') ws.send(JSON.stringify({ type: 'hello', role: 'agent' }));
    ws.send(JSON.stringify(msg));
    for (let i = 0; i < 60 && !msgs.some((m) => m.type === 'result'); i++) await new Promise((r) => setTimeout(r, 25));
    ws.close();
    return msgs.find((m) => m.type === 'result');
  };

  it('saves the image beside the page and says what to write as its src', async () => {
    const r = await send({ type: 'upload', n: 1, name: 'Team Photo.png', data: png.toString('base64') });
    expect(r).toMatchObject({ ok: true, src: 'team-photo.png', saved: 'team-photo.png' });
    expect(await readFile(path.join(dir, 'team-photo.png'))).toEqual(png);
  });

  it('refuses a file that is not an image, and writes nothing', async () => {
    const before = (await readdir(dir)).sort();
    const r = await send({ type: 'upload', n: 2, name: 'x.png', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't look like/) });
    expect((await readdir(dir)).sort()).toEqual(before);
  });

  it('does not let an agent connection write files, and rejects a malformed upload', async () => {
    const before = (await readdir(dir)).length;
    await send({ type: 'upload', n: 3, name: 'x.png', data: png.toString('base64') }, 'agent').catch(() => undefined);
    expect((await readdir(dir)).length).toBe(before);
    const bad = await send({ type: 'upload', n: 4, name: 5, data: {} });
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/malformed/) });
  });
});

