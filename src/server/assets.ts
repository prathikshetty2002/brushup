import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EditError } from '../core/edit-types';

/** Larger than this and the image is better dropped into `public/` by hand: it has to travel over the canvas connection. */
export const MAX_ASSET_BYTES = 2.5 * 1024 * 1024;

/**
 * What kind of image these bytes are, from their first bytes and not from the file name, so a script or a page
 * renamed to `.png` is refused. SVG is left out on purpose: it can carry scripts and is opened as a page when visited.
 */
export function imageKind(bytes: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis)/.test(bytes.subarray(8, 12).toString('latin1'))) return 'avif';
  return null;
}

/** A safe file name stem from whatever the user's file was called: letters, digits, dot-free, no path, never empty. */
export function assetStem(name: string): string {
  const base = path.basename(String(name).replace(/\\/g, '/')).replace(/\.[^.]*$/, '');
  const stem = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return stem || 'image';
}

/**
 * Write an uploaded image into `dir` under a safe name, never overwriting a file that is already there.
 * Returns the file name it was saved as.
 */
export async function saveImage(dir: string, name: string, bytes: Buffer): Promise<string> {
  if (!bytes.length) throw new EditError('That file is empty.');
  if (bytes.length > MAX_ASSET_BYTES) throw new EditError(`That image is ${(bytes.length / 1048576).toFixed(1)} MB; the limit here is 2.5 MB. Put it in your public folder yourself and type its path instead.`);
  const kind = imageKind(bytes);
  if (!kind) throw new EditError('That doesn\'t look like a png, jpeg, gif, webp or avif image. (SVG can\'t be uploaded here, because it can carry scripts; put it in your project yourself and type its path.)');
  await mkdir(dir, { recursive: true });
  const stem = assetStem(name);
  for (let i = 0; i < 100; i++) {
    const file = `${stem}${i ? `-${i}` : ''}.${kind}`;
    try {
      await writeFile(path.join(dir, file), bytes, { flag: 'wx' }); // fails rather than replacing an existing file
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new EditError('There are too many images with that name already.');
}
