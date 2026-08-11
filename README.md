# Gebeta — ገበጣ

A browser rendition of the Ethiopian count-and-capture game. Two rows of six
pits, forty-eight stones, and one question: can you take more than they do.

Play a friend on one screen, open a room and play someone anywhere, or take on
a computer that reads eight turns ahead.

**[Play it](https://gebeta-z1yt.onrender.com/)**

---

## The rules, as implemented

There are dozens of local variants of Gebeta across Ethiopia and Eritrea —
board sizes, capture counts and relay rules all shift from place to place.
This is one common set, and the engine enforces it exactly.

1. **Sowing.** Lift every stone from one of your own pits and drop them one at
   a time into the pits ahead, counter-clockwise. Your row runs into theirs and
   back around.
2. **Opening.** Every pit starts closed. A pit opens the moment you lift its
   stones — not when a stone lands in it. Only an open pit can be captured, so
   the first few turns are spent opening ground.
3. **Capturing.** Drop a stone into an open pit and bring it to exactly four,
   and all four are yours — on either side of the board. This is checked on
   every drop, not just the last one, so a single handful can pay several
   times over.
4. **Relaying.** If your last stone lands in your own row and that pit already
   held stones, scoop it up and keep going. The turn ends when you land in
   their row, land in one of your own empty pits, or your last stone completes
   a capture (there is nothing left to lift).
5. **Ending.** When either row runs empty, whoever still holds stones sweeps
   them all into their basket. Most stones wins. Forty-eight are in play, so
   twenty-five takes it and 24–24 is a real draw.

A closed pit can hold more than four stones. An open one never does — it gets
taken the moment it reaches four.

## Running it

The game is static files plus one small Node server. The server does two jobs:
it hosts the site and it runs online matches.

```bash
cd server
npm install
npm start          # http://localhost:10000
```

Opening `index.html` straight off the filesystem will not work — browsers
block JavaScript modules on `file://`. Any static server will do for local and
computer games (`npx serve` from the project root); online play needs the Node
server.

## How it fits together

```
index.html          screens, dialogs, icon sprite
css/tokens.css      palette, type, motion — everything themeable
css/app.css         layout, board, animation
js/engine.js        the rules. pure, no DOM, no dependencies
js/ai.js            alpha-beta search, four difficulties
js/board.js         rendering and animation
js/net.js           socket.io client
js/app.js           screens, modes, turn loop
js/util.js          seeded RNG, storage, toasts
server/server.js    room server — imports js/engine.js
```

The engine is deliberately isolated. It takes a state and a pit index and
returns a new state plus an ordered event log — `pickup`, `sow`, `capture`,
`relay`, `sweep`, `gameover`. The board animates that log; the move history
reads from it; the server broadcasts it. Nothing re-derives what happened by
inspecting the DOM.

`js/package.json` exists only to mark that folder as ES modules so Node can
import the engine without a warning. It is not an npm package.

## Online play

Rooms are four characters from an alphabet with no `O`/`0` or `I`/`1`. Create
one and send the invite link, or type the code in.

The server is authoritative. Clients send a pit index and wait — they never
apply a move optimistically, so two screens cannot drift apart. The server
imports the same `engine.js` the browser runs and rejects anything illegal:
moving out of turn, playing the other row, or a pit index that isn't one.

Drop your connection and your seat is held for ninety seconds; the client
reconnects with a token and picks up mid-game. Rematches need both players to
agree, and the loser of the last game starts the next one.

Verified end to end: room lifecycle, full games played through the server with
both clients in exact sync, out-of-turn and illegal moves rejected, rematch
handshake, emote relay, disconnect grace and token resume.

### Pointing the client at a server

`js/net.js` uses the page's own origin, except on static hosts (GitHub Pages
and similar), where it falls back to `REMOTE` at the top of the file. Change
that constant if the server moves, or set `window.GEBETA_SERVER` before the
modules load.

## The computer opponent

One alpha-beta search, tuned four ways. Because a move is a whole turn
including its relay chain, the branching factor never exceeds six, so it can
search deep cheaply.

| Level | Behaviour |
|---|---|
| Easy | Random legal move |
| Medium | Depth 2, blunt evaluation, occasionally distracted |
| Hard | Depth 8, roughly 60 ms per move |
| Merciless | Iterative deepening against a 900 ms clock |

The evaluation weights captured stones far above everything else, then stones
sitting on your own row (yours to sow, and yours to sweep if they run dry),
then whether an open pit is sitting on three stones and whose turn it is to
reach it.

Measured over full games: Medium beats Easy 40–0, Hard beats Medium 16–0,
Merciless beats Hard 5–0 with three draws. The hint button runs the Hard
search.

## Testing

The engine was fuzzed over 20,000 random playouts checking that stones are
conserved at 48, that every game terminates, and that an open pit never holds
more than four. Scenario tests cover capturing on the opponent's row,
mid-sow captures, closed pits refusing to pay, relay termination and the
end-of-game sweep.

## Playing with a keyboard

`1`–`6` play your pits left to right, `H` asks for a hint, `M` mutes,
`Esc` backs out. Tab and arrow keys move between pits.

## Credits

Built by [Sami](https://github.com/kmab5). Gebeta belongs to the people who
have been playing it for centuries; this is just a version of it that fits in
a browser tab.

Licensed GPL-3.0.
