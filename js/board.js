/**
 * Gebeta — board rendering and animation.
 *
 * The board never derives rules of its own. It is handed a state plus the
 * event log that produced it, and its whole job is to make that log look like
 * a hand moving stones: lift a pitful, drop them one at a time, sweep four
 * into the basket when they come due.
 *
 * The same class runs the playable board and the idle demo behind the menu,
 * which is why interactivity and sound are options rather than assumptions.
 */

import { PITS, ROW, ownerOf, applyMove, TOTAL_STONES } from './engine.js';
import { el, wait, seeded, clamp, prefersReducedMotion } from './util.js';
import * as sfx from './sfx.js';

/** Screen order: south row reads left to right, north row right to left. */
const SOUTH_ORDER = [0, 1, 2, 3, 4, 5];
const NORTH_ORDER = [11, 10, 9, 8, 7, 6];

const MAX_VISIBLE_STONES = 15;
const PILE_PER_ROW = 8;

/** Fixed phyllotaxis scatter so a pit's stones never jump when one is added. */
const SCATTER = [];
for (let p = 0; p < PITS; p++) {
  const rnd = seeded(p * 977 + 13);
  const spin = rnd() * Math.PI * 2;
  const pts = [];
  for (let k = 0; k < MAX_VISIBLE_STONES + 1; k++) {
    const r = Math.sqrt((k + 0.6) / (MAX_VISIBLE_STONES + 1)) * 30;
    const a = k * 2.3999632 + spin;
    pts.push({
      x: 50 + Math.cos(a) * r + (rnd() - 0.5) * 5,
      y: 50 + Math.sin(a) * r * 0.86 + (rnd() - 0.5) * 5,
      rot: Math.round(rnd() * 360),
      tone: k % 3,
      squash: 0.9 + rnd() * 0.22,
    });
  }
  SCATTER.push(pts);
}

export class Board {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = {
      interactive: true,
      sound: true,
      preview: true,
      speed: 1,
      labels: ['Player 1', 'Player 2'],
      ...opts,
    };
    this.state = null;
    this.viewSeat = 0; // whose pits this client may click; null = both
    this.onPlay = null;
    this.busy = false;
    this.skip = false;
    this._gen = 0;
    this.pitEls = [];
    this.wells = [];
    this.hand = [];
    this._build();
  }

  /* ---------------------------------------------------------------- build */

  _build() {
    this.root.classList.add('board');
    if (!this.opts.interactive) this.root.classList.add('board--static');
    this.root.innerHTML = '';

    const grid = el('div', 'board__grid');
    this.grid = grid;

    this.baskets = [this._basket(0), this._basket(1)];
    grid.appendChild(this.baskets[1]);

    const field = el('div', 'field');
    const frame = el('div', 'field__wood');
    field.appendChild(frame);

    const rowN = el('div', 'row row--north');
    const rowS = el('div', 'row row--south');
    for (const i of NORTH_ORDER) rowN.appendChild(this._pit(i));
    for (const i of SOUTH_ORDER) rowS.appendChild(this._pit(i));

    const flow = el('div', 'field__flow');
    flow.setAttribute('aria-hidden', 'true');
    flow.innerHTML =
      '<span class="flow__arrow flow__arrow--n"></span><span class="flow__arrow flow__arrow--s"></span>';

    frame.append(rowN, flow, rowS);
    grid.appendChild(field);
    grid.appendChild(this.baskets[0]);

    this.fx = el('div', 'fx');
    this.fx.setAttribute('aria-hidden', 'true');

    this.root.append(grid, this.fx);

    if (this.opts.interactive) {
      this.root.addEventListener('click', (e) => {
        const btn = e.target.closest('.pit');
        if (btn) this._tryPlay(Number(btn.dataset.pit));
      });
      this.root.addEventListener('pointerdown', () => {
        if (this.busy) this.skip = true;
      });
      this.root.addEventListener('pointerover', (e) => {
        const btn = e.target.closest('.pit');
        if (btn) this.showPreview(Number(btn.dataset.pit));
      });
      this.root.addEventListener('pointerout', (e) => {
        if (!e.relatedTarget || !this.root.contains(e.relatedTarget)) this.clearPreview();
        else if (e.target.closest('.pit') && !e.relatedTarget.closest?.('.pit'))
          this.clearPreview();
      });
      this.root.addEventListener('focusin', (e) => {
        const btn = e.target.closest('.pit');
        if (btn) this.showPreview(Number(btn.dataset.pit));
      });
      this.root.addEventListener('focusout', () => this.clearPreview());
      window.addEventListener('resize', () => {
        this._rects = null;
      });
    }
  }

  _pit(i) {
    const b = el('button', `pit pit--${ownerOf(i) === 0 ? 'south' : 'north'}`);
    b.dataset.pit = String(i);
    b.type = 'button';
    b.innerHTML =
      '<span class="pit__well"><span class="pit__stones"></span></span>' +
      '<span class="pit__count">0</span>' +
      '<span class="pit__pips"></span>' +
      '<span class="pit__tag"></span>';
    this.pitEls[i] = b;
    this.wells[i] = b.querySelector('.pit__well');
    return b;
  }

  _basket(seat) {
    const b = el('div', `basket basket--${seat === 0 ? 'south' : 'north'}`);
    b.dataset.seat = String(seat);
    b.innerHTML =
      `<span class="basket__name">${this.opts.labels[seat]}</span>` +
      '<span class="basket__vessel"><span class="basket__pile"></span></span>' +
      '<span class="basket__score">0</span>';
    return b;
  }

  setLabels(labels) {
    this.opts.labels = labels;
    this.baskets.forEach((b, i) => {
      b.querySelector('.basket__name').textContent = labels[i];
    });
  }

  /* --------------------------------------------------------------- render */

  /** Draw a state outright, with no animation. */
  render(state) {
    this.state = state;
    this._opened = state.opened.slice();
    for (let i = 0; i < PITS; i++) this._paintPit(i, state.pits[i], state.opened[i]);
    for (let s = 0; s < 2; s++) {
      this._paintBasket(s, state.scores[s]);
      this.baskets[s].querySelector('.basket__score').textContent = state.scores[s];
    }
    this._paintTurn();
  }

  _paintPit(i, count, opened) {
    const btn = this.pitEls[i];
    const well = this.wells[i];
    const holder = well.firstElementChild;
    btn.classList.toggle('is-open', !!opened);
    btn.classList.toggle('is-empty', count === 0);
    btn.classList.toggle('is-full', count > 8);
    btn.querySelector('.pit__count').textContent = count;
    btn.setAttribute(
      'aria-label',
      `${ownerOf(i) === 0 ? 'Bottom' : 'Top'} pit ${(i % ROW) + 1}: ${count} ${
        count === 1 ? 'stone' : 'stones'
      }${opened ? ', open' : ', closed'}`
    );

    const want = Math.min(count, MAX_VISIBLE_STONES);
    const have = holder.childElementCount;
    if (have > want) {
      for (let k = have - 1; k >= want; k--) holder.children[k].remove();
    } else {
      for (let k = have; k < want; k++) holder.appendChild(this._stone(i, k));
    }
    btn.classList.toggle('is-over', count > MAX_VISIBLE_STONES);
  }

  _stone(pit, k) {
    const p = SCATTER[pit][k % SCATTER[pit].length];
    const s = el('i', 'stone');
    s.style.cssText = `--x:${p.x}%;--y:${p.y}%;--r:${p.rot}deg;--sq:${p.squash}`;
    s.dataset.tone = String(p.tone);
    return s;
  }

  _paintBasket(seat, score) {
    const pile = this.baskets[seat].querySelector('.basket__pile');
    const want = Math.min(score, TOTAL_STONES);
    const have = pile.childElementCount;
    if (have > want) {
      for (let k = have - 1; k >= want; k--) pile.children[k].remove();
    } else {
      const rnd = seeded(seat * 31 + 7);
      for (let k = have; k < want; k++) {
        const rowIdx = Math.floor(k / PILE_PER_ROW);
        const col = k % PILE_PER_ROW;
        const s = el('i', 'stone stone--piled');
        const jitterX = (rnd() - 0.5) * 6;
        const jitterY = (rnd() - 0.5) * 5;
        s.style.cssText =
          `--x:${((col + 0.5) / PILE_PER_ROW) * 100 + jitterX}%;` +
          `--y:${100 - rowIdx * 15.5 - 9 + jitterY}%;` +
          `--r:${Math.round(rnd() * 360)}deg;--sq:${0.92 + rnd() * 0.2}`;
        s.dataset.tone = String(k % 3);
        pile.appendChild(s);
      }
    }
    this.baskets[seat].style.setProperty('--fill', (score / TOTAL_STONES).toFixed(3));
  }

  _paintTurn() {
    const s = this.state;
    const active = s && !s.over ? s.turn : -1;
    this.root.classList.toggle('turn-south', active === 0);
    this.root.classList.toggle('turn-north', active === 1);
    this.baskets[0].classList.toggle('is-active', active === 0);
    this.baskets[1].classList.toggle('is-active', active === 1);
    for (let i = 0; i < PITS; i++) {
      const interactive = this.opts.interactive;
      const playable =
        s &&
        !s.over &&
        !this.busy &&
        ownerOf(i) === s.turn &&
        s.pits[i] > 0 &&
        (this.viewSeat == null || this.viewSeat === s.turn);
      this.pitEls[i].classList.toggle('is-playable', !!playable);
      this.pitEls[i].disabled = interactive ? !playable : true;
      if (!interactive) this.pitEls[i].tabIndex = -1;
    }
  }

  /* ------------------------------------------------------------ geometry */

  _measure() {
    const box = this.fx.getBoundingClientRect();
    const centers = [];
    for (let i = 0; i < PITS; i++) {
      const r = this.wells[i].getBoundingClientRect();
      centers[i] = {
        x: r.left - box.left + r.width / 2,
        y: r.top - box.top + r.height / 2,
        w: r.width,
        h: r.height,
      };
    }
    const baskets = this.baskets.map((b) => {
      const r = b.querySelector('.basket__vessel').getBoundingClientRect();
      return {
        x: r.left - box.left + r.width / 2,
        y: r.top - box.top + r.height * 0.62,
      };
    });
    this._rects = { centers, baskets };
    return this._rects;
  }

  _geo() {
    return this._rects || this._measure();
  }

  /** Where the picked-up handful hovers: just outside the owner's row. */
  _handPoint(pit) {
    const c = this._geo().centers[pit];
    const away = ownerOf(pit) === 0 ? 1 : -1;
    return { x: c.x, y: c.y + away * c.h * 0.92 };
  }

  _stonePoint(pit, index) {
    const c = this._geo().centers[pit];
    const p = SCATTER[pit][Math.min(index, MAX_VISIBLE_STONES)];
    return {
      x: c.x + (p.x - 50) / 100 * c.w,
      y: c.y + (p.y - 50) / 100 * c.h,
    };
  }

  /* ------------------------------------------------------------ animation */

  get _scale() {
    if (prefersReducedMotion()) return 0.05;
    return this.skip ? 0.14 : this.opts.speed;
  }

  _flyer(x, y, tone = 0) {
    const n = el('i', 'stone stone--fly');
    n.dataset.tone = String(tone);
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    n._x = x;
    n._y = y;
    this.fx.appendChild(n);
    return n;
  }

  async _move(n, to, { dur = 150, arc = 26, spin = 0, scale = 1 } = {}) {
    const dx = to.x - n._x;
    const dy = to.y - n._y;
    const lift = -Math.abs(arc) - Math.min(60, Math.hypot(dx, dy) * 0.12);
    // The base transform centres the stone on its coordinates, so every
    // keyframe has to carry that -50% along with the travel offset.
    const at = (x, y, rot, s) =>
      `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rot}deg) scale(${s})`;
    const a = n.animate(
      [
        { transform: at(0, 0, 0, 1) },
        { transform: at(dx / 2, dy / 2 + lift, spin / 2, 1 + 0.16 * scale), offset: 0.5 },
        { transform: at(dx, dy, spin, 1) },
      ],
      { duration: Math.max(16, dur), easing: 'cubic-bezier(.36,.06,.32,1)' }
    );
    n._x = to.x;
    n._y = to.y;
    await a.finished.catch(() => {});
    n.style.left = to.x + 'px';
    n.style.top = to.y + 'px';
    n.style.transform = '';
  }

  _pulse(pit, cls = 'is-hit') {
    const b = this.pitEls[pit];
    b.classList.remove(cls);
    void b.offsetWidth;
    b.classList.add(cls);
    setTimeout(() => b.classList.remove(cls), 420);
  }

  _burst(point, kind = '') {
    if (prefersReducedMotion()) return;
    for (let i = 0; i < 9; i++) {
      const s = el('i', `spark ${kind}`);
      const a = (i / 9) * Math.PI * 2 + Math.random();
      const d = 26 + Math.random() * 42;
      s.style.left = point.x + 'px';
      s.style.top = point.y + 'px';
      this.fx.appendChild(s);
      s.animate(
        [
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${
              Math.sin(a) * d
            }px)) scale(0)`,
            opacity: 0,
          },
        ],
        { duration: 480 + Math.random() * 260, easing: 'cubic-bezier(.2,.7,.3,1)' }
      ).finished.finally(() => s.remove());
    }
  }

  /**
   * Play an event log through. Resolves once the last stone has landed.
   */
  async playEvents(events, hooks = {}) {
    const gen = ++this._gen;
    this.busy = true;
    this.skip = false;
    this._opened = this.state ? this.state.opened.slice() : new Array(PITS).fill(false);
    this.clearPreview();
    this._measure();
    this._paintTurn();

    for (const ev of events) {
      if (this._gen !== gen) return; // a new game started under us
      switch (ev.t) {
        case 'pickup':
          await this._animPickup(ev);
          break;
        case 'sow':
          await this._animSow(ev);
          break;
        case 'capture':
          await this._animCapture(ev);
          break;
        case 'relay':
          this._pulse(ev.pit, 'is-relay');
          if (this.opts.sound) sfx.play('relay');
          await wait(150 * this._scale);
          break;
        case 'sweep':
          await this._animSweep(ev);
          break;
        case 'endturn':
          if (this.opts.sound && !this.skip) sfx.play('turn');
          break;
        default:
          break;
      }
      hooks.onEvent?.(ev);
    }
    if (this._gen !== gen) return;

    // Drop anything still in hand (defensive — the log should have emptied it).
    for (const n of this.hand) n.remove();
    this.hand = [];

    this.busy = false;
    this.skip = false;
    this._paintTurn();
  }

  async _animPickup(ev) {
    const count = ev.count;
    this._opened[ev.pit] = true;
    this._paintPit(ev.pit, 0, true);
    if (ev.opened) this._pulse(ev.pit, 'is-opening');
    if (this.opts.sound) sfx.play('pickup');

    const hp = this._handPoint(ev.pit);
    const jobs = [];
    const shown = Math.min(count, MAX_VISIBLE_STONES);
    for (let k = 0; k < shown; k++) {
      const from = this._stonePoint(ev.pit, k);
      const n = this._flyer(from.x, from.y, SCATTER[ev.pit][k].tone);
      const a = (k / shown) * Math.PI * 2;
      const r = 5 + shown * 1.05;
      this.hand.push(n);
      jobs.push(
        this._move(
          n,
          { x: hp.x + Math.cos(a) * r, y: hp.y + Math.sin(a) * r * 0.7 },
          { dur: 190 * this._scale, arc: 10, spin: 40 }
        )
      );
    }
    // Stones beyond the visible cap still need to be sown, so keep placeholders.
    for (let k = shown; k < count; k++) {
      const n = this._flyer(hp.x, hp.y, k % 3);
      n.style.opacity = '0';
      this.hand.push(n);
    }
    await Promise.all(jobs);
  }

  async _animSow(ev) {
    const n = this.hand.pop();
    const index = Math.min(ev.count - 1, MAX_VISIBLE_STONES);
    const to = this._stonePoint(ev.pit, index);
    if (n) {
      n.style.opacity = '';
      await this._move(n, to, { dur: 155 * this._scale, arc: 20, spin: 120 });
      n.remove();
    }
    this._paintPit(ev.pit, ev.count, this._opened[ev.pit]);
    this._pulse(ev.pit);
    if (this.opts.sound) sfx.play('stone');
    if (this._scale > 0.3) await wait(28 * this._scale);
  }

  async _animCapture(ev) {
    const g = this._geo();
    const target = g.baskets[ev.seat];
    const basket = this.baskets[ev.seat];
    const scoreEl = basket.querySelector('.basket__score');
    const before = ev.total - ev.amount;

    this._pulse(ev.pit, 'is-taken');
    this._paintPit(ev.pit, 0, true);
    if (this.opts.sound) sfx.play('capture');
    this._burst(g.centers[ev.pit], 'spark--gold');

    const jobs = [];
    for (let k = 0; k < ev.amount; k++) {
      const from = this._stonePoint(ev.pit, k);
      const n = this._flyer(from.x, from.y, k % 3);
      jobs.push(
        (async () => {
          await wait(k * 52 * this._scale);
          await this._move(n, target, { dur: 340 * this._scale, arc: 52, spin: 220 });
          n.remove();
          this._paintBasket(ev.seat, before + k + 1);
          scoreEl.textContent = String(before + k + 1);
          basket.classList.add('is-bump');
          setTimeout(() => basket.classList.remove('is-bump'), 320);
        })()
      );
    }
    await Promise.all(jobs);
  }

  async _animSweep(ev) {
    if (this.opts.sound) sfx.play('sweep');
    const g = this._geo();
    const target = g.baskets[ev.seat];
    const scoreEl = this.baskets[ev.seat].querySelector('.basket__score');
    let running = ev.total - ev.amount;
    const jobs = [];
    let n = 0;
    for (const { pit, count } of ev.pits) {
      this._paintPit(pit, 0, true);
      for (let k = 0; k < Math.min(count, MAX_VISIBLE_STONES); k++) {
        const from = this._stonePoint(pit, k);
        const fly = this._flyer(from.x, from.y, k % 3);
        const delay = n++ * 34 * this._scale;
        jobs.push(
          (async () => {
            await wait(delay);
            await this._move(fly, target, { dur: 380 * this._scale, arc: 60, spin: 180 });
            fly.remove();
          })()
        );
      }
      running += count;
    }
    await Promise.all(jobs);
    this._paintBasket(ev.seat, ev.total);
    scoreEl.textContent = String(ev.total);
    this.baskets[ev.seat].classList.add('is-bump');
    this._burst(target, 'spark--gold');
    await wait(260 * this._scale);
    void running;
  }

  /* -------------------------------------------------------------- preview */

  showPreview(pit) {
    if (!this.opts.preview || this.busy || !this.state || this.state.over) return;
    if (ownerOf(pit) !== this.state.turn || this.state.pits[pit] === 0) return;
    if (this.viewSeat != null && this.viewSeat !== this.state.turn) return;

    const res = applyMove(this.state, pit);
    if (!res.ok) return;

    const drops = new Array(PITS).fill(0);
    const takes = new Array(PITS).fill(0);
    let gain = 0;
    let laps = 0;
    for (const ev of res.events) {
      if (ev.t === 'sow') drops[ev.pit]++;
      else if (ev.t === 'capture' && ev.seat === this.state.turn) {
        takes[ev.pit] += ev.amount;
        gain += ev.amount;
      } else if (ev.t === 'relay') laps++;
    }
    const end = res.events.find((e) => e.t === 'endturn');
    const swept = res.events.find((e) => e.t === 'sweep');

    this.clearPreview();
    this.root.classList.add('is-previewing');
    this.pitEls[pit].classList.add('is-source');

    for (let i = 0; i < PITS; i++) {
      if (!drops[i] && !takes[i]) continue;
      const b = this.pitEls[i];
      b.classList.add('is-onpath');
      if (takes[i]) b.classList.add('is-target');
      const pips = b.querySelector('.pit__pips');
      const shown = Math.min(drops[i], 5);
      pips.innerHTML = '<i></i>'.repeat(shown) + (drops[i] > shown ? `<b>+${drops[i] - shown}</b>` : '');
      if (takes[i]) b.querySelector('.pit__tag').textContent = `+${takes[i]}`;
    }

    const parts = [];
    if (gain) parts.push(`takes ${gain}`);
    if (laps) parts.push(`${laps} more ${laps === 1 ? 'lap' : 'laps'}`);
    if (swept) parts.push(swept.seat === this.state.turn ? `sweeps ${swept.amount}` : `gives up ${swept.amount}`);
    else if (end) parts.push('then their turn');
    this._chip(pit, parts.join(' · ') || 'no gain', gain > 0);
  }

  _chip(pit, text, good) {
    const c = this._geo().centers[pit];
    const chip = el('div', `chip ${good ? 'chip--good' : ''}`, text);
    const away = ownerOf(pit) === 0 ? 1 : -1;
    chip.style.left = c.x + 'px';
    chip.style.top = c.y + away * c.h * 0.95 + 'px';
    this.fx.appendChild(chip);
    this._chipEl = chip;
  }

  clearPreview() {
    this.root.classList.remove('is-previewing');
    for (const b of this.pitEls) {
      if (!b) continue;
      b.classList.remove('is-onpath', 'is-target', 'is-source');
      b.querySelector('.pit__pips').innerHTML = '';
      b.querySelector('.pit__tag').textContent = '';
    }
    this._chipEl?.remove();
    this._chipEl = null;
  }

  flashHint(pit) {
    if (pit == null) return;
    const b = this.pitEls[pit];
    b.classList.add('is-hinted');
    setTimeout(() => b.classList.remove('is-hinted'), 2200);
  }

  focusPlayable() {
    const first = this.pitEls.find((b) => b.classList.contains('is-playable'));
    first?.focus();
  }

  _tryPlay(pit) {
    if (this.busy || !this.state || this.state.over) return;
    if (ownerOf(pit) !== this.state.turn) return;
    if (this.viewSeat != null && this.viewSeat !== this.state.turn) return;
    if (this.state.pits[pit] === 0) return;
    this.clearPreview();
    this.onPlay?.(pit);
  }

  /** Stop any animation in flight — used when a new game starts mid-turn. */
  abort() {
    this._gen++;
    this.busy = false;
    this.skip = false;
    for (const n of this.hand) n.remove();
    this.hand = [];
    this.fx.innerHTML = '';
    this._chipEl = null;
  }

  destroy() {
    this.abort();
    this.root.innerHTML = '';
  }
}

export { SOUTH_ORDER, NORTH_ORDER };
export const pitsInScreenOrder = (seat) => (seat === 0 ? SOUTH_ORDER : NORTH_ORDER);
export const boardClamp = clamp;
