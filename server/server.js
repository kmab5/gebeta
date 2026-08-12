/**
 * Gebeta — room server.
 *
 * The server holds the real game state and imports the same rules engine the
 * browser runs, so a tampered client can't invent a move: it sends a pit
 * index, the server decides what that means, and both screens are told the
 * same story.
 *
 * Also serves the static site, so one deploy covers the whole thing.
 */

import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';

import { createState, applyMove, isLegal } from '../js/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 10000;

/** Unambiguous alphabet: no O/0, no I/1. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_TTL = 1000 * 60 * 60 * 2; // rooms live two hours
const GRACE = 1000 * 90; // how long a seat is held for a dropped player

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 25000,
});

/**
 * Serve index.html with the server marker filled in.
 *
 * A page served by this process is, by definition, a page with a room server
 * behind it — so it says so, and the client never has to go looking. Served
 * from anywhere else the marker stays empty and the client plays peer to peer.
 */
const INDEX = path.join(ROOT, 'index.html');
let indexCache = null;

function indexHtml() {
  if (indexCache) return indexCache;
  indexCache = fs
    .readFileSync(INDEX, 'utf8')
    .replace(
      /<meta name="gebeta-server" content="[^"]*">/,
      '<meta name="gebeta-server" content="self">'
    );
  return indexCache;
}

app.get(['/', '/index.html'], (_req, res) => {
  res.type('html').send(indexHtml());
});

app.use(express.static(ROOT, { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

/** @type {Map<string, Room>} */
const rooms = new Map();

function newCode() {
  let code;
  do {
    code = Array.from(
      { length: 4 },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return (String(name || '').trim().slice(0, 14) || 'Player').replace(/[\u0000-\u001f]/g, '');
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      connected: p.connected,
    })),
  };
}

function names(room) {
  const out = ['Bottom row', 'Top row'];
  for (const p of room.players) out[p.seat] = p.name;
  return out;
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', publicRoom(room));
}

function startGame(room, startingSeat = 0) {
  room.state = createState(startingSeat);
  room.status = 'playing';
  room.rematch = [false, false];
  for (const p of room.players) {
    io.to(p.id).emit('game:start', {
      seat: p.seat,
      state: room.state,
      names: names(room),
    });
  }
  broadcastRoom(room);
}

function findRoomBySocket(id) {
  for (const room of rooms.values()) {
    const p = room.players.find((x) => x.id === id);
    if (p) return { room, player: p };
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, ack) => {
    const name = cleanName(payload?.name);
    const code = newCode();
    const room = {
      code,
      status: 'waiting',
      state: null,
      rematch: [false, false],
      createdAt: Date.now(),
      players: [
        {
          id: socket.id,
          seat: 0,
          name,
          token: randomUUID(),
          connected: true,
          droppedAt: 0,
        },
      ],
    };
    rooms.set(code, room);
    socket.join(code);
    ack?.({ ok: true, code, seat: 0, token: room.players[0].token, names: names(room) });
    broadcastRoom(room);
  });

  socket.on('room:join', (payload, ack) => {
    const code = String(payload?.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack?.({ ok: false, error: 'No room with that code.' });

    const seatsTaken = room.players.filter((p) => p.connected || Date.now() - p.droppedAt < GRACE);
    if (seatsTaken.length >= 2) return ack?.({ ok: false, error: 'That room is full.' });

    // Reclaim a seat whose player gave up waiting.
    room.players = room.players.filter((p) => p.connected || Date.now() - p.droppedAt < GRACE);
    const seat = room.players.some((p) => p.seat === 0) ? 1 : 0;
    const player = {
      id: socket.id,
      seat,
      name: cleanName(payload?.name),
      token: randomUUID(),
      connected: true,
      droppedAt: 0,
    };
    room.players.push(player);
    socket.join(code);
    ack?.({ ok: true, code, seat, token: player.token, names: names(room) });
    broadcastRoom(room);

    if (room.players.length === 2 && room.status === 'waiting') {
      setTimeout(() => startGame(room, Math.random() < 0.5 ? 0 : 1), 700);
    }
  });

  socket.on('room:resume', (payload, ack) => {
    const room = rooms.get(String(payload?.code || '').toUpperCase());
    const player = room?.players.find((p) => p.token === payload?.token);
    if (!room || !player) return ack?.({ ok: false, error: 'That room is gone.' });
    player.id = socket.id;
    player.connected = true;
    player.droppedAt = 0;
    socket.join(room.code);
    ack?.({ ok: true, seat: player.seat, state: room.state, names: names(room) });
    broadcastRoom(room);
    io.to(room.code).emit('room:message', { kind: 'good', text: `${player.name} is back.` });
  });

  socket.on('game:move', ({ code, pit } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || !room.state || room.status !== 'playing') return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    if (room.state.turn !== player.seat) return;
    if (!isLegal(room.state, pit)) return;

    const res = applyMove(room.state, pit);
    if (!res.ok) return;
    room.state = res.state;
    io.to(room.code).emit('game:events', { events: res.events, state: res.state });
    if (res.state.over) {
      room.status = 'over';
      room.rematch = [false, false];
    }
  });

  socket.on('game:rematch', ({ code } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    room.rematch[player.seat] = true;
    const other = room.players.find((p) => p.seat !== player.seat);
    if (other) {
      io.to(other.id).emit('room:message', { kind: '', text: `${player.name} wants another game.` });
    }
    if (room.rematch[0] && room.rematch[1] && room.players.length === 2) {
      // Loser of the last game starts the next one.
      const last = room.state?.winner;
      const startingSeat = last === 0 ? 1 : last === 1 ? 0 : Math.random() < 0.5 ? 0 : 1;
      startGame(room, startingSeat);
    }
  });

  socket.on('room:emote', ({ code, id } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room?.players.find((p) => p.id === socket.id);
    if (!room || !player) return;
    socket.to(room.code).emit('room:emote', { seat: player.seat, id: Number(id) || 0 });
  });

  socket.on('room:leave', ({ code } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    room.players = room.players.filter((p) => p !== player);
    socket.leave(room.code);
    room.status = room.players.length ? 'waiting' : room.status;
    room.state = null;
    io.to(room.code).emit('room:message', { kind: 'bad', text: `${player.name} left the room.` });
    broadcastRoom(room);
    if (!room.players.length) rooms.delete(room.code);
  });

  socket.on('disconnect', () => {
    const hit = findRoomBySocket(socket.id);
    if (!hit) return;
    const { room, player } = hit;
    player.connected = false;
    player.droppedAt = Date.now();
    broadcastRoom(room);
    io.to(room.code).emit('room:message', {
      kind: 'bad',
      text: `${player.name} dropped out. Holding their seat for a minute.`,
    });

    setTimeout(() => {
      if (player.connected) return;
      room.players = room.players.filter((p) => p !== player);
      if (!room.players.length) return rooms.delete(room.code);
      room.status = 'waiting';
      room.state = null;
      broadcastRoom(room);
      io.to(room.code).emit('room:message', { kind: 'bad', text: `${player.name} did not come back.` });
    }, GRACE);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idle = now - room.createdAt > ROOM_TTL;
    const empty = room.players.every((p) => !p.connected && now - p.droppedAt > GRACE);
    if (idle || empty) rooms.delete(code);
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`Gebeta is on http://localhost:${PORT}`);
});
