// The demo's lichess.js: demo/serve.py serves this file in its place, so the
// page asks it for games instead of Lichess. It exports the same names
// (test/demo.test.js checks), and makes up each game from the "demo" field
// of that game in the scenario file, with random legal moves. Nothing is
// kept between visits, so every visit starts fresh. Fields, all optional:
//   result:     "1-0", "0-1", "½-½", "live" (default), "new" (no moves yet)
//               or "aborted"
//   status:     the Lichess end reason, e.g. "mate", "outoftime" (default
//               "resign" for a win, "draw" for a draw)
//   white, black: the players on Lichess, if not the scheduled ones
//   swapColours: true to play the scheduled game with colours reversed
//   rated:      whether the game is rated (default: the tournament's setting)
//   hoursAgo:   for a game in progress, when the last move was made
//   daysPerTurn: default 3
//   clock:      { minutes, increment } for a game on a clock instead of
//               days per move
//   missing:    true for a game Lichess doesn't know
//   plies:      how many half-moves to play
// With ?moves in the page's address, a game in progress gets one more move
// each time the page fetches it again, as when a player moves on Lichess.

import { gameCache, parseConfig } from "./lib.js";

const HOUR = 3600000, DAY = 24 * HOUR, now = Date.now();
const fetches = new Map(); // id -> times the page fetched the game

// Read on the first request, so that loading this module does nothing.
let setup = null;
const load = () => (setup ??= (async () => {
  const cfg = await (await fetch("tournament.json")).json();
  return {
    cfg, parsed: parseConfig(cfg),
    Chess: (await import("./vendor/chess.js")).Chess,
    growing: new URLSearchParams(location.search).has("moves"),
  };
})());

// A small seeded generator, so a scenario looks the same on every load.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 2 ** 32;
  };
}

// The round and scheduled game with this ID, and its "demo" field.
function find(cfg, parsed, id) {
  for (const [r, round] of parsed.rounds.entries()) {
    const i = round.slots.findIndex((x) => x.id === id);
    if (i >= 0) {
      const slot = cfg.rounds[r].games[i];
      return { r, slot, d: slot.demo || {} };
    }
  }
  return null;
}

// The game as Lichess would export it, or null when Lichess wouldn't know it.
export async function fetchGame(id) {
  const { cfg, parsed, Chess, growing } = await load();
  const found = find(cfg, parsed, id);
  if (!found || found.d.missing) return null;
  const { r, slot, d } = found;
  const rand = rng(id);
  const result = d.result || "live";
  const finished = !["live", "new"].includes(result);
  const plies = d.plies ?? (result === "new" || result === "aborted" ? 0
    : finished ? 40 + Math.floor(rand() * 50) : 10 + Math.floor(rand() * 40));
  const extra = growing && result === "live" ? fetches.get(id) ?? 0 : 0;
  fetches.set(id, extra + 1);

  const c = new Chess();
  for (let i = 0; i < plies + extra && !c.isGameOver(); i++) {
    const moves = c.moves();
    c.move(moves[Math.floor(rand() * moves.length)]);
  }
  const last = c.history({ verbose: true }).at(-1);

  let status = "started", winner;
  if (result === "aborted") status = "aborted";
  else if (finished) {
    winner = { "1-0": "white", "0-1": "black" }[result];
    status = d.status || (winner ? "resign" : "draw");
  }

  let white = d.white || slot.white, black = d.black || slot.black;
  if (d.swapColours) [white, black] = [black, white];
  const rated = d.rated ?? parsed.rated;
  const seed = (u) => parsed.roster.get(u.toLowerCase())?.seedRating ?? 1500;
  const diff = (color) => (!rated || !finished || status === "aborted" ? undefined : !winner ? 0 : winner === color ? 9 : -9);
  const side = (u, color) => ({ user: { id: u.toLowerCase(), name: u }, rating: seed(u), ratingDiff: diff(color) });

  const clock = d.clock && { initial: d.clock.minutes * 60, increment: d.clock.increment ?? 0 };
  if (clock) clock.totalTime = clock.initial + 40 * clock.increment;
  const daysPerTurn = clock ? undefined : d.daysPerTurn ?? 3;
  const createdAt = now - (parsed.rounds.length + 1 - r) * 10 * DAY;
  const lastMoveAt = finished ? createdAt + 8 * DAY : extra ? Date.now() : plies ? now - (d.hoursAgo ?? rand() * 30) * HOUR : undefined;
  return {
    id, rated, status, winner, daysPerTurn, clock, createdAt, lastMoveAt,
    players: { white: side(white, "white"), black: side(black, "black") },
    moves: c.history().join(" "),
    lastFen: c.fen(),
    lastMove: last ? last.from + last.to + (last.promotion || "") : undefined,
    opening: plies ? { name: "Random play" } : undefined,
  };
}

// The made-up export already has every move, so there's no stream to read.
export async function fetchHistory() {
  return null;
}

export const { finishedGame, cacheFinished } = gameCache();
