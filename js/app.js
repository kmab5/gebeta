/**
 * Gebeta — application shell.
 *
 * Owns the screens, the mode setup, the turn loop and everything that isn't
 * rules (engine.js), drawing (board.js) or the wire (net.js).
 */

import { createState, applyMove, legalMoves, ownerOf, ROW } from './engine.js';
import { chooseMove, suggestMove, DIFFICULTIES } from './ai.js';
import { Board, pitsInScreenOrder } from './board.js';
import { Online, savedServer, saveServer } from './net.js';
import * as sfx from './sfx.js';
import { $, $$, el, wait, prefs, toast, prefersReducedMotion } from './util.js';

const SPEEDS = { calm: 1.35, normal: 1, quick: 0.55 };
const EMOTES = ['👏', '😤', '😅', '🔥', '🤝'];

const app = {
  screen: 'home',
  mode: null,
  difficulty: 'medium',
  humanSeat: 0,
  names: ['Player 1', 'Player 2'],
  state: null,
  board: null,
  demo: null,
  net: null,
  online: { seat: null, code: null, ready: false, oppReady: false },
  thinking: false,
};

/* ------------------------------------------------------------------ screens */

function show(name) {
  app.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('is-active', s.dataset.screen === name));
  document.body.dataset.screen = name;
  if (name === 'home') startDemo();
  else stopDemo();
  if (name === 'setup-online') refreshTransport();
  const focusable = $(`.screen[data-screen="${name}"] button, .screen[data-screen="${name}"] input`);
  if (name !== 'game') focusable?.focus({ preventScroll: true });
}

function openDialog(id) {
  const d = $('#' + id);
  if (!d) return;
  d.hidden = false;
  requestAnimationFrame(() => d.classList.add('is-open'));
  d.querySelector('button, input')?.focus({ preventScroll: true });
}

function closeDialog(d) {
  d.classList.remove('is-open');
  setTimeout(() => {
    d.hidden = true;
  }, 220);
}

/* -------------------------------------------------------------- game setup */

function beginGame({ mode, startingSeat = 0, difficulty, humanSeat = 0, names, state }) {
  app.gen = (app.gen || 0) + 1;
  app.board.abort();
  app.mode = mode;
  if (difficulty) app.difficulty = difficulty;
  app.humanSeat = humanSeat;
  app.names = names || app.names;
  app.state = state || createState(startingSeat);
  app.online.ready = false;
  app.online.oppReady = false;

  app.board.setLabels(app.names);
  app.board.viewSeat = mode === 'local' ? null : humanSeat;
  app.board.render(app.state);
  app.board._rects = null;

  $('#move-log').innerHTML = '';
  $('#emote-bar').hidden = mode !== 'online';
  $('#btn-hint').hidden = mode === 'online';
  $('#result').hidden = true;
  $('#result').classList.remove('is-open');

  show('game');
  updateHud();
  requestAnimationFrame(() => {
    app.board._rects = null;
    app.board.render(app.state);
    maybeCpu();
  });
}

/* ---------------------------------------------------------------- turn loop */

function localTurnAllowed() {
  if (!app.state || app.state.over || app.board.busy) return false;
  if (app.mode === 'local') return true;
  return app.state.turn === app.humanSeat;
}

async function commit(pit) {
  if (app.board.busy || !app.state || app.state.over) return;

  if (app.mode === 'online') {
    if (app.state.turn !== app.online.seat) return;
    app.net?.move(pit);
    return;
  }

  const res = applyMove(app.state, pit);
  if (!res.ok) return;
  await runTurn(res);
}

let turnChain = Promise.resolve();

function runTurn(res) {
  turnChain = turnChain.then(() => playTurn(res)).catch((err) => console.error(err));
  return turnChain;
}

async function playTurn(res) {
  const gen = app.gen;
  const mover = app.state.turn;
  const from = res.events[0]?.pit;
  app.board.state = app.state; // animate from the position we were in
  const next = res.state;

  await app.board.playEvents(res.events);
  if (gen !== app.gen) return; // abandoned mid-turn
  app.state = next;
  app.board.state = next;
  app.board.render(next);

  logTurn(mover, from, res.events);
  updateHud();

  if (next.over) {
    await wait(520);
    showResult();
    return;
  }
  maybeCpu();
}

function maybeCpu() {
  if (app.mode !== 'cpu' || !app.state || app.state.over) return;
  if (app.state.turn === app.humanSeat) return;
  const cfg = DIFFICULTIES[app.difficulty];
  const [lo, hi] = cfg.think;
  const gen = app.gen;
  setThinking(true);
  setTimeout(() => {
    if (gen !== app.gen) return setThinking(false);
    if (app.mode !== 'cpu' || !app.state || app.state.over) return setThinking(false);
    const pit = chooseMove(app.state, app.difficulty);
    setThinking(false);
    if (pit != null) commit(pit);
  }, lo + Math.random() * (hi - lo));
}

function setThinking(v) {
  app.thinking = v;
  $('#turn-sub').textContent = v ? 'thinking…' : '';
  $('#turn-line').classList.toggle('is-thinking', v);
}

/* ------------------------------------------------------------------- chrome */

function updateHud() {
  const s = app.state;
  if (!s) return;
  const line = $('#turn-line');
  const sub = $('#turn-sub');

  if (s.over) {
    line.textContent = 'Game over';
    sub.textContent = '';
  } else {
    const name = app.names[s.turn];
    const yours =
      (app.mode === 'cpu' && s.turn === app.humanSeat) ||
      (app.mode === 'online' && s.turn === app.online.seat);
    line.textContent = yours ? `Your move, ${name}` : `${name} to move`;
    line.dataset.seat = String(s.turn);
    if (!app.thinking) {
      sub.textContent =
        app.mode === 'local'
          ? `${name} plays the ${s.turn === 0 ? 'bottom' : 'top'} row`
          : yours
            ? 'pick a pit'
            : 'waiting';
    }
  }
}

function logTurn(seat, pit, events) {
  const gained = events
    .filter((e) => e.t === 'capture' && e.seat === seat)
    .reduce((n, e) => n + e.amount, 0);
  const laps = events.filter((e) => e.t === 'relay').length;
  const chip = el('div', `log-chip log-chip--${seat === 0 ? 'south' : 'north'}`);
  chip.innerHTML =
    `<b>${app.names[seat]}</b><span>pit ${((pit ?? 0) % ROW) + 1}</span>` +
    (laps ? `<span class="log-chip__lap">${laps + 1} laps</span>` : '') +
    (gained ? `<em>+${gained}</em>` : '');
  const log = $('#move-log');
  log.prepend(chip);
  while (log.childElementCount > 12) log.lastElementChild.remove();
}

/* ------------------------------------------------------------------ results */

function showResult() {
  const s = app.state;
  const box = $('#result');
  const [a, b] = s.scores;
  const winner = s.winner;

  let title;
  let note;
  if (winner === 'draw') {
    title = 'Dead even';
    note = 'Twenty-four each. Nobody hands over the board.';
    sfx.play('draw');
  } else {
    const won =
      (app.mode === 'cpu' && winner === app.humanSeat) ||
      (app.mode === 'online' && winner === app.online.seat);
    title = `${app.names[winner]} wins`;
    const margin = Math.abs(a - b);
    note =
      margin <= 4
        ? 'One capture in it.'
        : margin >= 20
          ? 'Not especially close.'
          : `By ${margin} stones.`;
    if (app.mode === 'local') sfx.play('win');
    else sfx.play(won ? 'win' : 'lose');
  }

  $('#result-title').textContent = title;
  $('#result-note').textContent = note;
  $('#result-score').innerHTML =
    `<span class="rs rs--south ${a >= b ? 'is-top' : ''}"><b>${a}</b><i>${app.names[0]}</i></span>` +
    '<span class="rs__v">–</span>' +
    `<span class="rs rs--north ${b >= a ? 'is-top' : ''}"><b>${b}</b><i>${app.names[1]}</i></span>`;
  $('#result-eyebrow').textContent = `${s.turnCount} turns`;
  $('#btn-again').innerHTML =
    '<svg><use href="#i-again"/></svg>' + (app.mode === 'online' ? 'Ask for a rematch' : 'Play again');

  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('is-open'));
}

function replay() {
  if (app.mode === 'online') {
    app.online.ready = true;
    app.net?.rematch();
    $('#btn-again').innerHTML = '<svg><use href="#i-again"/></svg>Waiting for them…';
    $('#btn-again').disabled = true;
    return;
  }
  $('#result').classList.remove('is-open');
  $('#result').hidden = true;
  const startingSeat = app.state ? 1 - (app.state.lastMove?.seat ?? 0) : 0;
  beginGame({
    mode: app.mode,
    startingSeat: app.mode === 'cpu' ? startingSeat : 0,
    difficulty: app.difficulty,
    humanSeat: app.humanSeat,
    names: app.names,
  });
}

function toMenu() {
  app.gen = (app.gen || 0) + 1;
  app.board.abort();
  $('#result').classList.remove('is-open');
  $('#result').hidden = true;
  if (app.mode === 'online') {
    app.net?.leave();
    app.net?.dispose();
    app.net = null;
  }
  app.mode = null;
  app.state = null;
  show('home');
}

/* ------------------------------------------------------------------- online */

function netStatus(text, kind = '') {
  const a = $('#online-status');
  const b = $('#lobby-status');
  for (const n of [a, b]) {
    if (!n) continue;
    n.textContent = text;
    n.className = 'net-status' + (kind ? ' net-status--' + kind : '');
  }
}

async function refreshTransport() {
  const note = $('#transport-note');
  if (!note) return;
  note.textContent = 'Checking how to connect…';
  try {
    note.textContent = await ensureNet().describe();
  } catch (err) {
    note.textContent = err.message;
  }
}

function ensureNet() {
  if (app.net) return app.net;
  const net = new Online();
  app.net = net;

  net.on('slow', (m) => netStatus(m, 'wait'));
  net.on('down', (m) => toast(m, 'bad'));
  net.on('message', (p) => toast(p.text, p.kind));

  net.on('room', (p) => {
    app.online.code = p.code;
    $('#room-code').textContent = p.code;
    const list = $('#seat-list');
    list.innerHTML = '';
    for (let seat = 0; seat < 2; seat++) {
      const player = p.players.find((x) => x.seat === seat);
      const li = el('li', `seat ${player ? 'is-filled' : ''} seat--${seat === 0 ? 'south' : 'north'}`);
      li.innerHTML =
        `<span class="seat__row">${seat === 0 ? 'Bottom row' : 'Top row'}</span>` +
        `<span class="seat__name">${player ? escapeHtml(player.name) : 'Empty'}</span>` +
        `<span class="seat__state">${
          player ? (player.connected ? (player.seat === app.online.seat ? 'you' : 'ready') : 'reconnecting…') : 'waiting'
        }</span>`;
      list.appendChild(li);
    }
    if (p.players.length < 2) netStatus('Waiting for a second player. The code works until you leave.');
    else netStatus('Both seats filled.', 'good');

    // If the other player actually left (rather than briefly dropping), there
    // is no game to sit in front of — go back to the room and wait.
    if (app.mode === 'online' && app.screen === 'game' && p.status === 'waiting') {
      app.board.abort();
      $('#result').classList.remove('is-open');
      $('#result').hidden = true;
      show('lobby');
      toast('They left. The room is still yours.', 'bad');
    }
  });

  net.on('start', (p) => {
    app.online.seat = p.seat ?? app.online.seat;
    const names = p.names || app.names;
    $('#btn-again').disabled = false;
    beginGame({
      mode: 'online',
      humanSeat: app.online.seat,
      names,
      state: p.state,
    });
    toast(app.online.seat === p.state.turn ? 'You start.' : 'They start.', 'good');
  });

  net.on('events', async (p) => {
    if (!app.state) return;
    await runTurn({ ok: true, state: p.state, events: p.events });
  });

  net.on('sync', (p) => {
    app.state = p.state;
    app.board.state = p.state;
    app.board.render(p.state);
    updateHud();
  });

  net.on('emote', (p) => showEmote(p.seat, p.id));

  net.on('resumed', (p) => {
    toast('Back in.', 'good');
    if (p.state) {
      app.state = p.state;
      app.board.render(p.state);
      updateHud();
    }
  });

  return net;
}

function showEmote(seat, id) {
  const holder = $('#board');
  const pop = el('div', `emote-pop emote-pop--${seat === 0 ? 'south' : 'north'}`, EMOTES[id] || '👋');
  holder.appendChild(pop);
  setTimeout(() => pop.remove(), 1800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* --------------------------------------------------------------- home demo */

function startDemo() {
  const host = $('#home-demo');
  if (!host) return;
  if (!app.demo) {
    app.demo = new Board(host, {
      interactive: false,
      sound: false,
      speed: 1.25,
      labels: ['', ''],
    });
  }
  if (app.demoRunning) return;
  app.demoRunning = true;
  runDemo();
}

function stopDemo() {
  app.demoRunning = false;
}

async function runDemo() {
  const b = app.demo;
  let s = createState(Math.random() < 0.5 ? 0 : 1);
  b.render(s);
  if (prefersReducedMotion()) {
    for (let i = 0; i < 6 && !s.over; i++) s = applyMove(s, chooseMove(s, 'medium')).state;
    b.render(s);
    return;
  }
  while (app.demoRunning) {
    if (document.hidden) {
      await wait(600);
      continue;
    }
    if (s.over) {
      await wait(1800);
      s = createState(Math.random() < 0.5 ? 0 : 1);
      b.render(s);
      await wait(700);
      continue;
    }
    const moves = legalMoves(s);
    if (!moves.length) break;
    const pit = chooseMove(s, Math.random() < 0.5 ? 'easy' : 'hard');
    const res = applyMove(s, pit);
    b.state = s;
    await b.playEvents(res.events);
    s = res.state;
    b.state = s;
    b.render(s);
    await wait(520);
  }
}

/* ------------------------------------------------------------------- wiring */

function applyPrefs() {
  const p = prefs.load();
  document.documentElement.dataset.theme = p.theme;
  sfx.setEnabled(p.sound);
  $('#set-sound')?.setAttribute('aria-checked', String(p.sound));
  $$('[data-speed]').forEach((b) => b.classList.toggle('is-on', b.dataset.speed === p.speed));
  $$('[data-theme-set]').forEach((b) => b.classList.toggle('is-on', b.dataset.themeSet === p.theme));
  $('#btn-sound')?.firstElementChild?.firstElementChild?.setAttribute(
    'href',
    p.sound ? '#i-sound' : '#i-mute'
  );
  if (app.board) {
    app.board.opts.sound = p.sound;
    app.board.opts.speed = SPEEDS[p.speed] ?? 1;
  }
  if ($('#online-name') && p.name) $('#online-name').value = p.name;
}

function buildLevels() {
  const host = $('#level-list');
  host.innerHTML = '';
  for (const key of ['easy', 'medium', 'hard', 'merciless']) {
    const d = DIFFICULTIES[key];
    const b = el('button', 'level' + (key === app.difficulty ? ' is-on' : ''));
    b.dataset.level = key;
    b.innerHTML =
      `<span class="level__bars" aria-hidden="true">${'<i></i>'.repeat(
        ['easy', 'medium', 'hard', 'merciless'].indexOf(key) + 1
      )}</span><span class="level__name">${d.name}</span><span class="level__desc">${d.blurb}</span>`;
    host.appendChild(b);
  }
}

function wire() {
  // navigation
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openDialog(b.dataset.open)));
  $$('.overlay').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) closeDialog(d);
    });
  });
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  document.addEventListener('click', (e) => {
    if (e.target.closest('button')) sfx.play('ui');
  });

  // local
  $$('[data-start-local]').forEach((b) =>
    b.addEventListener('click', () =>
      beginGame({
        mode: 'local',
        startingSeat: Number(b.dataset.startLocal),
        names: ['Player 1', 'Player 2'],
      })
    )
  );

  // cpu
  $('#level-list').addEventListener('click', (e) => {
    const b = e.target.closest('.level');
    if (!b) return;
    app.difficulty = b.dataset.level;
    $$('.level').forEach((x) => x.classList.toggle('is-on', x === b));
  });
  $$('[data-cpu-seat]').forEach((b) =>
    b.addEventListener('click', () => {
      app.humanSeat = Number(b.dataset.cpuSeat);
      $$('[data-cpu-seat]').forEach((x) => x.classList.toggle('is-on', x === b));
    })
  );
  $('#start-cpu').addEventListener('click', () => {
    const cpuName = DIFFICULTIES[app.difficulty].name;
    const names = ['', ''];
    names[app.humanSeat] = 'You';
    names[1 - app.humanSeat] = `Computer · ${cpuName}`;
    beginGame({ mode: 'cpu', startingSeat: 0, humanSeat: app.humanSeat, names });
  });

  // online
  $('#online-name').addEventListener('change', (e) => prefs.set('name', e.target.value.trim()));
  const serverField = $('#server-url');
  serverField.value = savedServer();
  const resetTransport = () => {
    app.net?.dispose();
    app.net = null;
    refreshTransport();
  };
  serverField.addEventListener('change', (e) => {
    saveServer(e.target.value);
    serverField.value = savedServer();
    resetTransport();
  });
  $('#clear-server').addEventListener('click', () => {
    saveServer('');
    serverField.value = '';
    resetTransport();
  });
  $('#create-room').addEventListener('click', async () => {
    const name = ($('#online-name').value || 'Player').trim().slice(0, 14);
    prefs.set('name', name);
    netStatus('Opening a room…');
    try {
      const res = await ensureNet().create(name);
      app.online.seat = res.seat;
      app.names = res.names || app.names;
      show('lobby');
      netStatus('Waiting for a second player. The code works until you leave.');
    } catch (err) {
      netStatus(err.message, 'bad');
    }
  });
  $('#join-room').addEventListener('click', joinRoom);
  $('#join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  $('#join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  $('#copy-code').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${app.online.code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied.', 'good');
    } catch {
      toast(`Room code: ${app.online.code}`);
    }
  });
  $('#leave-lobby').addEventListener('click', () => {
    app.net?.leave();
    app.net?.dispose();
    app.net = null;
    show('setup-online');
    netStatus('');
  });

  // in-game chrome
  $('#btn-home').addEventListener('click', toMenu);
  $('#btn-again').addEventListener('click', replay);
  $('#btn-lobby').addEventListener('click', toMenu);
  $('#btn-sound').addEventListener('click', () => toggleSound());
  $('#btn-hint').addEventListener('click', hint);

  // settings
  $('#set-sound').addEventListener('click', () => toggleSound());
  $$('[data-speed]').forEach((b) =>
    b.addEventListener('click', () => {
      prefs.set('speed', b.dataset.speed);
      applyPrefs();
    })
  );
  $$('[data-theme-set]').forEach((b) =>
    b.addEventListener('click', () => {
      prefs.set('theme', b.dataset.themeSet);
      applyPrefs();
    })
  );

  // emotes
  const bar = $('#emote-bar');
  EMOTES.forEach((glyph, i) => {
    const b = el('button', 'emote', glyph);
    b.type = 'button';
    b.title = 'Send';
    b.addEventListener('click', () => {
      app.net?.sendEmote(i);
      showEmote(app.online.seat ?? 0, i);
    });
    bar.appendChild(b);
  });
}

async function joinRoom() {
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length !== 4) return netStatus('Room codes are four characters.', 'bad');
  const name = ($('#online-name').value || 'Player').trim().slice(0, 14);
  prefs.set('name', name);
  netStatus('Looking for that room…');
  try {
    const res = await ensureNet().join(code, name);
    app.online.seat = res.seat;
    show('lobby');
  } catch (err) {
    netStatus(err.message, 'bad');
  }
}

function toggleSound() {
  const on = !prefs.data.sound;
  prefs.set('sound', on);
  applyPrefs();
  if (on) sfx.play('ui');
}

function hint() {
  if (!localTurnAllowed() || app.mode === 'online') return;
  const pit = suggestMove(app.state);
  if (pit == null) return;
  app.board.flashHint(pit);
}

function onKey(e) {
  const open = $$('.overlay').find((d) => !d.hidden);
  if (e.key === 'Escape') {
    if (open) return closeDialog(open);
    if (app.screen === 'game') return toMenu();
    return;
  }
  if (open || app.screen !== 'game') return;

  if (e.key >= '1' && e.key <= '6') {
    if (!localTurnAllowed()) return;
    const seat = app.mode === 'local' ? app.state.turn : app.humanSeat;
    if (app.state.turn !== seat) return;
    const pit = pitsInScreenOrder(seat)[Number(e.key) - 1];
    if (app.state.pits[pit] > 0) commit(pit);
    return;
  }
  if (e.key.toLowerCase() === 'h') hint();
  if (e.key.toLowerCase() === 'm') toggleSound();
  if (e.key === 'Enter' && app.state?.over) replay();
}

/* --------------------------------------------------------------------- boot */

function boot() {
  applyPrefs();
  buildLevels();

  app.board = new Board($('#board'), {
    interactive: true,
    sound: prefs.data.sound,
    speed: SPEEDS[prefs.data.speed] ?? 1,
  });
  app.board.onPlay = (pit) => commit(pit);

  wire();
  applyPrefs();

  const room = new URLSearchParams(location.search).get('room');
  if (room && /^[A-Za-z0-9]{4}$/.test(room)) {
    show('setup-online');
    $('#join-code').value = room.toUpperCase();
    netStatus('Room code filled in from your link. Add a name and join.');
  } else {
    show('home');
  }

  window.__gebetaBooted = true;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
