/**
 * Gebeta — rules engine.
 *
 * Pure, dependency-free, and shared verbatim by the browser client and the
 * Node server, so both sides agree on every legal move.
 *
 * Board indexing (a single counter-clockwise ring of 12 pits):
 *
 *        top row (seat 1), sown right -> left on screen
 *        11  10   9   8   7   6
 *   [P2] --------------------- [P1]
 *         0   1   2   3   4   5
 *        bottom row (seat 0), sown left -> right on screen
 *
 * Sowing always goes 0 -> 1 -> ... -> 11 -> 0, which is counter-clockwise on
 * the board and "to the right" from each player's own seat.
 */

export const PITS = 12;
export const ROW = 6;
export const START_STONES = 4;
export const CAPTURE_AT = 4;
export const TOTAL_STONES = PITS * START_STONES; // 48
/** Safety valve: a relay chain this long is a loop, not a plan. */
export const MAX_LAPS = 400;

export const SEAT = { SOUTH: 0, NORTH: 1 };

/** Which seat owns a pit. */
export function ownerOf(pit) {
  return pit < ROW ? 0 : 1;
}

/** The pits belonging to a seat, in sowing order. */
export function pitsOf(seat) {
  const base = seat * ROW;
  return [base, base + 1, base + 2, base + 3, base + 4, base + 5];
}

/** Human-facing label: "A3" style is noise; pits are numbered 1-6 per seat. */
export function pitLabel(pit) {
  return `${ownerOf(pit) === 0 ? 'S' : 'N'}${(pit % ROW) + 1}`;
}

export function createState(startingSeat = 0) {
  return {
    pits: new Array(PITS).fill(START_STONES),
    opened: new Array(PITS).fill(false),
    scores: [0, 0],
    turn: startingSeat,
    over: false,
    winner: null, // 0 | 1 | 'draw'
    turnCount: 0,
    lastMove: null, // { seat, pit }
  };
}

export function cloneState(s) {
  return {
    pits: s.pits.slice(),
    opened: s.opened.slice(),
    scores: s.scores.slice(),
    turn: s.turn,
    over: s.over,
    winner: s.winner,
    turnCount: s.turnCount,
    lastMove: s.lastMove ? { ...s.lastMove } : null,
  };
}

export function rowTotal(s, seat) {
  const base = seat * ROW;
  let n = 0;
  for (let i = base; i < base + ROW; i++) n += s.pits[i];
  return n;
}

export function stonesOnBoard(s) {
  let n = 0;
  for (let i = 0; i < PITS; i++) n += s.pits[i];
  return n;
}

export function legalMoves(s) {
  if (s.over) return [];
  const out = [];
  const base = s.turn * ROW;
  for (let i = base; i < base + ROW; i++) if (s.pits[i] > 0) out.push(i);
  return out;
}

export function isLegal(s, pit) {
  return (
    !s.over &&
    Number.isInteger(pit) &&
    pit >= 0 &&
    pit < PITS &&
    ownerOf(pit) === s.turn &&
    s.pits[pit] > 0
  );
}

/**
 * Play one full turn, including every relay lap.
 *
 * Returns a new state plus an ordered event log. The log is the single source
 * of truth for animation and for the move history, so the client never has to
 * re-derive what happened.
 *
 * Events:
 *   { t:'pickup',   pit, count, seat, lap, opened }   picked a pit clean
 *   { t:'sow',      from, pit, count, seat }          dropped one stone
 *   { t:'capture',  pit, seat, amount, total }        pit hit 4 while opened
 *   { t:'relay',    pit, seat }                       landed home, going again
 *   { t:'endturn',  reason, seat, next }              turn handed over
 *   { t:'sweep',    seat, amount, pits, total }       last stones collected
 *   { t:'gameover', winner, scores }
 */
export function applyMove(state, pit) {
  if (!isLegal(state, pit)) {
    return { ok: false, error: 'illegal-move', state, events: [] };
  }

  const s = cloneState(state);
  const seat = s.turn;
  const events = [];
  let cursor = pit;
  let lap = 0;
  let endReason = 'handover';

  for (;;) {
    const wasOpened = s.opened[cursor];
    let hand = s.pits[cursor];
    s.pits[cursor] = 0;
    s.opened[cursor] = true;
    events.push({
      t: 'pickup',
      pit: cursor,
      count: hand,
      seat,
      lap,
      opened: !wasOpened,
    });

    let landed = cursor;
    let stonesBefore = 0;

    while (hand > 0) {
      landed = (landed + 1) % PITS;
      stonesBefore = s.pits[landed];
      s.pits[landed] = stonesBefore + 1;
      hand--;
      events.push({
        t: 'sow',
        from: cursor,
        pit: landed,
        count: s.pits[landed],
        seat,
      });

      // A capture can happen at any point in the lap, not just on the last
      // stone — but only in a pit that has already been opened.
      if (s.opened[landed] && s.pits[landed] === CAPTURE_AT) {
        s.pits[landed] = 0;
        s.scores[seat] += CAPTURE_AT;
        events.push({
          t: 'capture',
          pit: landed,
          seat,
          amount: CAPTURE_AT,
          total: s.scores[seat],
        });
      }
    }

    const landedHome = ownerOf(landed) === seat;
    const hadStones = stonesBefore > 0;
    const survived = s.pits[landed] > 0; // false if that last stone triggered a capture

    if (landedHome && hadStones && survived && lap < MAX_LAPS) {
      lap++;
      events.push({ t: 'relay', pit: landed, seat });
      cursor = landed;
      continue;
    }

    if (!landedHome) endReason = 'crossed';
    else if (!hadStones) endReason = 'empty-pit';
    else if (!survived) endReason = 'captured';
    else endReason = 'lap-limit';
    break;
  }

  s.turnCount++;
  s.lastMove = { seat, pit };

  // The game is over when the board runs dry, or when one row is empty and the
  // other still holds stones — whoever holds them sweeps them up.
  const south = rowTotal(s, 0);
  const north = rowTotal(s, 1);

  if (south === 0 || north === 0) {
    if (south > 0 || north > 0) {
      const keeper = south > 0 ? 0 : 1;
      const amount = south > 0 ? south : north;
      const swept = [];
      for (const p of pitsOf(keeper)) {
        if (s.pits[p] > 0) swept.push({ pit: p, count: s.pits[p] });
        s.pits[p] = 0;
      }
      s.scores[keeper] += amount;
      events.push({
        t: 'sweep',
        seat: keeper,
        amount,
        pits: swept,
        total: s.scores[keeper],
      });
    }
    s.over = true;
    s.winner =
      s.scores[0] === s.scores[1] ? 'draw' : s.scores[0] > s.scores[1] ? 0 : 1;
    events.push({ t: 'endturn', reason: endReason, seat, next: seat });
    events.push({ t: 'gameover', winner: s.winner, scores: s.scores.slice() });
  } else {
    s.turn = 1 - seat;
    events.push({ t: 'endturn', reason: endReason, seat, next: s.turn });
  }

  return { ok: true, state: s, events };
}

/**
 * Fast path for search: same rules, no event log, mutates a scratch state.
 * Returns the seat to move next (or -1 when the game ended).
 */
export function applyMoveFast(s, pit) {
  const seat = s.turn;
  let cursor = pit;
  let lap = 0;

  for (;;) {
    let hand = s.pits[cursor];
    s.pits[cursor] = 0;
    s.opened[cursor] = true;

    let landed = cursor;
    let before = 0;
    while (hand > 0) {
      landed = (landed + 1) % PITS;
      before = s.pits[landed];
      s.pits[landed] = before + 1;
      hand--;
      if (s.opened[landed] && s.pits[landed] === CAPTURE_AT) {
        s.pits[landed] = 0;
        s.scores[seat] += CAPTURE_AT;
      }
    }

    if (
      ownerOf(landed) === seat &&
      before > 0 &&
      s.pits[landed] > 0 &&
      lap < MAX_LAPS
    ) {
      lap++;
      cursor = landed;
      continue;
    }
    break;
  }

  s.turnCount++;
  const south = rowTotal(s, 0);
  const north = rowTotal(s, 1);

  if (south === 0 || north === 0) {
    if (south > 0 || north > 0) {
      const keeper = south > 0 ? 0 : 1;
      s.scores[keeper] += south > 0 ? south : north;
      for (const p of pitsOf(keeper)) s.pits[p] = 0;
    }
    s.over = true;
    s.winner =
      s.scores[0] === s.scores[1] ? 'draw' : s.scores[0] > s.scores[1] ? 0 : 1;
    return -1;
  }

  s.turn = 1 - seat;
  return s.turn;
}

/** Result summary used by the end-of-game screen. */
export function summarize(s) {
  return {
    scores: s.scores.slice(),
    winner: s.winner,
    margin: Math.abs(s.scores[0] - s.scores[1]),
    turns: s.turnCount,
  };
}
