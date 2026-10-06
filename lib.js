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
const deadline = (g) => g.lastMoveAt + g.daysPerTurn * DAY_MS;
export function deadlineOf(g) {
  if (g.result || !g.moves.length || !g.daysPerTurn) return null;
  return deadline(g);
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
    // Seconds in the export; minutes here, as in tournament.json.
    clock: g.clock ? { minutes: g.clock.initial / 60, increment: g.clock.increment } : null,
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

// ---------- time control ----------
// The values Lichess's challenge form offers. A challenge link with any
// other value can't be sent, so the setting has to be one of these.
const LICHESS_DAYS = [1, 2, 3, 5, 7, 10, 14];
const LICHESS_MINUTES = [0, 1 / 4, 1 / 2, 3 / 4, 1, 3 / 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  25, 30, 35, 40, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];
const LICHESS_INCREMENTS = [...Array(21).keys(), 25, 30, 35, 40, 45, 60, 90, 120, 150, 180];

// tournament.json has { "days": 3 } for correspondence, or
// { "minutes": 90, "increment": 30 } for a clock (increment in seconds).
// Returns { tc, error }: tc is null when there is no setting, or it's invalid.
export function parseTimeControl(raw) {
  if (raw == null) return { tc: null, error: "" };
  const bad = (why) => ({ tc: null, error: `The timeControl in tournament.json ${why}, so the page ignores it.` });
  if (typeof raw !== "object" || Array.isArray(raw)) return bad('should look like { "days": 3 } or { "minutes": 90, "increment": 30 }');
  const { days, minutes, increment = 0 } = raw;
  if (days != null && minutes != null) return bad('has both "days" and "minutes"');
  if (days != null) {
    return LICHESS_DAYS.includes(days) ? { tc: { days }, error: "" }
      : bad(`has "days": ${JSON.stringify(days)}, and Lichess only offers ${LICHESS_DAYS.slice(0, -1).join(", ")} or ${LICHESS_DAYS.at(-1)} days per move`);
  }
  if (minutes == null) return bad('needs either "days" or "minutes"');
  if (!LICHESS_MINUTES.includes(minutes)) return bad(`has "minutes": ${JSON.stringify(minutes)}, which isn't a clock Lichess offers`);
  if (!LICHESS_INCREMENTS.includes(increment)) return bad(`has "increment": ${JSON.stringify(increment)}, which isn't an increment Lichess offers`);
  if (!minutes && !increment) return bad("has a clock of no time at all");
  return { tc: { minutes, increment }, error: "" };
}

// A game's time control, in the same shape; null for one with no time limit.
export function gameTimeControl(g) {
  if (g.daysPerTurn) return { days: g.daysPerTurn };
  if (g.clock) return { minutes: g.clock.minutes, increment: g.clock.increment };
  return null;
}

export function fmtTimeControl(tc) {
  if (!tc) return "no time limit";
  if (tc.days) return `${plural(tc.days, "day")} per move`;
  return `${tc.minutes} min` + (tc.increment ? ` + ${tc.increment} s per move` : "");
}

// A game played at another time control than the tournament's. Without a
// setting there is nothing to check.
export function timeControlMismatch(tc, g) {
  if (!tc || !g) return false;
  const have = gameTimeControl(g);
  if (!have) return true;
  return tc.days ? have.days !== tc.days : have.minutes !== tc.minutes || have.increment !== tc.increment;
}

// ---------- challenges ----------
// Lichess's "challenge a friend" form, filled in and locked to the
// tournament's settings. "color" is the side of whoever opens the link,
// White; "user" is the opponent.
export function challengeUrl(slot, { rated, timeControl }) {
  const q = new URLSearchParams({ user: slot.black, color: "white", variant: "standard", gameMode: rated ? "rated" : "casual" });
  if (timeControl?.days) {
    q.set("time", "correspondence");
    q.set("days", timeControl.days);
  } else if (timeControl) {
    q.set("time", "realTime");
    q.set("minutesPerSide", timeControl.minutes);
    q.set("increment", timeControl.increment);
  }
  return `https://lichess.org/?${q}#friend`;
}

// ---------- subtitle ----------
// "Rated · round-robin · 3 days per move · since October 1st, 2026"

// Returns { format, error }: format is null when the setting is invalid.
export function parseFormat(raw) {
  if (raw == null || raw === "round-robin") return { format: "round-robin", error: "" };
  return { format: null, error: `The format in tournament.json is ${JSON.stringify(raw)}, but the page only supports "round-robin", so it ignores it.` };
}

// Lichess keeps no end time. A game on time ends at its deadline; anything
// else ends at its last move, which for a resignation or a draw offer
// is earlier than the real end.
export function endOf(g) {
  if (g.status === "outoftime" && g.daysPerTurn) return deadline(g);
  return g.lastMoveAt;
}

// When the tournament ran: start is null until a game exists, end until
// every scheduled game has a result. slots: [{ id }], games: Map id -> summary.
export function tournamentSpan(slots, games) {
  const played = slots.map((x) => x.id && games.get(x.id)).filter((g) => g && g.result !== "void");
  if (!played.length) return { start: null, end: null };
  const start = Math.min(...played.map((g) => g.createdAt));
  const done = played.length === slots.length && played.every((g) => g.result);
  return { start, end: done ? Math.max(...played.map(endOf)) : null };
}

// In the viewer's time zone, but always in English, like the rest of the page.
const ORDINAL = { one: "st", two: "nd", few: "rd", other: "th" };
const ordinals = new Intl.PluralRules("en", { type: "ordinal" });
const day = (d) => `${d.getDate()}${ORDINAL[ordinals.select(d.getDate())]}`;
const month = (d) => d.toLocaleString("en", { month: "long" });
const full = (d) => `${month(d)} ${day(d)}, ${d.getFullYear()}`;

export function fmtSpan({ start, end }) {
  if (start == null) return "upcoming";
  const a = new Date(start);
  if (end == null) return `since ${full(a)}`;
  const b = new Date(end);
  if (a.getFullYear() !== b.getFullYear()) return `${full(a)} – ${full(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${month(a)} ${day(a)} – ${full(b)}`;
  if (a.getDate() !== b.getDate()) return `${month(a)} ${day(a)} – ${day(b)}, ${b.getFullYear()}`;
  return full(a);
}

// One game's dates. A game on a clock only needs the day it started.
export function gameDates(g) {
  if (g.result === "void") return null;
  if (g.clock) return fmtSpan({ start: g.createdAt, end: g.createdAt });
  return fmtSpan({ start: g.createdAt, end: g.result ? endOf(g) : null });
}

// span: fmtSpan()'s text, or null to leave the dates out.
export function subtitleText({ rated, format, timeControl, span }) {
  return [rated ? "Rated" : "Unrated", format, timeControl && fmtTimeControl(timeControl), span].filter(Boolean).join(" · ");
}

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
