import { EditError, type AttrEdit } from './edit-types';

const SRC_MAX = 2000;
const ALT_MAX = 500;
const INLINE_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/;

/** What an `attr` edit may write. The name is an allowlist; the value is a plain string that can't run anything. */
export function checkAttr(edit: AttrEdit): void {
  if (edit.name !== 'src' && edit.name !== 'alt') throw new EditError(`Brushup only edits an image's src and alt, not "${String(edit.name)}"`);
  if (typeof edit.value !== 'string') throw new EditError('The value has to be text');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(edit.value)) throw new EditError('That value has a line break or control character in it');
  if (edit.name === 'alt') {
    if (edit.value.length > ALT_MAX) throw new EditError(`Alt text is limited to ${ALT_MAX} characters; say it more briefly`);
    return;
  }
  const v = edit.value.trim();
  if (!v) throw new EditError('An image needs a source');
  if (v.length > SRC_MAX && !INLINE_IMAGE.test(v)) throw new EditError(`That image address is longer than ${SRC_MAX} characters`);
  if (/^(javascript|vbscript|file|blob):/i.test(v)) throw new EditError('That kind of address can\'t be an image source');
  if (/^data:/i.test(v) && !INLINE_IMAGE.test(v)) throw new EditError('Only an inline png, jpeg, gif, webp or avif image can be used as a data address');
  if (INLINE_IMAGE.test(v) && v.length > 200_000) throw new EditError('That inline image is too large to put in your source; save it as a file instead');
}

/** An attribute value as it is written in markup: quoted, with the characters that would end or alter it escaped. */
export function markupValue(value: string): string {
  return `"${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
}
