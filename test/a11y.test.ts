// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { contrastRatio, nearestPassing, parseColor, RULES, scanPage } from '../src/overlay/a11y';

/** jsdom has no layout, so give each element the size a browser would. */
const box = (el: Element, w = 100, h = 30) => {
  (el as HTMLElement).getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return el as HTMLElement;
};
const put = (html: string) => {
  document.body.innerHTML = html;
  document.body.querySelectorAll('*').forEach((e) => box(e));
};
const rules = () => scanPage(document).map((i) => i.rule);
/** The page-level basics, so a test about one rule isn't also told the page has no title. */
const shell = () => {
  document.documentElement.lang = 'en';
  document.title = 'Test page';
};
const withMain = (html: string) => put(`<main><h1>Title</h1>${html}</main>`);
const of = (rule: string) => scanPage(document).filter((i) => i.rule === rule);

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  shell();
});

describe('colour maths', () => {
  it('matches the published contrast figures', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
    expect(contrastRatio({ r: 119, g: 119, b: 119 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(4.48, 1); // #777 on white just fails AA
    expect(contrastRatio({ r: 118, g: 118, b: 118 }, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5); // #767676 is the lightest grey that passes
  });

  it('reads rgb, rgba and transparent, and refuses nonsense', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toMatchObject({ a: 0.5 });
    expect(parseColor('rgb(10 20 30 / 25%)')).toMatchObject({ a: 0.25 });
    expect(parseColor('transparent')?.a).toBe(0);
  });

  it('finds the closest passing colour in the same hue, or says there is none', () => {
    const white = { r: 255, g: 255, b: 255 };
    const fixed = nearestPassing({ r: 170, g: 170, b: 170 }, white, 4.5)!;
    const c = parseColor(`rgb(${parseInt(fixed.slice(1, 3), 16)}, ${parseInt(fixed.slice(3, 5), 16)}, ${parseInt(fixed.slice(5, 7), 16)})`)!;
    expect(contrastRatio(c, white)).toBeGreaterThanOrEqual(4.5);
    expect(fixed).toMatch(/^#[0-9a-f]{6}$/);
    expect(nearestPassing({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 }, 21)).toBeNull();
    // light text on a dark background gets lighter, not darker
    const onDark = nearestPassing({ r: 90, g: 90, b: 90 }, { r: 20, g: 20, b: 20 }, 4.5)!;
    expect(parseInt(onDark.slice(1, 3), 16)).toBeGreaterThan(90);
  });
});

describe('contrast', () => {
  it('flags light grey text on white with the fix, and passes dark text', () => {
    withMain('<p id="bad" style="color:#aaa;background:#fff;font-size:16px">Too faint</p><p style="color:#222;background:#fff;font-size:16px">Fine</p>');
    const issues = scanPage(document);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'contrast', fix: { props: { color: expect.stringMatching(/^#[0-9a-f]{6}$/) } } });
    expect(issues[0].title).toMatch(/Text is hard to read: contrast .*needs 4\.5:1/);
  });

  it('asks only 3:1 of large text', () => {
    put('<main><h1 style="color:#888;background:#fff;font-size:32px">Big</h1><p style="color:#888;background:#fff;font-size:14px">Small</p></main>');
    const issues = scanPage(document);
    expect(issues.map((i) => i.el.tagName)).toEqual(['P']);
  });

  it('works out the background from the ancestors, including semi-transparent layers', () => {
    withMain('<div style="background:#000"><p style="color:#333;font-size:16px">on black</p></div><div style="background:#fff"><div style="background:rgba(0,0,0,.9)"><p style="color:#fff;font-size:16px">dark glass</p></div></div>');
    const issues = scanPage(document);
    expect(issues.map((i) => i.el.textContent)).toEqual(['on black']); // #333 on black fails; white on 90% black passes
  });

  it('does not guess over a gradient or image, hidden text, or disabled controls', () => {
    withMain('<div style="background-image:linear-gradient(#000,#fff)"><p style="color:#999;font-size:16px">on a gradient</p></div><p style="color:#fff;background:#fff;display:none">hidden</p><button disabled style="color:#ccc;background:#fff">nope</button><p aria-hidden="true" style="color:#fff;background:#fff">decor</p>');
    expect(rules()).toEqual([]);
  });
});

describe('tap targets', () => {
  it('flags a control under 24px with a min-size fix, not an adequate one or an inline link in text', () => {
    document.body.innerHTML = '<button id="a">x</button><button id="b">ok</button><p>Read <a href="#" id="c">this link</a> now</p>';
    box(document.getElementById('a')!, 16, 16);
    box(document.getElementById('b')!, 40, 32);
    box(document.getElementById('c')!, 50, 14);
    const issues = scanPage(document).filter((i) => i.rule === 'target-size');
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Hard to tap: only 16×16px');
    expect(issues[0].fix?.props).toEqual({ 'min-width': '24px', 'min-height': '24px' });
  });
});

describe('images, names and headings', () => {
  it('flags an image with no alt attribute, but allows alt="" for decoration', () => {
    withMain('<img id="a" src="x.png"><img id="b" src="y.png" alt=""><img id="c" src="z.png" alt="A cat">');
    const issues = scanPage(document);
    expect(issues.map((i) => i.rule)).toEqual(['image-alt']);
    expect(issues[0].el.id).toBe('a');
    expect(issues[0].fix).toBeUndefined(); // there is no style that fixes a missing attribute
  });

  it('flags controls with no accessible name and accepts every way of giving one', () => {
    withMain(
      '<button id="x"></button><button aria-label="Close">×</button><a href="#" id="y"><svg></svg></a><button><img src="i.png" alt="Search"></button>' +
        '<input id="n"><input id="l1" aria-label="Email"><label>Name <input id="l2"></label><input id="p" placeholder="Search…"><button title="Save"></button><input type="submit" value="Send">',
    );
    const named = scanPage(document).filter((i) => i.rule === 'name').map((i) => i.el.id);
    expect(named).toEqual(['x', 'y', 'n']);
  });

  it('flags a heading level that skips, once', () => {
    put('<main><h1>Title</h1><h3>Jumped</h3><h4>Fine after that</h4><h2>Back up is fine</h2></main>');
    const issues = scanPage(document).filter((i) => i.rule === 'heading-order');
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Heading jumps from level 1 to 3');
  });
});

describe('scanPage', () => {
  it('skips what the caller says to ignore, such as the overlay itself', () => {
    withMain('<div id="mine"><button></button></div><button></button>');
    const all = scanPage(document);
    const rest = scanPage(document, (el) => el.closest('#mine') !== null);
    expect(all).toHaveLength(2);
    expect(rest).toHaveLength(1);
  });

  it('reports nothing on a clean page and gives every issue a unique id', () => {
    put('<main><h1 style="color:#111;background:#fff">Hello</h1><button style="color:#111;background:#fff">Go</button></main>');
    document.querySelectorAll('button').forEach((b) => box(b, 60, 30));
    expect(scanPage(document)).toEqual([]);
    put('<img><img><img>');
    const ids = scanPage(document).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('more checks', () => {
  it('flags text under 12px, with a fix', () => {
    withMain('<p style="font-size:10px;color:#111;background:#fff">tiny</p><p style="font-size:12px;color:#111;background:#fff">ok</p>');
    const [issue, ...rest] = of('small-text');
    expect(rest).toHaveLength(0);
    expect(issue.title).toBe('Text is very small: 10px');
    expect(issue.fix?.props).toEqual({ 'font-size': '12px' });
  });

  it('flags links that only say click here or read more, unless they have a label', () => {
    withMain('<a href="#" id="a">Read more →</a><a href="#" id="b">Click here.</a><a href="#" id="c" aria-label="Read more about pricing">Read more</a><a href="#" id="d">Pricing</a>');
    expect(of('link-text').map((i) => i.el.id)).toEqual(['a', 'b']);
  });

  it('flags an empty heading', () => {
    withMain('<h2 id="e"></h2><h2>Full</h2>');
    expect(of('heading-order').map((i) => [i.el.id, i.title])).toEqual([['e', 'Heading is empty']]);
  });

  it('flags a button role a keyboard cannot reach, and things that only look clickable', () => {
    withMain(
      '<div id="r" role="button">Do it</div><div id="ok" role="button" tabindex="0">Ok</div><button id="n">Native</button>' +
        '<div id="clicky" style="cursor:pointer">Card</div><a href="#" style="cursor:pointer" id="l">Link</a><div style="cursor:pointer"><span id="inner">inside a pointer parent</span></div>',
    );
    expect(of('keyboard').map((i) => i.el.id)).toEqual(['r', 'clicky', '']);
    expect(of('keyboard').map((i) => i.title)).toEqual(['Has a button role but a keyboard can’t reach it', 'Looks clickable but a keyboard can’t use it', 'Looks clickable but a keyboard can’t use it']);
  });

  it('flags a positive tabindex', () => {
    withMain('<div tabindex="3" id="t">x</div><div tabindex="0">y</div><div tabindex="-1">z</div>');
    expect(of('tab-order').map((i) => i.el.id)).toEqual(['t']);
  });

  it('flags audio and unmuted video that autoplay', () => {
    withMain('<audio autoplay id="a"></audio><video autoplay id="b"></video><video autoplay muted id="c"></video><audio id="d"></audio>');
    expect(of('autoplay').map((i) => i.el.id)).toEqual(['a', 'b']);
  });

  it('flags an id used twice, once per id', () => {
    withMain('<div id="x">a</div><div id="x">b</div><div id="x">c</div><div id="y">d</div>');
    const dup = of('duplicate-id');
    expect(dup).toHaveLength(1);
    expect(dup[0].title).toBe('The id “x” is used more than once');
  });

  it('checks the page itself: language, title, zoom, main landmark, h1', () => {
    document.documentElement.removeAttribute('lang');
    document.title = '';
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, user-scalable=no">';
    put('<div><p>no landmarks, no heading</p></div>');
    expect(rules()).toEqual(expect.arrayContaining(['language', 'page-title', 'zoom', 'page-structure']));
    expect(of('page-structure').map((i) => i.title)).toEqual(['The page has no main landmark', 'The page has no h1']);
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">';
    expect(of('zoom')).toHaveLength(1);
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    expect(of('zoom')).toHaveLength(0);
  });

  it('lists every check with a label, and only links to the W3C', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(15);
    for (const r of RULES) {
      expect(r.label.length).toBeGreaterThan(2);
      expect(r.what.length).toBeGreaterThan(10);
      if (r.learn) expect(r.learn).toMatch(/^https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\/[a-z-]+\.html$/);
    }
    expect(new Set(RULES.map((r) => r.rule)).size).toBe(RULES.length);
  });
});
