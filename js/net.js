/**
 * Gebeta — online play.
 *
 * Two ways to reach another player, picked automatically:
 *
 *   direct   WebRTC between the two browsers. No backend at all, so this
 *            works on a purely static host (Vercel, Pages, a file server).
 *            The player who opened the room holds the authoritative state.
 *
 *   server   The bundled Node room server, when one is actually there. The
 *            server holds the state instead.
 *
 * No address is hardcoded. A server is discovered, in order: `window.
 * GEBETA_SERVER`, a `?server=` parameter, whatever the player saved in the
 * connection field, a `<meta name="gebeta-server">` tag, and finally the page's
 * own origin — used only if it answers /health, so a static host falls through
 * to direct play on its own.
 *
 * Both transports raise the same events, so nothing else in the app can tell
 * them apart: room, start, events, message, emote, slow, down.
 */

import { createState, applyMove, isLegal } from './engine.js';

const STORE_KEY = 'gebeta:server';
const ID_PREFIX = 'gebeta-room-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* ----------------------------------------------------------------- helpers */

function normalise(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  return (/^https?:\/\//.test(u) ? u : 'https://' + u).replace(/\/+$/, '');
}

export function savedServer() {
  try {
    return localStorage.getItem(STORE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveServer(url) {
  try {
    const v = normalise(url);
    if (v) localStorage.setItem(STORE_KEY, v);
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage off — the field just won't persist */
  }
}

/** An explicitly chosen server, or '' meaning "work it out". */
export function configuredServer() {
  if (typeof window.GEBETA_SERVER === 'string' && window.GEBETA_SERVER) {
    return normalise(window.GEBETA_SERVER);
  }
  const q = new URLSearchParams(location.search).get('server');
  if (q) {
    saveServer(q);
    return normalise(q);
  }
  const stored = savedServer();
  if (stored) return stored;
  const meta = document.querySelector('meta[name="gebeta-server"]')?.content;
  return normalise(meta);
}

/** Is there a Gebeta server at this origin? Cheap, and answers fast. */
async function hasServer(origin) {
  if (!origin || location.protocol === 'file:') return false;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(origin + '/health', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

function randomCode() {
  return Array.from(
    { length: 4 },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join('');
}

function cleanName(n) {
  return (String(n || '').trim().slice(0, 14) || 'Player').replace(/[\u0000-\u001f]/g, '');
}

/* ------------------------------------------------------------- public face */

export class Online {
  constructor() {
    this.handlers = {};
    this.link = null;
    this.transport = null;
    this.serverUrl = '';
    this.code = null;
    this.seat = null;
  }

  on(name, fn) {
    (this.handlers[name] ||= []).push(fn);
    return this;
  }

  emit(name, payload) {
    for (const fn of this.handlers[name] || []) fn(payload);
  }

  /** Decide how we're connecting. Cached once answered. */
  async resolve() {
    if (this.transport) return this.transport;
    const explicit = configuredServer();

    if (explicit && window.io) {
      this.serverUrl = explicit;
      this.transport = 'server';
    } else if (!explicit && window.io && (await hasServer(location.origin))) {
      this.serverUrl = location.origin;
      this.transport = 'server';
    } else if (window.Peer) {
      this.transport = 'direct';
    } else if (explicit && !window.io) {
      throw new Error('A server is set, but the realtime library did not load.');
    } else {
      throw new Error('Neither connection method loaded. Check your network and reload.');
    }
    return this.transport;
  }

  /** A sentence for the setup screen, so nobody has to guess. */
  async describe() {
    const t = await this.resolve();
    return t === 'server'
      ? `Through your server at ${this.serverUrl.replace(/^https?:\/\//, '')}.`
      : 'Browser to browser — no server involved.';
  }

  async _make() {
    const t = await this.resolve();
    if (this.link) return this.link;
    this.link = t === 'server' ? new ServerLink(this, this.serverUrl) : new DirectLink(this);
    return this.link;
  }

  async create(name) {
    const link = await this._make();
    const res = await link.create(cleanName(name));
    this.code = res.code;
    this.seat = res.seat;
    return res;
  }

  async join(code, name) {
    const link = await this._make();
    const res = await link.join(String(code).toUpperCase().trim(), cleanName(name));
    this.code = res.code;
    this.seat = res.seat;
    return res;
  }

  move(pit) {
    this.link?.move(pit);
  }

  rematch() {
    this.link?.rematch();
  }

  sendEmote(id) {
    this.link?.sendEmote(id);
  }

  leave() {
    this.link?.leave();
    this.code = null;
    this.seat = null;
  }

  dispose() {
    this.link?.dispose();
    this.link = null;
    this.transport = null;
    this.handlers = {};
  }
}

/* ============================================================ socket server */

class ServerLink {
  constructor(bus, url) {
    this.bus = bus;
    this.url = url;
    this.socket = null;
    this.code = null;
    this.token = null;
  }

  connect() {
    if (this.socket?.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket = window.io(this.url, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 6,
        timeout: 45000,
      });
      const slow = setTimeout(
        () => this.bus.emit('slow', 'Waking the server — free hosting takes a moment.'),
        3500
      );
      this.socket.on('connect', () => {
        clearTimeout(slow);
        this._wire();
        resolve();
      });
      this.socket.on('connect_error', (err) => {
        clearTimeout(slow);
        reject(new Error(err?.message || 'Could not reach the server.'));
      });
    });
  }

  _wire() {
    const s = this.socket;
    if (s.__wired) return;
    s.__wired = true;
    s.on('room:update', (p) => this.bus.emit('room', p));
    s.on('game:start', (p) => this.bus.emit('start', p));
    s.on('game:events', (p) => this.bus.emit('events', p));
    s.on('room:message', (p) => this.bus.emit('message', p));
    s.on('room:emote', (p) => this.bus.emit('emote', p));
    s.on('disconnect', () => this.bus.emit('down', 'Connection lost. Trying to get back in.'));
    s.io.on('reconnect', () => {
      if (!this.code || !this.token) return;
      s.emit('room:resume', { code: this.code, token: this.token }, (res) => {
        if (res?.ok) this.bus.emit('resumed', res);
        else this.bus.emit('message', { kind: 'bad', text: 'That room is gone.' });
      });
    });
  }

  _ask(name, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The server did not answer.')), 12000);
      this.socket.emit(name, payload, (res) => {
        clearTimeout(timer);
        if (res?.ok) resolve(res);
        else reject(new Error(res?.error || 'Something went wrong.'));
      });
    });
  }

  async create(name) {
    await this.connect();
    const res = await this._ask('room:create', { name });
    this.code = res.code;
    this.token = res.token;
    return res;
  }

  async join(code, name) {
    await this.connect();
    const res = await this._ask('room:join', { code, name });
    this.code = res.code;
    this.token = res.token;
    return res;
  }

  move(pit) {
    this.socket?.emit('game:move', { code: this.code, pit });
  }

  rematch() {
    this.socket?.emit('game:rematch', { code: this.code });
  }

  sendEmote(id) {
    this.socket?.emit('room:emote', { code: this.code, id });
  }

  leave() {
    if (this.socket && this.code) this.socket.emit('room:leave', { code: this.code });
    this.code = null;
  }

  dispose() {
    this.leave();
    this.socket?.disconnect();
    this.socket = null;
  }
}

/* ====================================================== browser to browser */

/**
 * WebRTC. Whoever opened the room runs the rules for both sides — the same job
 * the server does — so the guest sends an intent and waits to be told what
 * happened, exactly as it would with a server.
 */
class DirectLink {
  constructor(bus) {
    this.bus = bus;
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.seat = null;
    this.code = null;
    this.names = ['Player', 'Player'];
    this.state = null;
    this.rematchFlags = [false, false];
  }

  _newPeer(id) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const peer = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        fn(arg);
      };
      peer.on('open', () => finish(resolve, peer));
      peer.on('error', (err) => {
        if (settled) return;
        try {
          peer.destroy();
        } catch {
          /* already gone */
        }
        finish(reject, err);
      });
      setTimeout(
        () => finish(reject, new Error('Timed out reaching the signalling service.')),
        15000
      );
    });
  }

  async create(name) {
    this.isHost = true;
    this.seat = 0;
    this.names = [name, ''];

    // Claim a room code. A clash means somebody is already holding it.
    let lastErr = null;
    for (let attempt = 0; attempt < 6 && !this.code; attempt++) {
      const code = randomCode();
      try {
        this.peer = await this._newPeer(ID_PREFIX + code);
        this.code = code;
      } catch (err) {
        lastErr = err;
        if (err?.type !== 'unavailable-id') break;
      }
    }
    if (!this.code) {
      throw new Error(
        lastErr?.type === 'unavailable-id'
          ? 'Could not find a free room code. Try again.'
          : 'Could not open a room. Check your connection and try again.'
      );
    }

    this.peer.on('connection', (conn) => this._hostGreets(conn));
    this.peer.on('error', (err) => this._peerError(err));
    this._announce('waiting');
    return { code: this.code, seat: 0, names: this.names };
  }

  async join(code, name) {
    this.isHost = false;
    this.seat = 1;
    this.code = code;
    this.names = ['', name];
    this.peer = await this._newPeer(null).catch(() => {
      throw new Error('Could not reach the signalling service.');
    });

    const conn = this.peer.connect(ID_PREFIX + code, { reliable: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('No room with that code, or the host has closed it.')),
        14000
      );
      conn.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.peer.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new Error(
            err?.type === 'peer-unavailable'
              ? 'No room with that code.'
              : 'Could not connect to that room.'
          )
        );
      });
    });

    this.conn = conn;
    conn.on('data', (msg) => this._guestReceives(msg));
    conn.on('close', () => {
      this.bus.emit('message', { kind: 'bad', text: 'The host closed the room.' });
      this._announce('waiting', true);
    });
    conn.send({ t: 'hello', name });
    return { code, seat: 1, names: this.names };
  }

  _peerError(err) {
    if (err?.type === 'peer-unavailable') return; // handled where it matters
    this.bus.emit('message', {
      kind: 'bad',
      text: 'Direct connection trouble. Some networks block it — a server is the fallback.',
    });
  }

  _send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  _announce(status, empty = false) {
    const players = [];
    const paired = this.conn?.open && !empty;
    if (this.isHost) {
      players.push({ seat: 0, name: this.names[0], connected: true });
      if (paired) players.push({ seat: 1, name: this.names[1], connected: true });
    } else {
      if (paired) players.push({ seat: 0, name: this.names[0], connected: true });
      players.push({ seat: 1, name: this.names[1], connected: true });
    }
    this.bus.emit('room', { code: this.code, status, players });
  }

  /* ---- host side ---- */

  _hostGreets(conn) {
    if (this.conn?.open) {
      // Room is full: turn the newcomer away rather than ignoring them.
      conn.on('open', () => {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 250);
      });
      return;
    }
    this.conn = conn;
    conn.on('data', (msg) => this._hostReceives(msg));
    conn.on('close', () => {
      this.conn = null;
      this.state = null;
      this.bus.emit('message', { kind: 'bad', text: `${this.names[1] || 'They'} left the room.` });
      this._announce('waiting', true);
    });
  }

  _hostReceives(msg) {
    switch (msg?.t) {
      case 'hello':
        this.names[1] = cleanName(msg.name);
        this._announce('waiting');
        this._send({ t: 'room', names: this.names });
        setTimeout(() => this._startGame(Math.random() < 0.5 ? 0 : 1), 700);
        break;
      case 'intent':
        this._hostApplies(msg.pit, 1);
        break;
      case 'rematch':
        this.rematchFlags[1] = true;
        this.bus.emit('message', { kind: '', text: `${this.names[1]} wants another game.` });
        this._maybeRestart();
        break;
      case 'emote':
        this.bus.emit('emote', { seat: 1, id: Number(msg.id) || 0 });
        break;
      default:
        break;
    }
  }

  _startGame(startingSeat) {
    this.state = createState(startingSeat);
    this.rematchFlags = [false, false];
    this._announce('playing');
    this._send({ t: 'start', seat: 1, state: this.state, names: this.names });
    this.bus.emit('start', { seat: 0, state: this.state, names: this.names });
  }

  _hostApplies(pit, seat) {
    if (!this.state || this.state.over) return;
    if (this.state.turn !== seat) return;
    if (!isLegal(this.state, pit)) return;
    const res = applyMove(this.state, pit);
    if (!res.ok) return;
    this.state = res.state;
    this._send({ t: 'events', events: res.events, state: res.state });
    this.bus.emit('events', { events: res.events, state: res.state });
  }

  _maybeRestart() {
    if (!this.rematchFlags[0] || !this.rematchFlags[1] || !this.conn?.open) return;
    const last = this.state?.winner;
    const startingSeat = last === 0 ? 1 : last === 1 ? 0 : Math.random() < 0.5 ? 0 : 1;
    this._startGame(startingSeat);
  }

  /* ---- guest side ---- */

  _guestReceives(msg) {
    switch (msg?.t) {
      case 'room':
        this.names = msg.names;
        this._announce('waiting');
        break;
      case 'start':
        this.names = msg.names;
        this.state = msg.state;
        this._announce('playing');
        this.bus.emit('start', { seat: 1, state: msg.state, names: msg.names });
        break;
      case 'events':
        this.state = msg.state;
        this.bus.emit('events', { events: msg.events, state: msg.state });
        break;
      case 'wants-rematch':
        this.bus.emit('message', { kind: '', text: `${this.names[0]} wants another game.` });
        break;
      case 'emote':
        this.bus.emit('emote', { seat: 0, id: Number(msg.id) || 0 });
        break;
      case 'full':
        this.bus.emit('message', { kind: 'bad', text: 'That room is full.' });
        break;
      default:
        break;
    }
  }

  /* ---- shared ---- */

  move(pit) {
    if (this.isHost) this._hostApplies(pit, 0);
    else this._send({ t: 'intent', pit });
  }

  rematch() {
    if (this.isHost) {
      this.rematchFlags[0] = true;
      this._send({ t: 'wants-rematch' });
      this._maybeRestart();
    } else {
      this._send({ t: 'rematch' });
    }
  }

  sendEmote(id) {
    this._send({ t: 'emote', id });
  }

  leave() {
    try {
      this.conn?.close();
    } catch {
      /* already closed */
    }
    this.conn = null;
  }

  dispose() {
    this.leave();
    try {
      this.peer?.destroy();
    } catch {
      /* already gone */
    }
    this.peer = null;
  }
}
