// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  START_FEN, DAY_MS, fmtPts, plural, deadlineOf, fmtLeft, extractId, isPrivateId, summarize,
  computeStandings, scheduleMismatch, ratedMismatch, playerGames, playerStats,
  parseTimeControl, gameTimeControl, fmtTimeControl, timeControlMismatch, challengeUrl,
  parseFormat, endOf, tournamentSpan, fmtSpan, gameDates, subtitleText, refreshSeconds,
} from "./lib.js";

// players: [[username, seed, seedRating]] -> the page's roster map.
function playersMap(list) {
  return new Map(list.map(([u, seed, seedRating]) => [u, { username: u, name: u.toUpperCase(), seed, seedRating: seedRating ?? null }]));
}

// A Lichess export reduced by summarize(), as the page does.
// result: "1-0", "0-1", "½-½", "live" or "aborted".
let nextId = 0;
function game(white, black, result, extra = {}) {
  const status = extra.status ?? { "1-0": "mate", "0-1": "resign", "½-½": "draw", live: "started", aborted: "aborted" }[result];
  const winner = { "1-0": "white", "0-1": "black" }[result];
  const side = (u, rating, ratingDiff) => ({ user: { id: u, name: u }, rating, ratingDiff });
  return summarize({
    id: `game${String(nextId++).padStart(4, "0")}`, status, winner, rated: extra.rated ?? true,
    players: { white: side(white, extra.whiteRating ?? 1500, extra.whiteDiff), black: side(black, extra.blackRating ?? 1500, extra.blackDiff) },
    moves: extra.moves ?? "e4 e5 Nf3",
    lastMoveAt: extra.lastMoveAt ?? 1000, createdAt: extra.createdAt ?? 0,
    daysPerTurn: "daysPerTurn" in extra ? extra.daysPerTurn : 3, clock: extra.clock,
  });
}

// games: list of summaries, all in a single round.
function setup(games) {
  return { rounds: [{ name: "Round 1", ids: games.map((g) => g.id) }], games: new Map(games.map((g) => [g.id, g])) };
}

function standings(players, games) {
  const { rounds, games: map } = setup(games);
  return computeStandings(rounds, map, players);
}

const byId = (rows) => Object.fromEntries(rows.map((p) => [p.id, p]));

test("a 3-way tie is decided by wins against the tied players before SB", () => {
  // a, b and c finish on 2 points. Only a beat another tied player (c),
  // although b has the better Sonneborn–Berger and c the better seed.
  const players = playersMap([["c", 1], ["b", 2], ["a", 3], ["d", 4], ["e", 5], ["f", 6]]);
  const rows = standings(players, [
    game("a", "c", "1-0"), game("a", "b", "½-½"), game("b", "c", "½-½"),
    game("a", "e", "½-½"), game("b", "d", "1-0"), game("c", "d", "1-0"), game("c", "f", "½-½"),
    game("d", "e", "1-0"), game("d", "f", "½-½"),
  ]);
  const p = byId(rows);
  assert.deepEqual([p.a.pts, p.b.pts, p.c.pts], [2, 2, 2]);
  assert.deepEqual([p.a.tiedWins, p.b.tiedWins, p.c.tiedWins], [1, 0, 0]);
  assert.ok(p.b.sb > p.a.sb, "b has the better SB");
  assert.ok(p.a.tied && p.b.tied && p.c.tied);
  assert.ok(!p.d.tied);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", "d", "f", "e"]);
});

test("draws between tied players don't count for TW", () => {
  // a and b drew each other and finish on 1½. TW is 0 for both, so SB decides,
  // against the seeds.
  const players = playersMap([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
  const rows = standings(players, [
    game("a", "b", "½-½"), game("a", "d", "1-0"), game("b", "c", "1-0"), game("c", "d", "1-0"),
  ]);
  const p = byId(rows);
  assert.equal(p.a.pts, 1.5);
  assert.equal(p.b.pts, 1.5);
  assert.equal(p.a.tiedWins, 0);
  assert.equal(p.b.tiedWins, 0);
  assert.equal(p.a.sb, 0.75);
  assert.equal(p.b.sb, 1.75);
  assert.deepEqual(rows.map((r) => r.id), ["b", "a", "c", "d"]);
});

test("TW counts wins against the whole tied group", () => {
  // a, b and c on 1 point each; a and b each beat one tied player, c beat d.
  const players = playersMap([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
  const p = byId(standings(players, [game("a", "b", "1-0"), game("b", "c", "1-0"), game("c", "d", "1-0")]));
  assert.deepEqual([p.a.tiedWins, p.b.tiedWins, p.c.tiedWins], [1, 1, 0]);
});

test("equal on points, TW and SB: wins decide, then seed", () => {
  // a, d and b on 1 point with SB ½ and no games between them. a and d won
  // a game, b drew two, so b drops to third although seeded first. Seed,
  // against name order, puts d before a and e before c.
  const players = playersMap([["b", 1], ["d", 2], ["e", 3], ["a", 4], ["c", 5]]);
  const rows = standings(players, [
    game("a", "c", "1-0"), game("b", "c", "½-½"), game("b", "e", "½-½"), game("d", "e", "1-0"),
  ]);
  const p = byId(rows);
  assert.deepEqual([p.a.pts, p.d.pts, p.b.pts], [1, 1, 1]);
  assert.deepEqual([p.a.sb, p.d.sb, p.b.sb], [0.5, 0.5, 0.5]);
  assert.deepEqual([p.a.tiedWins, p.d.tiedWins, p.b.tiedWins], [0, 0, 0]);
  assert.deepEqual(rows.map((r) => r.id), ["d", "a", "b", "e", "c"]);
});

test("SB leaves out games in progress", () => {
  // c has 1 point, but a's game against c is still being played.
  const players = playersMap([["a", 1], ["b", 2], ["c", 3]]);
  const p = byId(standings(players, [game("a", "b", "1-0"), game("c", "b", "1-0"), game("a", "c", "live")]));
  assert.equal(p.a.pts, 1);
  assert.equal(p.c.pts, 1);
  assert.equal(p.a.sb, 0);
  assert.equal(p.c.sb, 0);
  assert.equal(p.a.played, 1);
  assert.deepEqual(p.a.cells.get("c"), [{ live: true }]);
});

test("aborted games are ignored", () => {
  const players = playersMap([["a", 1, 1500], ["b", 2, 1500]]);
  const aborted = game("a", "b", "aborted");
  const noStart = summarize({ id: "noStart1", status: "noStart", players: { white: { user: { id: "b", name: "b" } }, black: { user: { id: "a", name: "a" } } } });
  assert.equal(aborted.result, "void");
  assert.equal(noStart.result, "void");

  const { rounds, games } = setup([aborted, noStart]);
  const p = byId(computeStandings(rounds, games, players));
  assert.equal(p.a.pts, 0);
  assert.equal(p.a.played, 0);
  assert.equal(p.a.cells.size, 0);

  const st = playerStats(playerGames("a", rounds, games), players);
  assert.equal(st.n, 0);
  assert.equal(st.live, 0);
  assert.equal(st.perf, null);
});

test("scores follow the scoring in tournament.json", () => {
  const players = playersMap([["a", 1], ["b", 2], ["c", 3]]);
  const { rounds, games } = setup([game("a", "b", "1-0"), game("b", "c", "½-½")]);
  const p = byId(computeStandings(rounds, games, players, { win: 3, draw: 1, loss: 0 }));
  assert.equal(p.a.pts, 3);
  assert.equal(p.b.pts, 1);
  assert.equal(p.a.sb, 1); // full wins weigh 1, whatever a win is worth
});

test("unscheduled players still appear, anonymous ones don't", () => {
  const players = playersMap([["a", 1]]);
  const anon = summarize({ id: "anon0001", status: "mate", winner: "white", players: { white: { user: { id: "a", name: "A" } }, black: {} } });
  const rows = standings(players, [game("a", "x", "0-1"), anon]);
  assert.deepEqual(rows.map((r) => r.id), ["x", "a"]);
  assert.equal(byId(rows).a.username, "A"); // capitalisation from Lichess
});

test("performance and expected score from seed ratings", () => {
  // Opponents seeded 1500 and 1700; average 1600.
  const players = playersMap([["me", 1, 1600], ["o1", 2, 1500], ["o2", 3, 1700]]);
  const statsFor = (r1, r2) => {
    const { rounds, games } = setup([game("me", "o1", r1, { whiteDiff: 10 }), game("o2", "me", r2, { blackDiff: -4 })]);
    return playerStats(playerGames("me", rounds, games), players);
  };

  const all = statsFor("1-0", "0-1");
  assert.equal(all.perf, 2100);
  assert.equal(all.avgOpp, 1600);
  assert.deepEqual([all.n, all.w, all.d, all.l, all.pts], [2, 2, 0, 0, 2]);
  assert.deepEqual(all.white, { n: 1, pts: 1 });
  assert.deepEqual(all.black, { n: 1, pts: 1 });
  assert.equal(all.diff, 6);
  assert.deepEqual([all.oppLichess, all.expLichess], [0, 0]);

  const half = statsFor("½-½", "½-½");
  assert.equal(half.perf, 1600);
  assert.deepEqual([half.w, half.d, half.l, half.pts], [0, 2, 0, 1]);
  // Equal-rated-on-average opponents spread evenly: expected exactly 1 of 2.
  assert.ok(Math.abs(half.exp - 1) < 1e-9);

  const none = statsFor("0-1", "1-0");
  assert.equal(none.perf, 1100);
  assert.deepEqual([none.w, none.d, none.l, none.pts], [0, 0, 2, 0]);
});

test("performance falls back to Lichess ratings and counts live games apart", () => {
  const players = playersMap([["me", 1], ["o1", 2]]);
  const { rounds, games } = setup([
    game("me", "o1", "1-0", { whiteRating: 1800, blackRating: 1400 }),
    game("o1", "me", "live"),
  ]);
  const st = playerStats(playerGames("me", rounds, games), players);
  assert.equal(st.perf, 1900);
  assert.equal(st.n, 1);
  assert.equal(st.live, 1);
  assert.ok(Math.abs(st.exp - 1 / (1 + 10 ** (-400 / 400))) < 1e-9);
  assert.deepEqual([st.oppLichess, st.expLichess], [1, 1]);
});

test("no performance when an opponent has no rating at all", () => {
  // o2 has no seed rating and no Lichess rating; o1 still counts for the average.
  const players = playersMap([["me", 1, 1600], ["o1", 2, 1500], ["o2", 3]]);
  const unrated = summarize({ id: "unrated1", status: "mate", winner: "white",
    players: { white: { user: { id: "me", name: "me" } }, black: { user: { id: "o2", name: "o2" } } } });
  const { rounds, games } = setup([game("o1", "me", "0-1"), unrated]);
  const st = playerStats(playerGames("me", rounds, games), players);
  assert.equal(st.n, 2);
  assert.equal(st.perf, null);
  assert.equal(st.avgOpp, 1500);
  assert.equal(st.oppLichess, 0); // o2 has no rating at all, so it isn't in the average
});

test("expected score counts a game with only the player's own Lichess rating", () => {
  const players = playersMap([["me", 1], ["o1", 2, 1500], ["o2", 3, 1700]]);
  const { rounds, games } = setup([game("me", "o1", "1-0", { whiteRating: 1600 }), game("o2", "me", "½-½")]);
  const st = playerStats(playerGames("me", rounds, games), players);
  assert.deepEqual([st.oppN, st.oppLichess], [2, 0]);
  assert.deepEqual([st.expN, st.expLichess], [2, 2]);
});

test("summarize", () => {
  const g = summarize({
    id: "AbCd1234", status: "started", players: {},
    moves: "e4 e5 Nf3", lastFen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
    lastMove: "g1f3", lastMoveAt: 5000, createdAt: 1000, opening: { name: "King's Knight Opening" }, daysPerTurn: 2,
  });
  assert.equal(g.result, null);
  assert.equal(g.turn, "black");
  assert.deepEqual(g.last, ["g1", "f3"]);
  assert.equal(g.lastUci, "g1f3");
  assert.deepEqual(g.moves, ["e4", "e5", "Nf3"]);
  assert.equal(g.lastMoveAt, 5000);
  assert.equal(g.opening, "King's Knight Opening");
  assert.equal(g.white.username, "Anonymous");
  assert.equal(g.rated, false);
  assert.equal(summarize({ id: "Rated123", status: "started", rated: true }).rated, true);

  // A new game: no moves, no lastFen and no lastMoveAt yet.
  const fresh = summarize({ id: "Fresh123", status: "created", players: {}, createdAt: 1000 });
  assert.equal(fresh.fen, START_FEN);
  assert.equal(fresh.turn, "white");
  assert.equal(fresh.last, null);
  assert.deepEqual(fresh.moves, []);
  assert.equal(fresh.lastMoveAt, 1000);
  assert.equal(fresh.opening, "");
  assert.equal(fresh.daysPerTurn, null);
});

test("schedule checks: reversed colours and wrong players", () => {
  const slot = { white: "a", black: "b" };
  assert.equal(scheduleMismatch(slot, game("a", "b", "live")), "");
  assert.equal(scheduleMismatch(slot, game("b", "a", "live")), "reversed");
  assert.equal(scheduleMismatch(slot, game("a", "c", "live")), "other");
  assert.equal(scheduleMismatch(slot, null), "");
});

test("rated checks: the game must be rated the way the tournament is", () => {
  assert.equal(ratedMismatch(true, game("a", "b", "live")), false);
  assert.equal(ratedMismatch(true, game("a", "b", "live", { rated: false })), true);
  assert.equal(ratedMismatch(false, game("a", "b", "live", { rated: false })), false);
  assert.equal(ratedMismatch(false, game("a", "b", "live")), true);
  assert.equal(ratedMismatch(true, null), false);
});

test("parseTimeControl: days or a clock, anything else is an error", () => {
  assert.deepEqual(parseTimeControl(undefined), { tc: null, error: "" });
  assert.deepEqual(parseTimeControl({ days: 3 }).tc, { days: 3 });
  assert.deepEqual(parseTimeControl({ minutes: 90, increment: 30 }).tc, { minutes: 90, increment: 30 });
  assert.deepEqual(parseTimeControl({ minutes: 10 }).tc, { minutes: 10, increment: 0 });
  assert.deepEqual(parseTimeControl({ minutes: 0.5, increment: 0 }).tc, { minutes: 0.5, increment: 0 });
  assert.deepEqual(parseTimeControl({ minutes: 0, increment: 2 }).tc, { minutes: 0, increment: 2 });
  // Only what Lichess offers, or the challenge links couldn't be sent.
  for (const bad of [3, "3 days", [], {}, { days: 0 }, { days: 2.5 }, { days: "3" }, { days: 3, minutes: 10 },
    { days: 4 }, { days: 30 }, { minutes: 0 }, { minutes: -5 }, { minutes: 0.3 }, { minutes: 21 }, { minutes: 200 },
    { minutes: 10, increment: -1 }, { minutes: 10, increment: "5" }, { minutes: 10, increment: 22 }]) {
    const { tc, error } = parseTimeControl(bad);
    assert.equal(tc, null, JSON.stringify(bad));
    assert.match(error, /timeControl/, JSON.stringify(bad));
  }
});

test("time control checks: the game must match the tournament's", () => {
  const corr = game("a", "b", "live");
  const fast = game("a", "b", "live", { daysPerTurn: null, clock: { initial: 5400, increment: 30, totalTime: 6600 } });
  const unlimited = game("a", "b", "live", { daysPerTurn: null });
  assert.deepEqual(gameTimeControl(corr), { days: 3 });
  assert.deepEqual(gameTimeControl(fast), { minutes: 90, increment: 30 });
  assert.equal(gameTimeControl(unlimited), null);

  assert.equal(timeControlMismatch({ days: 3 }, corr), false);
  assert.equal(timeControlMismatch({ days: 5 }, corr), true);
  assert.equal(timeControlMismatch({ days: 3 }, fast), true);
  assert.equal(timeControlMismatch({ days: 3 }, unlimited), true);
  assert.equal(timeControlMismatch({ minutes: 90, increment: 30 }, fast), false);
  const quarter = game("a", "b", "live", { daysPerTurn: null, clock: { initial: 15, increment: 0, totalTime: 15 } });
  assert.equal(timeControlMismatch({ minutes: 0.25, increment: 0 }, quarter), false);
  assert.equal(timeControlMismatch({ minutes: 90, increment: 0 }, fast), true);
  assert.equal(timeControlMismatch({ minutes: 90, increment: 30 }, corr), true);
  assert.equal(timeControlMismatch(null, corr), false);
  assert.equal(timeControlMismatch({ days: 3 }, null), false);

  assert.equal(fmtTimeControl({ days: 1 }), "1 day per move");
  assert.equal(fmtTimeControl({ days: 3 }), "3 days per move");
  assert.equal(fmtTimeControl({ minutes: 90, increment: 30 }), "90 min + 30 s per move");
  assert.equal(fmtTimeControl({ minutes: 10, increment: 0 }), "10 min");
  assert.equal(fmtTimeControl(null), "no time limit");
});

test("challengeUrl: White challenges Black with the tournament's settings", () => {
  const slot = { white: "alice", black: "bob" };
  const parse = (url) => {
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://lichess.org/");
    assert.equal(u.hash, "#friend");
    return Object.fromEntries(u.searchParams);
  };
  // "color" is the side of whoever opens the link, White; "user" is the opponent.
  assert.deepEqual(parse(challengeUrl(slot, { rated: true, timeControl: { days: 3 } })),
    { user: "bob", color: "white", variant: "standard", gameMode: "rated", time: "correspondence", days: "3" });
  assert.deepEqual(parse(challengeUrl(slot, { rated: false, timeControl: { minutes: 90, increment: 30 } })),
    { user: "bob", color: "white", variant: "standard", gameMode: "casual", time: "realTime", minutesPerSide: "90", increment: "30" });
  assert.equal(parse(challengeUrl(slot, { rated: true, timeControl: { minutes: 0.5, increment: 0 } })).minutesPerSide, "0.5");
  // Without a time control the player picks one on Lichess.
  assert.deepEqual(parse(challengeUrl(slot, { rated: true, timeControl: null })), { user: "bob", color: "white", variant: "standard", gameMode: "rated" });
});

test("extractId and the private token check", () => {
  assert.equal(extractId("AbCd1234"), "AbCd1234");
  assert.equal(extractId(" https://lichess.org/AbCd1234WxYz?x=1 "), "AbCd1234");
  assert.equal(extractId("https://lichess.org/AbCd1234/black#12"), "AbCd1234");
  assert.equal(extractId("abc"), null);
  assert.equal(extractId("AbCd-234"), null);
  assert.equal(extractId(""), null);
  assert.ok(isPrivateId("AbCd1234WxYz"));
  assert.ok(isPrivateId("https://lichess.org/AbCd1234WxYz"));
  assert.ok(!isPrivateId("AbCd1234"));
  assert.ok(!isPrivateId("https://lichess.org/AbCd1234/black"));
});

test("fmtPts", () => {
  assert.equal(fmtPts(0), "0");
  assert.equal(fmtPts(0.5), "½");
  assert.equal(fmtPts(3), "3");
  assert.equal(fmtPts(3.5), "3½");
  assert.equal(fmtPts(1.25), "1.25");
  assert.equal(fmtPts(2.1), "2.1");
  assert.equal(fmtPts(1.999999), "2");
  assert.equal(fmtPts(1.005), "1");
});

test("plural", () => {
  assert.equal(plural(1, "move"), "1 move");
  assert.equal(plural(0, "move"), "0 moves");
  assert.equal(plural(2, "finished game"), "2 finished games");
});

test("time left to move", () => {
  const MIN = 60000, H = 60 * MIN;
  assert.equal(fmtLeft(2 * DAY_MS + 8 * H + 59 * MIN), "2 days 8 h left");
  assert.equal(fmtLeft(DAY_MS), "1 day left");
  assert.equal(fmtLeft(DAY_MS + 30 * MIN), "1 day left");
  assert.equal(fmtLeft(23 * H + 59 * MIN + 59999), "23 h 59 min left");
  assert.equal(fmtLeft(5 * H), "5 h left");
  assert.equal(fmtLeft(42 * MIN + 30000), "42 min left");
  assert.equal(fmtLeft(59999), "less than a minute left");
  assert.equal(fmtLeft(1), "less than a minute left");
  assert.equal(fmtLeft(0), "out of time");
  assert.equal(fmtLeft(-5 * H), "out of time");
});

test("deadline: last move plus days per move, only while a game is being played", () => {
  assert.equal(deadlineOf(game("a", "b", "live", { lastMoveAt: 1000, daysPerTurn: 3 })), 1000 + 3 * DAY_MS);
  assert.equal(deadlineOf(game("a", "b", "1-0")), null);
  assert.equal(deadlineOf(game("a", "b", "½-½")), null);
  assert.equal(deadlineOf(game("a", "b", "aborted")), null);
  assert.equal(deadlineOf(game("a", "b", "live", { moves: "" })), null);
});

test("parseFormat: only round-robin, which is the default", () => {
  assert.deepEqual(parseFormat(undefined), { format: "round-robin", error: "" });
  assert.deepEqual(parseFormat("round-robin"), { format: "round-robin", error: "" });
  for (const raw of ["swiss", "Round-robin", 3]) {
    const { format, error } = parseFormat(raw);
    assert.equal(format, null);
    assert.match(error, /only supports "round-robin"/);
  }
});

test("endOf: the last move, or the deadline for a correspondence game lost on time", () => {
  assert.equal(endOf(game("a", "b", "1-0", { lastMoveAt: 5000 })), 5000);
  assert.equal(endOf(game("a", "b", "0-1", { lastMoveAt: 5000 })), 5000);
  assert.equal(endOf(game("a", "b", "1-0", { lastMoveAt: 5000, status: "outoftime" })), 5000 + 3 * DAY_MS);
  assert.equal(endOf(game("a", "b", "1-0", { lastMoveAt: 5000, status: "outoftime", daysPerTurn: null, clock: { initial: 300, increment: 0 } })), 5000);
});

test("tournamentSpan: from the first game created to the last game ended", () => {
  const g1 = game("a", "b", "1-0", { createdAt: 200, lastMoveAt: 900 });
  const g2 = game("c", "d", "live", { createdAt: 100, lastMoveAt: 300 });
  const g3 = game("c", "d", "½-½", { createdAt: 100, lastMoveAt: 700 });
  const void1 = game("c", "d", "aborted", { createdAt: 50 });
  const games = new Map([g1, g2, g3, void1].map((g) => [g.id, g]));
  const span = (...ids) => tournamentSpan(ids.map((id) => ({ id })), games);
  assert.deepEqual(span(), { start: null, end: null });
  assert.deepEqual(span(null, ""), { start: null, end: null });
  assert.deepEqual(span(void1.id), { start: null, end: null });
  assert.deepEqual(span("notLoaded"), { start: null, end: null });
  assert.deepEqual(span(g1.id, g2.id), { start: 100, end: null });
  assert.deepEqual(span(g1.id, null), { start: 200, end: null });
  assert.deepEqual(span(g1.id, void1.id), { start: 200, end: null });
  assert.deepEqual(span(g1.id, g3.id), { start: 100, end: 900 });
});

test("fmtSpan: upcoming, since a date, or a range as short as it reads", () => {
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
  assert.equal(fmtSpan({ start: null, end: null }), "upcoming");
  assert.equal(fmtSpan({ start: at(2026, 10, 1), end: null }), "since October 1st, 2026");
  assert.equal(fmtSpan({ start: at(2026, 10, 1), end: at(2026, 10, 1, 23) }), "October 1st, 2026");
  assert.equal(fmtSpan({ start: at(2026, 10, 1), end: at(2026, 10, 20) }), "October 1st – 20th, 2026");
  assert.equal(fmtSpan({ start: at(2026, 10, 2), end: at(2026, 12, 23) }), "October 2nd – December 23rd, 2026");
  assert.equal(fmtSpan({ start: at(2026, 10, 11), end: at(2027, 1, 31) }), "October 11th, 2026 – January 31st, 2027");
  assert.equal(fmtSpan({ start: at(2026, 3, 12), end: at(2027, 3, 22) }), "March 12th, 2026 – March 22nd, 2027");
});

test("subtitleText", () => {
  const base = { rated: true, format: "round-robin", timeControl: { days: 3 }, span: "since October 1st, 2026" };
  assert.equal(subtitleText(base), "Rated · round-robin · 3 days per move · since October 1st, 2026");
  assert.equal(subtitleText({ ...base, rated: false, timeControl: { minutes: 15, increment: 10 } }), "Unrated · round-robin · 15 min + 10 s per move · since October 1st, 2026");
  assert.equal(subtitleText({ ...base, format: null, timeControl: null, span: null }), "Rated");
});

test("gameDates: since or a range, only the day for a game on a clock, none when void", () => {
  const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).getTime();
  const clock = { initial: 900, increment: 10 };
  assert.equal(gameDates(game("a", "b", "live", { createdAt: at(10, 1), lastMoveAt: at(10, 3) })), "since October 1st, 2026");
  assert.equal(gameDates(game("a", "b", "0-1", { createdAt: at(10, 1), lastMoveAt: at(10, 4) })), "October 1st – 4th, 2026");
  assert.equal(gameDates(game("a", "b", "1-0", { createdAt: at(10, 1), lastMoveAt: at(10, 4), status: "outoftime" })), "October 1st – 7th, 2026");
  assert.equal(gameDates(game("a", "b", "½-½", { createdAt: at(10, 1, 9), lastMoveAt: at(10, 1, 20) })), "October 1st, 2026");
  assert.equal(gameDates(game("a", "b", "live", { createdAt: at(10, 6), daysPerTurn: null, clock })), "October 6th, 2026");
  assert.equal(gameDates(game("a", "b", "1-0", { createdAt: at(10, 6, 23), lastMoveAt: at(10, 7, 1), daysPerTurn: null, clock })), "October 6th, 2026");
  assert.equal(gameDates(game("a", "b", "aborted", { createdAt: at(10, 1) })), null);
});

test("refreshSeconds: the default unless it's a number, kept between 20 s and a day", () => {
  assert.equal(refreshSeconds(undefined), 300);
  assert.equal(refreshSeconds(0), 300);
  assert.equal(refreshSeconds(120), 120);
  assert.equal(refreshSeconds(5), 20);
  assert.equal(refreshSeconds(-60), 20);
  assert.equal(refreshSeconds(1e7), 86400); // more would overflow setTimeout and fire at once
  // These used to make the page ask Lichess again straight away, without end.
  for (const bad of ["abc", "60", NaN, Infinity, null, {}, [60]]) assert.equal(refreshSeconds(bad), 300);
});
