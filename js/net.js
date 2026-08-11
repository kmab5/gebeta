/**
 * Gebeta — online play.
 *
 * The server owns the game state. This client sends a pit index and waits to
 * be told what happened; it never applies its own move optimistically, so the
 * two screens can't drift apart.
 *
 * Point it somewhere else by setting `window.GEBETA_SERVER` before this module
 * loads, or by editing REMOTE below.
 */

const REMOTE = 'https://gebeta-z1yt.onrender.com';

export function serverUrl() {
  if (typeof window.GEBETA_SERVER === 'string') return window.GEBETA_SERVER;
  const host = location.hostname;
  if (location.protocol === 'file:') return REMOTE;
  // Static hosts (GitHub Pages and friends) can't run the room server.
  if (/github\.io$|netlify\.app$|vercel\.app$|pages\.dev$/.test(host)) return REMOTE;
  return location.origin;
}

export class Net {
  constructor() {
    this.socket = null;
    this.code = null;
    this.seat = null;
    this.token = null;
    this.handlers = {};
  }

  on(name, fn) {
    (this.handlers[name] ||= []).push(fn);
    return this;
  }

  emit(name, payload) {
    for (const fn of this.handlers[name] || []) fn(payload);
  }

  get available() {
    return typeof window.io === 'function';
  }

  connect() {
    if (this.socket?.connected) return Promise.resolve();
    if (!this.available) {
      return Promise.reject(new Error('The realtime library did not load.'));
    }
    return new Promise((resolve, reject) => {
      this.socket = window.io(serverUrl(), {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 6,
        timeout: 45000,
      });

      const slow = setTimeout(
        () => this.emit('slow', 'Waking the server — free hosting takes a moment.'),
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
    s.on('room:update', (p) => this.emit('room', p));
    s.on('game:start', (p) => this.emit('start', p));
    s.on('game:events', (p) => this.emit('events', p));
    s.on('game:sync', (p) => this.emit('sync', p));
    s.on('room:message', (p) => this.emit('message', p));
    s.on('room:emote', (p) => this.emit('emote', p));
    s.on('disconnect', () => this.emit('down', 'Connection lost. Trying to get back in.'));
    s.io.on('reconnect', () => {
      if (this.code && this.token) {
        s.emit('room:resume', { code: this.code, token: this.token }, (res) => {
          if (res?.ok) this.emit('resumed', res);
          else this.emit('message', { kind: 'bad', text: 'That room is gone.' });
        });
      }
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
    this.seat = res.seat;
    this.token = res.token;
    return res;
  }

  async join(code, name) {
    await this.connect();
    const res = await this._ask('room:join', { code: String(code).toUpperCase().trim(), name });
    this.code = res.code;
    this.seat = res.seat;
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
    this.seat = null;
    this.token = null;
  }

  dispose() {
    this.leave();
    this.socket?.disconnect();
    this.socket = null;
    this.handlers = {};
  }
}
