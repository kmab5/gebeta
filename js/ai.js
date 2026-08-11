/**
 * Gebeta — computer opponent.
 *
 * Every difficulty runs the same search, tuned differently:
 *   easy       random legal move
 *   medium     depth 2, blunt evaluation, occasionally distracted
 *   hard       alpha-beta to depth 6
 *   merciless  iterative deepening until the clock runs out
 *
 * A "move" here is a whole turn including its relay chain, so the branching
 * factor never exceeds six and the tree stays cheap.
 */

import {
  PITS,
  ROW,
  CAPTURE_AT,
  cloneState,
  legalMoves,
  applyMoveFast,
  rowTotal,
} from './engine.js';

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    name: 'Easy',
    blurb: 'Plays whatever comes to hand.',
    depth: 0,
    budget: 0,
    noise: 0,
    think: [350, 650],
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    blurb: 'Takes the capture it can see.',
    depth: 2,
    budget: 60,
    noise: 26,
    think: [420, 800],
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    blurb: 'Reads a few turns ahead.',
    depth: 8,
    budget: 500,
    noise: 6,
    think: [300, 500],
  },
  merciless: {
    id: 'merciless',
    name: 'Merciless',
    blurb: 'Searches until the clock runs out.',
    depth: 16,
    budget: 900,
    noise: 0,
    think: [200, 350],
  },
};

const WIN = 100000;

/**
 * Board evaluation from `seat`'s point of view.
 *
 * Captured stones are the only thing that ends up on the scoreboard, so they
 * dominate. Stones sitting on your own row are worth something too: they are
 * yours to sow, and they are yours to sweep if the opponent runs dry.
 */
function evaluate(s, seat) {
  const opp = 1 - seat;
  if (s.over) {
    const diff = s.scores[seat] - s.scores[opp];
    return diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
  }

  let v = (s.scores[seat] - s.scores[opp]) * 100;
  v += (rowTotal(s, seat) - rowTotal(s, opp)) * 5;

  // A pit that is open and holding three stones is one stone from being taken.
  // Good if it is my turn to reach it, bad if it is theirs.
  let loadedMine = 0;
  let loadedTheirs = 0;
  let emptyMine = 0;
  for (let i = 0; i < PITS; i++) {
    const mine = (i < ROW ? 0 : 1) === seat;
    if (s.opened[i] && s.pits[i] === CAPTURE_AT - 1) {
      if (mine) loadedMine++;
      else loadedTheirs++;
    }
    if (mine && s.pits[i] === 0) emptyMine++;
  }
  const tempo = s.turn === seat ? 1 : -1;
  v += tempo * (loadedTheirs * 9 - loadedMine * 5);
  v -= emptyMine * 2; // a thin row is a row with few options

  return v;
}

function search(s, depth, alpha, beta, seat, ctx) {
  ctx.nodes++;
  if (ctx.deadline && (ctx.nodes & 511) === 0 && Date.now() > ctx.deadline) {
    ctx.aborted = true;
    return evaluate(s, seat);
  }
  if (s.over || depth <= 0) return evaluate(s, seat);

  const moves = legalMoves(s);
  if (!moves.length) return evaluate(s, seat);

  const maximizing = s.turn === seat;
  let best = maximizing ? -Infinity : Infinity;

  for (const m of moves) {
    const next = cloneState(s);
    applyMoveFast(next, m);
    const v = search(next, depth - 1, alpha, beta, seat, ctx);
    if (maximizing) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break; // this branch is already refuted
    if (ctx.aborted) break;
  }
  return best;
}

function scoreMoves(s, depth, ctx) {
  const seat = s.turn;
  const moves = legalMoves(s);
  const scored = [];
  for (const m of moves) {
    const next = cloneState(s);
    applyMoveFast(next, m);
    const v = search(next, depth - 1, -Infinity, Infinity, seat, ctx);
    scored.push({ move: m, value: v });
    if (ctx.aborted) break;
  }
  return scored;
}

/**
 * Pick a move. Synchronous and bounded — the caller decides how long to look
 * like it is thinking.
 */
export function chooseMove(state, difficulty = 'medium', rng = Math.random) {
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  if (cfg.id === 'easy') return moves[Math.floor(rng() * moves.length)];

  const ctx = {
    nodes: 0,
    aborted: false,
    deadline: cfg.budget ? Date.now() + cfg.budget : 0,
  };

  let best = [];
  if (cfg.id === 'merciless') {
    // Iterative deepening: keep the deepest result that finished cleanly, so a
    // timeout never leaves us with a half-searched ply.
    let last = scoreMoves(state, 2, ctx);
    for (let d = 3; d <= cfg.depth; d++) {
      const round = scoreMoves(state, d, ctx);
      if (ctx.aborted) break;
      last = round;
      if (Math.abs(Math.max(...round.map((r) => r.value))) > WIN / 2) break;
    }
    best = last;
  } else {
    best = scoreMoves(state, cfg.depth, ctx);
  }

  if (cfg.noise) for (const r of best) r.value += (rng() - 0.5) * cfg.noise;

  const top = Math.max(...best.map((r) => r.value));
  const ties = best.filter((r) => r.value >= top - 0.001);
  return ties[Math.floor(rng() * ties.length)].move;
}

/** Same search at a fixed strength, used by the hint button. */
export function suggestMove(state) {
  return chooseMove(state, 'hard');
}
