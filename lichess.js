// Everything tournament.html asks Lichess, and the games it keeps from it.
// No DOM; network and localStorage only.

import { ONGOING } from "./lib.js";

// A 429: the caller should back off before asking again.
const rateError = () => Object.assign(new Error("rate"), { rate: true });

// One game at a time through the single-game export. The bulk endpoint
// (/api/games/export/_ids) allows only 2 concurrent requests per IP address,
// and Lichess can keep that slot taken long after a request ends, which
// blocks the page for everyone on the same network.
const EXPORT_PARAMS = "moves=true&lastFen=true&opening=true&evals=false&clocks=false&accuracy=false&literate=false";

// The game as Lichess exports it, or null when Lichess doesn't know it.
export async function fetchGame(id) {
  const res = await fetch(`https://lichess.org/game/export/${id}?${EXPORT_PARAMS}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (res.status === 429) throw rateError();
  if (!res.ok) throw new Error(`Lichess answered with status ${res.status}.`);
  return res.json();
}

// The export API leaves out the last few moves of games in progress (an
// anti-cheat delay), although lastFen is current. The game stream has the
// full history, so read it until it reaches the exported position, then stop.
const STREAM_TIMEOUT_MS = 15000;
const fenKey = (fen) => String(fen || "").split(" ").slice(0, 2).join(" ");

// g: a summary from lib.js. Returns the stream's positions, [{ fen, lm }]
// from the start to g's position, or null if the stream didn't get there.
export async function fetchHistory(g) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STREAM_TIMEOUT_MS);
  const target = fenKey(g.fen);
  const list = [];
  try {
    const res = await fetch(`https://lichess.org/api/stream/game/${g.id}`, { signal: ctrl.signal, headers: { Accept: "application/x-ndjson" } });
    if (res.status === 429) throw rateError();
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    read: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (!msg.fen || msg.id) continue; // the first line is the game itself
        list.push(msg);
        if (fenKey(msg.fen) === target && (msg.lm || null) === g.lastUci) break read;
      }
    }
  } catch (err) {
    if (err.rate) throw err;
    return null;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  if (!list.length || fenKey(list[list.length - 1].fen) !== target) return null;
  return list;
}

// Finished games never change, so keep them in this browser and only ask
// Lichess for games still in progress (or not seen yet).
const CACHE_KEY = "tournament:finished-games:v3";
const finishedCache = (() => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
})();

// The export of a finished game seen before, or undefined.
export const finishedGame = (id) => finishedCache[id];

// Keeps an export if its game is over.
export function cacheFinished(g) {
  if (ONGOING.has(g.status)) return;
  const { id, rated, status, winner, players, moves, lastFen, lastMove, lastMoveAt, createdAt, opening, daysPerTurn, clock } = g;
  finishedCache[id] = { id, rated, status, winner, players, moves, lastFen, lastMove, lastMoveAt, createdAt, opening, daysPerTurn, clock };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(finishedCache)); } catch { /* storage full or blocked */ }
}
