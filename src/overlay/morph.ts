/** Update the live DOM in place to match a freshly fetched copy of the page, keeping node identity (and so selection, scroll, focus). */

const OURS = (s: HTMLScriptElement) => s.src.endsWith('/__ascend/overlay.js') || (s.textContent ?? '').startsWith('window.__ascend=');

const scriptSignature = (d: Document) =>
  [...d.querySelectorAll('script')]
    .filter((s) => !OURS(s))
    .map((s) => `${s.src}\n${s.textContent}`)
    .join('\0');

function syncAttrs(cur: Element, nxt: Element) {
  for (const a of [...cur.attributes]) if (!nxt.hasAttribute(a.name)) cur.removeAttribute(a.name);
  for (const a of [...nxt.attributes]) if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
}

function morphChildren(cur: Node, nxt: Node) {
  const a = [...cur.childNodes];
  const b = [...nxt.childNodes];
  b.forEach((y, i) => {
    const x = a[i];
    if (!x) cur.appendChild(document.importNode(y, true));
    else if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) cur.replaceChild(document.importNode(y, true), x);
    else if (x.nodeType === Node.ELEMENT_NODE) {
      syncAttrs(x as Element, y as Element);
      morphChildren(x, y);
    } else if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
  });
  for (let i = a.length - 1; i >= b.length; i--) cur.removeChild(a[i]);
}

/** Returns 'reload' when the change can't be applied in place (scripts changed, head structure changed). */
export function morphPage(next: Document): 'ok' | 'reload' {
  if (scriptSignature(document) !== scriptSignature(next)) return 'reload';

  const curStyles = [...document.head.querySelectorAll('style')];
  const nextStyles = [...next.head.querySelectorAll('style')];
  if (curStyles.length !== nextStyles.length) return 'reload';
  curStyles.forEach((s, i) => {
    if (s.textContent !== nextStyles[i].textContent) s.textContent = nextStyles[i].textContent;
  });
  if (next.title !== document.title) document.title = next.title;

  syncAttrs(document.documentElement, next.documentElement);
  syncAttrs(document.body, next.body);
  morphChildren(document.body, next.body);
  return 'ok';
}

/** Linked stylesheets don't re-fetch when the file changes on disk; swap in a cache-busted copy. */
export function refreshStylesheets() {
  document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]').forEach((old) => {
    const url = new URL(old.href, location.href);
    if (url.origin !== location.origin) return;
    url.searchParams.set('ascend', String(Date.now()));
    const fresh = old.cloneNode() as HTMLLinkElement;
    fresh.href = url.href;
    fresh.onload = () => old.remove();
    fresh.onerror = () => fresh.remove();
    old.after(fresh);
  });
}
