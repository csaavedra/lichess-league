// Everything tournament.html asks Lichess, and the games it keeps from it.
// No DOM; network and localStorage only.

import { gameCache } from "./lib.js";

// A 429: the caller should back off before asking again.
const rateError = () => Object.assign(new Error("rate"), { rate: true });

// One game at a time through the single-game export, as the API docs ask
// for one request at a time. The bulk endpoint (/api/games/export/_ids)
// allows only 2 concurrent requests per IP address, shared with everyone
// else on the same network.
const EXPORT_PARAMS =
  "moves=true&lastFen=true&opening=true&evals=false&clocks=false&accuracy=false&literate=false";

// The game as Lichess exports it, or null when Lichess doesn't know it.
export async function fetchGame(id) {
  const res = await fetch(
    `https://lichess.org/game/export/${id}?${EXPORT_PARAMS}`,
    { headers: { Accept: "application/json" } },
  );
  if (res.status === 404) return null;
  if (res.status === 429) throw rateError();
  if (!res.ok) throw new Error(`Lichess answered with status ${res.status}.`);
  return res.json();
}

// The export leaves out the last 3 moves of games in progress (an anti-cheat
// delay), although lastFen is current. The game stream only has that delay
// for games with a clock, so for correspondence games read it until it
// reaches the exported position, then stop.
const STREAM_TIMEOUT_MS = 15000;
const fenKey = (fen) =>
  String(fen || "")
    .split(" ")
    .slice(0, 2)
    .join(" ");

// g: a summary from lib.js. Returns the stream's positions, [{ fen, lm }]
// from the start to g's position, or null if the stream didn't get there.
export async function fetchHistory(g) {
  if (g.clock) return null; // the stream is 3 moves behind too
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STREAM_TIMEOUT_MS);
  const target = fenKey(g.fen);
  const list = [];
  try {
    const res = await fetch(`https://lichess.org/api/stream/game/${g.id}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/x-ndjson" },
    });
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
        if (fenKey(msg.fen) === target && (msg.lm || null) === g.lastUci)
          break read;
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

// Finished games are kept in this browser's localStorage, which is missing
// or throws when the browser blocks storage. gameCache() is in lib.js.
const storage = (() => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
})();
export const { finishedGame, cacheFinished } = gameCache(
  storage,
  "tournament:finished-games:v3",
);
