/** Small shared helpers. No framework, no dependencies. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Deterministic RNG so a pit's stones scatter the same way on every render. */
export function seeded(seed) {
  let t = (seed * 1831565813 + 0x6d2b79f5) >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const KEY = 'gebeta:prefs:v2';

export const prefs = {
  data: {
    sound: true,
    speed: 'normal',
    theme: 'night',
    name: '',
  },
  load() {
    try {
      Object.assign(this.data, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch {
      /* first run, or storage is off — defaults are fine */
    }
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* nothing to do about it */
    }
  },
  set(k, v) {
    this.data[k] = v;
    this.save();
  },
};

/** Count up to a number so scores feel earned rather than assigned. */
export function tickTo(node, from, to, ms = 420) {
  const start = performance.now();
  const step = (now) => {
    const p = clamp((now - start) / ms, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function toast(msg, kind = '') {
  const box = $('#toasts');
  if (!box) return;
  const t = el('div', `toast ${kind ? 'toast--' + kind : ''}`, msg);
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => {
    t.classList.remove('is-in');
    setTimeout(() => t.remove(), 320);
  }, 2600);
}
