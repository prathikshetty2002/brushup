// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { morphPage } from '../src/overlay/morph';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

beforeEach(() => {
  document.head.innerHTML = '<title>One</title><style>.a { color: red }</style>';
  document.body.innerHTML = '<h1 class="t" data-x="1">Hello</h1><p>World</p>';
});

describe('morphPage (live sync of agent edits into the open page)', () => {
  it('updates text, attributes and styles in place, keeping the same DOM nodes', () => {
    const h1 = document.querySelector('h1')!;
    const result = morphPage(parse('<title>Two</title><style>.a { color: blue }</style><h1 class="t big" style="margin-left: 4px">Hi there</h1><p>World</p>'));
    expect(result).toBe('ok');
    expect(document.querySelector('h1')).toBe(h1); // same node: selection and focus survive
    expect(h1.textContent).toBe('Hi there');
    expect(h1.className).toBe('t big');
    expect(h1.hasAttribute('data-x')).toBe(false);
    expect(h1.getAttribute('style')).toBe('margin-left: 4px');
    expect(document.title).toBe('Two');
    expect(document.querySelector('style')!.textContent).toContain('blue');
  });

  it('adds and removes elements', () => {
    morphPage(parse('<title>One</title><style>.a { color: red }</style><h1 class="t" data-x="1">Hello</h1><p>World</p><footer>New</footer>'));
    expect(document.querySelector('footer')!.textContent).toBe('New');
    morphPage(parse('<title>One</title><style>.a { color: red }</style><h1 class="t" data-x="1">Hello</h1>'));
    expect(document.querySelector('p')).toBeNull();
    expect(document.querySelector('footer')).toBeNull();
  });

  it('replaces an element whose tag changed', () => {
    morphPage(parse('<title>One</title><style>.a { color: red }</style><h2>Hello</h2><p>World</p>'));
    expect(document.querySelector('h1')).toBeNull();
    expect(document.querySelector('h2')!.textContent).toBe('Hello');
  });

  it('asks for a full reload when scripts change, because they cannot be re-run safely', () => {
    expect(morphPage(parse('<title>One</title><style>.a { color: red }</style><script>window.x = 1</script><h1>Hello</h1>'))).toBe('reload');
  });

  it('asks for a full reload when the number of <style> blocks changes', () => {
    expect(morphPage(parse('<title>One</title><h1 class="t" data-x="1">Hello</h1>'))).toBe('reload');
  });

  it('ignores the Brushup overlay\'s own scripts when deciding whether scripts changed', () => {
    const own = document.createElement('script');
    own.textContent = 'window.__brushup={"mode":"static"}';
    document.body.append(own);
    expect(morphPage(parse('<title>One</title><style>.a { color: red }</style><h1 class="t" data-x="1">Hello</h1><p>World</p>'))).toBe('ok');
  });
});
