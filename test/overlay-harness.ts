/**
 * Runs the real overlay (src/overlay/index.ts) inside jsdom: a mock WebSocket stands in for the Brushup server,
 * and tests drive it with synthetic pointer / keyboard events, then assert on what it sent.
 * jsdom has no layout, so element rectangles are supplied per test.
 */
import { vi } from 'vitest';

export interface Sent {
  type: string;
  n?: number;
  [key: string]: any;
}

export class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = 0;
  sent: Sent[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    MockSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Overlay {
  /** Messages the overlay has sent the server, in order. */
  sent: Sent[];
  /** Deliver a message as if the server had sent it. */
  receive(msg: object): void;
  /** Run one animation frame (handles, pins and outlines are laid out per frame). */
  tick(): void;
  /** Reply to the n-th request the overlay made (default: the latest) with a result. */
  reply(result: object, type?: string): void;
  root: ShadowRoot;
  last(type: string): Sent;
  all(type: string): Sent[];
  /** Remove the overlay's window listeners (each test loads its own copy). */
  destroy(): void;
}

/** Give an element a layout box (jsdom reports zero for everything). */
export function layout(el: Element, rect: Rect) {
  el.getBoundingClientRect = () => ({ ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON() {} }) as DOMRect;
}

export function pointer(type: string, target: EventTarget, init: Partial<MouseEventInit> = {}) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, ...init }));
}

export const click = (el: Element, init: Partial<MouseEventInit> = {}) => {
  pointer('pointerdown', el, init);
  pointer('pointerup', el, init);
  pointer('click', el, init);
};

export function key(key: string, init: Partial<KeyboardEventInit> = {}, target: EventTarget = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init }));
}

/** Load a fresh copy of the overlay. `boot` is what the page would set as window.__brushup. */
export async function loadOverlay(boot: { mode: 'static' | 'dev'; hash?: string } = { mode: 'static' }): Promise<Overlay> {
  vi.resetModules();
  document.documentElement.querySelectorAll('#brushup-root').forEach((n) => n.remove());
  MockSocket.instances = [];
  let frame: (() => void) | null = null;
  vi.stubGlobal('WebSocket', MockSocket);
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frame = cb;
    return 1;
  });
  (window as any).__brushup = { hash: 'h0', ws: 'ws://test/__brushup/ws', ...boot };
  const added: [string, any, any][] = [];
  const originalAdd = window.addEventListener.bind(window);
  window.addEventListener = ((type: string, listener: any, options: any) => (added.push([type, listener, options]), originalAdd(type, listener, options))) as typeof window.addEventListener;
  await import('../src/overlay/index');
  window.addEventListener = originalAdd as typeof window.addEventListener;
  await Promise.resolve(); // let the mock socket "open"
  const socket = MockSocket.instances[0];
  const root = document.getElementById('brushup-root')!.shadowRoot!;
  const api: Overlay = {
    sent: socket.sent,
    root,
    receive: (msg) => socket.onmessage?.({ data: JSON.stringify(msg) }),
    tick() {
      const cb = frame;
      frame = null;
      cb?.();
    },
    reply(result, type = 'result') {
      const pending = [...socket.sent].reverse().find((m) => m.n !== undefined && m.type !== 'result');
      socket.onmessage?.({ data: JSON.stringify({ type, n: pending?.n, ...result }) });
    },
    last: (type) => [...socket.sent].reverse().find((m) => m.type === type)!,
    all: (type) => socket.sent.filter((m) => m.type === type),
    destroy: () => added.forEach(([t, l, o]) => window.removeEventListener(t, l, o)),
  };
  return api;
}

/** Let promises (the edit queue, rpc round-trips) settle. */
export const settle = () => new Promise((r) => setTimeout(r, 0));
