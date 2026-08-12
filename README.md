# Gebeta — ገበጣ

A browser rendition of the Ethiopian count-and-capture game. Two rows of six
pits, forty-eight stones, and one question: can you take more than they do.

Play a friend on one screen, open a room and play someone anywhere, or take on
a computer that reads eight turns ahead.

Online play needs no backend and no database. Two browsers talk to each other
directly, so the whole thing deploys as static files.

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

It is a static site. Any static server works:

```bash
npx serve            # then open the address it prints
```

Opening `index.html` straight off the filesystem will not work — browsers block
JavaScript modules on `file://`.

The Node server in `server/` is optional. It serves the same files and can also
host online matches, if you would rather games run through a server than
between browsers:

```bash
cd server && npm install && npm start     # http://localhost:10000
```

## Deploying

**Static host (Vercel, Pages, Netlify, anything).** Push the repo and point the
host at the root. No build step, no framework, no environment variables. Online
play works because it does not need the host to do anything. `.vercelignore`
keeps the optional server out of the upload.

**Node host (Render, Fly, Railway).** Run `server/` and it serves the site and
the rooms together.

Either way, nothing needs editing. There is no deployment URL written anywhere
in this repo — the game works out where it is at runtime.

## How it fits together

```
index.html          screens, dialogs, icon sprite
css/tokens.css      palette, type, motion — everything themeable
css/app.css         layout, board, animation
js/engine.js        the rules. pure, no DOM, no dependencies
js/ai.js            alpha-beta search, four difficulties
js/board.js         rendering and animation
js/net.js           online play — direct WebRTC or socket server
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

There are two transports and the game picks one for you. The Connection panel
on the online screen always says which is in use.

**Direct (the default).** WebRTC straight between the two browsers. No backend,
no database, nothing to pay for. The player who opened the room runs the rules
for both sides.

**Server.** If a room server is reachable, games run through it instead and it
runs the rules.

Whichever is in use, the side holding the rules is authoritative. The other
side sends a pit index and waits to be told what happened — it never applies a
move optimistically, so two screens cannot drift apart. Illegal moves are
rejected at the source: moving out of turn, playing the other row, or a pit
index that isn't one.

Rematches need both players to agree, and the loser of the last game starts the
next one. On the server transport a dropped seat is held for ninety seconds and
the client reconnects with a token.

### Choosing a server

You almost certainly don't need one — leave the Connection panel empty and
games run browser to browser.

A configured address is **ignored unless it answers** `GET /health` with
`{"ok":true}`. That check is deliberate: an address that doesn't respond gets
skipped and play falls back to direct, rather than the socket layer retrying
into the void and leaving online play broken. Whatever you type is also reduced
to its bare origin, so pasting a full page or invite URL cannot leak a query
string into the connection.

A server is looked for in this order:

1. `window.GEBETA_SERVER`, if something set it before the modules load
2. `?server=https://...` in the URL, which is then remembered
3. whatever you typed into the Connection panel (kept in local storage)
4. `<meta name="gebeta-server">` in `index.html`, empty by default
5. the page's own origin

A static host answers none of those, so it falls through to direct play on its
own. Nothing to configure. Vercel logging a 404 for `/health` is that check
working — it is how the game learns there is no server there.

### The catch with direct play

WebRTC needs the two browsers to find a route to each other. Signalling uses
the public PeerJS broker; the media path uses public STUN. That covers most
home and mobile networks. Strict corporate or symmetric-NAT networks can block
it, and getting through those needs a TURN relay, which is the one part that
costs money. If direct play fails for someone, run the Node server and put its
address in the Connection panel.

Both transports are tested: room lifecycle, full games with both sides ending
in exact agreement, out-of-turn and wrong-row moves rejected, rematch
handshake, emote relay, and leave handling. The server transport additionally
covers disconnect grace and token resume.

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
