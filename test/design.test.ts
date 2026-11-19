// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESIGN_RULES, scanDesign } from '../src/overlay/design';

const box = (el: Element, w = 300, h = 40, left = 100) => {
  (el as HTMLElement).getBoundingClientRect = () => ({ width: w, height: h, top: 0, left, right: left + w, bottom: h, x: left, y: 0, toJSON() {} }) as DOMRect;
  return el as HTMLElement;
};
const put = (html: string) => {
  document.body.innerHTML = `<main>${html}</main>`;
  document.body.querySelectorAll('*').forEach((e) => box(e));
};
const of = (rule: string) => scanDesign(document).filter((i) => i.rule === rule);
const words = (n: number) => 'word '.repeat(n).trim();

beforeEach(() => (document.body.innerHTML = ''));
afterEach(() => {
  delete (Range.prototype as any).getBoundingClientRect;
});

describe('spacing on a grid', () => {
  it('flags values like 15px and 23px with a fix that snaps them, and leaves grid and half-step values alone', () => {
    put('<div id="a" style="padding-top:15px;margin-top:23px;padding-left:16px;margin-bottom:6px;padding-right:14px">x</div>');
    const [issue, ...rest] = of('spacing-grid');
    expect(rest).toHaveLength(0);
    expect(issue.fix?.props).toEqual({ 'padding-top': '16px', 'margin-top': '24px' });
    expect(issue.detail).toMatch(/padding-top 15px, margin-top 23px/);
  });

  it('ignores centering margins, inline elements and zero', () => {
    put('<div style="margin-left:57px;margin-right:57px">centered</div><span style="padding-top:13px">inline</span><div style="margin-top:0px;padding:0px">zero</div>');
    expect(of('spacing-grid')).toHaveLength(0);
  });

  it('keeps negative spacing negative when snapping', () => {
    put('<div style="margin-top:-19px">x</div>');
    expect(of('spacing-grid')[0].fix?.props).toEqual({ 'margin-top': '-20px' });
  });
});

describe('reading comfort', () => {
  it('flags lines far past 75 characters and offers a 65ch limit; narrower text passes', () => {
    put(`<p style="font-size:16px">${words(40)}</p>`);
    document.querySelector('p')!.getBoundingClientRect = () => ({ width: 1000, height: 40 }) as DOMRect;
    const [issue] = of('line-length');
    expect(issue.title).toMatch(/about 125 characters/);
    expect(issue.detail).toMatch(/80 characters/);
    expect(issue.fix?.props).toEqual({ 'max-width': '65ch' });
    document.querySelector('p')!.getBoundingClientRect = () => ({ width: 600, height: 40 }) as DOMRect;
    expect(of('line-length')).toHaveLength(0);
  });

  it('flags tight line spacing on multi-line body text, but not on one line or on big headings', () => {
    put(`<p style="font-size:16px;line-height:17.6px">${words(30)}</p><h2 style="font-size:40px;line-height:44px">${words(20)}</h2>`);
    const [p, h] = [...document.querySelectorAll('p, h2')];
    p.getBoundingClientRect = () => ({ width: 400, height: 36 }) as DOMRect; // two lines
    h.getBoundingClientRect = () => ({ width: 400, height: 90 }) as DOMRect;
    const found = of('line-height');
    expect(found).toHaveLength(1);
    expect(found[0].el.tagName).toBe('P');
    expect(found[0].fix?.props).toEqual({ 'line-height': '1.5' });
    p.getBoundingClientRect = () => ({ width: 400, height: 17 }) as DOMRect; // one line
    expect(of('line-height')).toHaveLength(0);
  });

  it('flags a long centered paragraph, not a short centered one', () => {
    put(`<p style="text-align:center;font-size:16px;line-height:24px">${words(60)}</p><p style="text-align:center;font-size:16px;line-height:24px">Short and sweet, centered on purpose for a hero line of text.</p>`);
    const [long] = [...document.querySelectorAll('p')];
    long.getBoundingClientRect = () => ({ width: 400, height: 96 }) as DOMRect;
    const found = of('long-centered');
    expect(found).toHaveLength(1);
    expect(found[0].fix?.props).toEqual({ 'text-align': 'left' });
  });
});

describe('hierarchy and type scale', () => {
  const body = `<p style="font-size:16px">${words(12)}</p>`.repeat(3);

  it('flags a heading that is no bigger or bolder than the body text', () => {
    put(`<h2 id="weak" style="font-size:16px;font-weight:400">A heading</h2><h2 id="size" style="font-size:32px">Big</h2><h2 id="bold" style="font-size:16px;font-weight:700">Bold</h2>${body}`);
    const found = of('heading-hierarchy');
    expect(found.map((i) => i.el.id)).toEqual(['weak']);
    expect(found[0].fix?.props).toEqual({ 'font-size': '24px', 'font-weight': '600' });
  });

  it('needs real body text to compare against', () => {
    put('<h2 style="font-size:16px;font-weight:400">A heading</h2>');
    expect(of('heading-hierarchy')).toHaveLength(0);
  });

  it('flags a page with more than eight font sizes, and lists them', () => {
    put([11, 12, 13, 14, 15, 16, 18, 20, 24].map((n) => `<span style="font-size:${n}px">size ${n}</span>`).join(''));
    const [issue] = of('type-scale');
    expect(issue.title).toBe('The page uses 9 different font sizes');
    expect(issue.detail).toContain('11, 12, 13, 14, 15, 16, 18, 20, 24px');
    put([12, 14, 16, 18, 24].map((n) => `<span style="font-size:${n}px">size ${n}</span>`).join(''));
    expect(of('type-scale')).toHaveLength(0);
  });
});

describe('boxes, images and clipping', () => {
  it('flags a button with a box and almost no padding, and gives the fix for the axis that is tight', () => {
    put('<button id="tight" style="background:#000;color:#fff;padding:2px;display:inline-block">Go</button><button id="ok" style="background:#000;color:#fff;padding:8px 16px;display:inline-block">Go</button><button id="plain" style="background:transparent;padding:0;display:inline-block">Link</button>');
    const found = of('cramped-button');
    expect(found.map((i) => i.el.id)).toEqual(['tight']);
    expect(found[0].fix?.props).toEqual({ 'padding-left': '12px', 'padding-right': '12px', 'padding-top': '6px', 'padding-bottom': '6px' });
  });

  it('measures the real gap, so a button with no padding but a fixed height and a centered label is fine', () => {
    put('<button id="roomy" style="background:#000;color:#fff;padding:0;display:flex">Go</button><button id="hug" style="background:#000;color:#fff;padding:0;display:flex">Go</button>');
    const roomy = box(document.getElementById('roomy')!, 120, 32, 100);
    const hug = box(document.getElementById('hug')!, 40, 20, 100);
    (Range.prototype as any).getBoundingClientRect = function () {
      const el = (this as Range).commonAncestorContainer as HTMLElement;
      return el === roomy ? { left: 140, right: 180, top: 8, bottom: 24, width: 40, height: 16 } : { left: 101, right: 139, top: 1, bottom: 19, width: 38, height: 18 };
    };
    expect(of('cramped-button').map((i) => i.el)).toEqual([hug]);
  });

  it('flags an image drawn at a different shape, but not one cropped with object-fit or drawn to scale', () => {
    put('<img id="bad"><img id="ok"><img id="crop" style="object-fit:cover">');
    const [bad, ok, crop] = ['bad', 'ok', 'crop'].map((id) => document.getElementById(id) as HTMLImageElement);
    for (const img of [bad, ok, crop]) Object.defineProperties(img, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
    box(bad, 200, 100);
    box(ok, 150, 150);
    box(crop, 200, 100);
    const found = of('stretched-image');
    expect(found.map((i) => i.el.id)).toEqual(['bad']);
    expect(found[0].fix?.props).toEqual({ 'object-fit': 'cover' });
  });

  it('flags text hidden by its container, unless it truncates with an ellipsis or scrolls', () => {
    put('<div id="cut" style="overflow:hidden">Long label that is cut</div><div id="dots" style="overflow:hidden;text-overflow:ellipsis">Long label with dots</div><div id="scroll" style="overflow:auto">Scrolls fine</div>');
    for (const id of ['cut', 'dots', 'scroll']) Object.defineProperties(document.getElementById(id)!, { scrollWidth: { value: 300 }, clientWidth: { value: 100 }, scrollHeight: { value: 20 }, clientHeight: { value: 20 } });
    expect(of('clipped-text').map((i) => i.el.id)).toEqual(['cut']);
    expect(of('clipped-text')[0].fix?.props).toEqual({ 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });
});

describe('the page edges', () => {
  it('flags something that makes the page scroll sideways and names it', () => {
    put('<div id="wide">too wide</div><div>fine</div>');
    box(document.getElementById('wide')!, 1100, 40, 0);
    const root = document.documentElement;
    Object.defineProperties(root, { scrollWidth: { value: 1200, configurable: true }, clientWidth: { value: 1024, configurable: true } });
    const [issue] = of('sideways-scroll');
    expect(issue.el.id).toBe('wide');
    expect(issue.detail).toMatch(/sticks out 76px/);
    Object.defineProperties(root, { scrollWidth: { value: 1024, configurable: true } });
    expect(of('sideways-scroll')).toHaveLength(0);
  });

  it('flags text within 8px of the screen edge', () => {
    put('<p id="edge">Hugging the edge</p><p id="fine">Comfortable</p>');
    (Range.prototype as any).getBoundingClientRect = function () {
      const el = (this as Range).commonAncestorContainer as HTMLElement;
      return el.id === 'edge' ? { left: 2, right: 200, width: 198, height: 20 } : { left: 40, right: 300, width: 260, height: 20 };
    };
    const found = of('text-edge');
    expect(found.map((i) => i.el.id)).toEqual(['edge']);
    expect(found[0].title).toBe('Text is 2px from the edge of the screen');
  });
});

describe('scanDesign', () => {
  it('reports nothing for a well-made page and skips what it is told to ignore', () => {
    put(`<h1 style="font-size:32px;font-weight:700;padding:16px">Title</h1><p style="font-size:16px;line-height:24px;padding:16px">${words(12)}</p>`);
    expect(scanDesign(document)).toEqual([]);
    put('<div id="mine" style="padding-top:13px">x</div>');
    expect(scanDesign(document, (el) => el.id === 'mine')).toEqual([]);
  });

  it('caps each rule so one problem repeated does not flood the list, and ids are unique', () => {
    put(Array.from({ length: 20 }, () => '<div style="padding-top:13px">x</div>').join(''));
    const found = of('spacing-grid');
    expect(found).toHaveLength(8);
    expect(new Set(found.map((i) => i.id)).size).toBe(8);
  });

  it('describes every rule', () => {
    expect(DESIGN_RULES.length).toBe(11);
    for (const r of DESIGN_RULES) {
      expect(r.what.length).toBeGreaterThan(15);
      expect(r.basis.length).toBeGreaterThan(40); // every rule says where its number comes from
      expect(['standard', 'guideline', 'convention']).toContain(r.strength);
      if (r.learn) expect(r.learn).toMatch(/^https:\/\//);
    }
    // a rule with no published source must say it is a convention, never imply authority
    for (const r of DESIGN_RULES.filter((x) => !x.learn)) expect(r.strength).toBe('convention');
    expect(new Set(DESIGN_RULES.map((r) => r.rule)).size).toBe(DESIGN_RULES.length);
  });
});
