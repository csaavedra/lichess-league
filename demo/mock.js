// Loaded by demo/serve.py before the page's own script. Answers the page's
// Lichess requests with games described by the "demo" field of each game in
// the scenario file, played out with random legal moves. Fields, all optional:
//   result:     "1-0", "0-1", "½-½", "live" (default), "new" (no moves yet)
//               or "aborted"
//   status:     the Lichess end reason, e.g. "mate", "outoftime" (default
//               "resign" for a win, "draw" for a draw)
//   white, black: the players on Lichess, if not the scheduled ones
//   swapColours: true to play the scheduled game with colours reversed
//   rated:      whether the game is rated (default: the tournament's setting)
//   hoursAgo:   for a game in progress, when the last move was made
//   daysPerTurn: default 3
//   missing:    true for a game Lichess doesn't know
//   plies:      how many half-moves to play

// Every scenario shares this origin, so clear the page's cache of finished
// games, or one scenario would show another's results for the same ID.
try {
  for (const k of Object.keys(localStorage)) if (k.startsWith("tournament:")) localStorage.removeItem(k);
} catch { /* storage blocked */ }

(() => {
  const realFetch = window.fetch.bind(window);
  const chess = import("https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js");
  const config = realFetch("tournament.json").then((r) => r.json());
  const HOUR = 3600000, DAY = 24 * HOUR, now = Date.now();

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

  function find(cfg, id) {
    for (const [r, round] of (cfg.rounds || []).entries()) {
      for (const slot of round.games || []) {
        if (String(slot.id || "").trim().slice(0, 8) === id) return { r, slot, d: slot.demo || {} };
      }
    }
    return null;
  }

  async function game(id) {
    const { Chess } = await chess;
    const cfg = await config;
    const found = find(cfg, id);
    if (!found || found.d.missing) return null;
    const { r, slot, d } = found;
    const rand = rng(id);
    const result = d.result || "live";
    const finished = !["live", "new"].includes(result);
    const plies = d.plies ?? (result === "new" || result === "aborted" ? 0
      : finished ? 40 + Math.floor(rand() * 50) : 10 + Math.floor(rand() * 40));

    const c = new Chess();
    for (let i = 0; i < plies && !c.isGameOver(); i++) {
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
    const rated = d.rated ?? cfg.rated !== false;
    const seed = (u) => (cfg.players || []).find((p) => p.username === u)?.seedRating ?? 1500;
    const diff = (color) => (!rated || !finished || status === "aborted" ? undefined : !winner ? 0 : winner === color ? 9 : -9);
    const side = (u, color) => ({ user: { id: u.toLowerCase(), name: u }, rating: seed(u), ratingDiff: diff(color) });

    const daysPerTurn = d.daysPerTurn ?? 3;
    const createdAt = now - (cfg.rounds.length + 1 - r) * 10 * DAY;
    const lastMoveAt = finished ? createdAt + 8 * DAY : plies ? now - (d.hoursAgo ?? rand() * 30) * HOUR : undefined;
    return {
      id, rated, status, winner, daysPerTurn, createdAt, lastMoveAt,
      players: { white: side(white, "white"), black: side(black, "black") },
      moves: c.history().join(" "),
      lastFen: c.fen(),
      lastMove: last ? last.from + last.to + (last.promotion || "") : undefined,
      opening: plies ? { name: "Random play" } : undefined,
    };
  }

  window.fetch = async (url, opts) => {
    const u = String(url);
    const m = u.match(/^https:\/\/lichess\.org\/game\/export\/(\w+)/);
    if (m) {
      const g = await game(m[1]);
      return g ? Response.json(g) : new Response("Not found", { status: 404 });
    }
    // The game stream: the export above already has every move.
    if (u.startsWith("https://lichess.org/")) return new Response("Not found", { status: 404 });
    return realFetch(url, opts);
  };
})();
