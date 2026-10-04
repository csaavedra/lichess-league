// Pure logic for tournament.html: no DOM, no network, no module state.
// Tested by lib.test.js (node --test).

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const ONGOING = new Set(["created", "started"]);
const VOID = new Set(["aborted", "noStart"]);
export const DEFAULT_SCORING = { win: 1, draw: 0.5, loss: 0 };

export const fmtPts = (n) => {
  const whole = Math.floor(n), frac = n - whole;
  if (Math.abs(frac - 0.5) < 1e-9) return (whole ? whole : "") + "½";
  return String(+n.toFixed(2));
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Correspondence: the player to move has daysPerTurn days from the last move
// (or the game's creation), as on Lichess. The export has no clock object.
export const DAY_MS = 86400000;
export function deadlineOf(g) {
  if (g.result || !g.moves.length || !g.daysPerTurn) return null;
  return g.lastMoveAt + g.daysPerTurn * DAY_MS;
}
// Rounded down, so it never shows more time than there is.
export function fmtLeft(ms) {
  if (ms <= 0) return "out of time";
  const min = Math.floor(ms / 60000), h = Math.floor(min / 60), d = Math.floor(h / 24);
  if (d) return `${plural(d, "day")}${h % 24 ? ` ${h % 24} h` : ""} left`;
  if (h) return `${h} h${min % 60 ? ` ${min % 60} min` : ""} left`;
  return min ? `${min} min left` : "less than a minute left";
}

// ---------- config parsing ----------
// "https://lichess.org/AbCd1234WxYz?x" -> "AbCd1234WxYz"
export const stripLink = (raw) => String(raw || "").trim().replace(/^https?:\/\/[^/]+\//i, "").split(/[/?#]/)[0];
export function extractId(raw) {
  const id = stripLink(raw).slice(0, 8);
  return /^[A-Za-z0-9]{8}$/.test(id) ? id : null;
}
// A 12-character ID is a game ID plus a player's private token.
export const isPrivateId = (raw) => /^[A-Za-z0-9]{12}$/.test(stripLink(raw));

// ---------- games ----------
function playerOf(p) {
  if (p?.user) return { id: p.user.id || p.user.name.toLowerCase(), username: p.user.name, rating: p.rating ?? null, ratingDiff: p.ratingDiff ?? null, provisional: !!p.provisional };
  return { id: "?anon", username: "Anonymous", rating: null, ratingDiff: null, provisional: false };
}

// A game from the Lichess export, reduced to what the page uses.
export function summarize(g) {
  const white = playerOf(g.players?.white);
  const black = playerOf(g.players?.black);
  const moves = (g.moves || "").split(" ").filter(Boolean);
  const fen = g.lastFen || START_FEN;
  let result = null;
  if (VOID.has(g.status)) result = "void";
  else if (!ONGOING.has(g.status)) result = g.winner === "white" ? "1-0" : g.winner === "black" ? "0-1" : "½-½";
  let last = null;
  if (g.lastMove && g.lastMove.length >= 4) last = [g.lastMove.slice(0, 2), g.lastMove.slice(2, 4)];
  return {
    id: g.id, white, black, moves, positions: null, fen, last, lastUci: g.lastMove || null, result, status: g.status,
    turn: fen.split(" ")[1] === "b" ? "black" : "white",
    lastMoveAt: g.lastMoveAt || g.createdAt,
    createdAt: g.createdAt,
    opening: g.opening ? g.opening.name : "",
    daysPerTurn: g.daysPerTurn || null,
    rated: !!g.rated,
  };
}

// ---------- standings ----------
// rounds: [{ ids }], games: Map id -> summary, players: Map username -> { username, name, seed, seedRating }.
export function computeStandings(rounds, games, players, sc = DEFAULT_SCORING) {
  const P = new Map();
  const ensure = (id, username, fromGame) => {
    if (!P.has(id)) P.set(id, { id, username, pts: 0, played: 0, wins: 0, cells: new Map(), sb: 0 });
    const p = P.get(id);
    if (fromGame) p.username = username; // Lichess has the correct capitalisation
    return p;
  };
  players.forEach((v, k) => ensure(k, v.username));
  const cell = (a, b) => { if (!a.cells.has(b.id)) a.cells.set(b.id, []); return a.cells.get(b.id); };

  rounds.forEach((r) => r.ids.forEach((id) => {
    const g = games.get(id);
    if (!g) return;
    const w = ensure(g.white.id, g.white.username, true);
    const b = ensure(g.black.id, g.black.username, true);
    if (g.result === "void") return;
    if (!g.result) { cell(w, b).push({ live: true }); cell(b, w).push({ live: true }); return; }
    const [wk, bk] = { "1-0": "wl", "0-1": "lw", "½-½": "dd" }[g.result];
    for (const [me, opp, kind] of [[w, b, wk], [b, w, bk]]) {
      const s = { w: sc.win, d: sc.draw, l: sc.loss }[kind];
      me.pts += s; me.played++;
      if (kind === "w") me.wins++;
      cell(me, opp).push({ s, kind });
    }
  }));

  P.forEach((p) => {
    p.cells.forEach((list, oppId) => {
      const opp = P.get(oppId);
      list.forEach((c) => { if (!c.live && sc.win) p.sb += (c.s / sc.win) * opp.pts; });
    });
  });

  // Tiebreaks, in order: wins against the players tied on points,
  // Sonneborn–Berger, total wins, seed, and finally name.
  const seedOf = (id) => players.get(id)?.seed ?? null;
  const nameOf = (p) => players.get(p.id)?.name || p.username;
  const list = [...P.values()].filter((p) => p.id !== "?anon");
  list.forEach((p) => {
    const tied = list.filter((o) => o !== p && Math.abs(o.pts - p.pts) < 1e-9);
    p.tied = tied.length > 0;
    p.tiedWins = tied.reduce((n, o) => n + (p.cells.get(o.id) || []).filter((c) => c.kind === "w").length, 0);
  });
  return list.sort((a, b) =>
    b.pts - a.pts || b.tiedWins - a.tiedWins || b.sb - a.sb || b.wins - a.wins ||
    (seedOf(a.id) ?? Infinity) - (seedOf(b.id) ?? Infinity) || nameOf(a).localeCompare(nameOf(b))
  );
}

// A game whose players or colours differ from its slot in the schedule:
// "reversed", "other", or "" when it matches.
export function scheduleMismatch(slot, g) {
  if (!g) return "";
  if (g.white.id === slot.white && g.black.id === slot.black) return "";
  if (g.white.id === slot.black && g.black.id === slot.white) return "reversed";
  return "other";
}

// A game that isn't rated when the tournament is, or the other way round.
export const ratedMismatch = (rated, g) => !!g && g.rated !== rated;

// ---------- player stats ----------
const expected = (me, opp) => 1 / (1 + Math.pow(10, (opp - me) / 400));

export function playerGames(pid, rounds, games) {
  const list = [];
  rounds.forEach((r) => r.ids.forEach((id) => {
    const g = games.get(id);
    if (!g) return;
    const color = g.white.id === pid ? "white" : g.black.id === pid ? "black" : null;
    if (!color) return;
    let score = null;
    if (g.result && g.result !== "void") score = g.result === "½-½" ? 0.5 : (g.result === "1-0") === (color === "white") ? 1 : 0;
    list.push({ g, round: r.name, color, me: g[color], opp: g[color === "white" ? "black" : "white"], score });
  }));
  return list;
}

export function playerStats(list, players, sc = DEFAULT_SCORING) {
  const seedRatingOf = (id) => players.get(id)?.seedRating ?? null;
  const st = { n: 0, w: 0, d: 0, l: 0, frac: 0, pts: 0, exp: 0, expN: 0, expLichess: 0, oppSum: 0, oppN: 0, oppLichess: 0, perfSum: 0, diff: 0, diffN: 0, live: 0,
    white: { n: 0, pts: 0 }, black: { n: 0, pts: 0 } };
  list.forEach(({ g, color, me, opp, score }) => {
    if (g.result === "void") return;
    if (score === null) { st.live++; return; }
    st.n++;
    st.frac += score;
    const pts = score === 1 ? sc.win : score === 0 ? sc.loss : sc.draw;
    st.pts += pts;
    st[color].n++; st[color].pts += pts;
    if (score === 1) st.w++; else if (score === 0) st.l++; else st.d++;
    // Seed ratings are each player's fixed tournament rating; Lichess ratings
    // change from game to game and can be provisional. Fall back to the
    // Lichess rating at the start of the game for a player without one.
    const oppR = seedRatingOf(opp.id) ?? opp.rating;
    const meR = seedRatingOf(me.id) ?? me.rating;
    if (oppR != null) {
      st.oppSum += oppR; st.oppN++;
      if (seedRatingOf(opp.id) == null) st.oppLichess++;
      // Lichess (as in its Swiss tournaments): opponent's rating, +500 for a win, −500 for a loss.
      st.perfSum += oppR + (score === 1 ? 500 : score === 0 ? -500 : 0);
      if (meR != null) {
        st.exp += expected(meR, oppR); st.expN++;
        if (seedRatingOf(opp.id) == null || seedRatingOf(me.id) == null) st.expLichess++;
      }
    }
    if (me.ratingDiff != null) { st.diff += me.ratingDiff; st.diffN++; }
  });
  // Performance only makes sense when every finished game has a rated opponent.
  st.perf = st.n && st.oppN === st.n ? Math.round(st.perfSum / st.n) : null;
  st.avgOpp = st.oppN ? Math.round(st.oppSum / st.oppN) : null;
  return st;
}
