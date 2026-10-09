// Run with: node --test
// fetch is replaced by a fake that answers like Lichess. The cache of
// finished games is tested in cache.test.js.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchGame, fetchHistory } from "../lichess.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Answers every request with status and body, recording the URLs asked for.
function fakeFetch(status, body) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(body?.() ?? null, { status });
  };
  return urls;
}

// An ndjson stream like the game stream, in 7-byte chunks so lines arrive
// split. Unless it ends, it stays open after the last line, as the stream
// of a game in progress does.
const stream =
  (lines, { ends = false } = {}) =>
  () => {
    const bytes = new TextEncoder().encode(
      lines.map((l) => JSON.stringify(l) + "\n").join(""),
    );
    return new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7)
          c.enqueue(bytes.slice(i, i + 7));
        if (ends) c.close();
      },
    });
  };

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const GAME = { id: "AbCd1234", fullId: "AbCd1234", fen: START }; // the stream's first line

test("fetchHistory reads the stream up to the exported position", async () => {
  const urls = fakeFetch(
    200,
    stream([
      GAME,
      { fen: START },
      { fen: E4, lm: "e2e4" },
      { fen: E5, lm: "e7e5" },
    ]),
  );
  // The export's FEN can differ in the counters and en passant square.
  const list = await fetchHistory({
    id: "AbCd1234",
    fen: E5.replace("- 0 2", "e6 0 2"),
    lastUci: "e7e5",
  });
  assert.deepEqual(list, [
    { fen: START },
    { fen: E4, lm: "e2e4" },
    { fen: E5, lm: "e7e5" },
  ]);
  assert.deepEqual(urls, ["https://lichess.org/api/stream/game/AbCd1234"]);
});

test("fetchHistory stops at the position only when the last move matches too", async () => {
  // Nf3 Nf6 Ng1 Ng8 comes back to the starting position.
  const lines = [
    { fen: START },
    { fen: "x1 b", lm: "g1f3" },
    { fen: "x2 w", lm: "g8f6" },
    { fen: "x3 b", lm: "f3g1" },
    { fen: START, lm: "f6g8" },
  ];
  fakeFetch(200, stream([GAME, ...lines]));
  const list = await fetchHistory({
    id: "AbCd1234",
    fen: START,
    lastUci: "f6g8",
  });
  assert.equal(list.length, 5);
});

test("fetchHistory gives up when the stream ends before the position", async () => {
  fakeFetch(
    200,
    stream([GAME, { fen: START }, { fen: E4, lm: "e2e4" }], { ends: true }),
  );
  assert.equal(
    await fetchHistory({ id: "AbCd1234", fen: E5, lastUci: "e7e5" }),
    null,
  );
  fakeFetch(200, stream([GAME], { ends: true }));
  assert.equal(
    await fetchHistory({ id: "AbCd1234", fen: E5, lastUci: "e7e5" }),
    null,
  );
});

test("fetchHistory skips games with a clock", async () => {
  const urls = fakeFetch(
    200,
    stream([GAME, { fen: START }, { fen: E4, lm: "e2e4" }]),
  );
  assert.equal(
    await fetchHistory({
      id: "AbCd1234",
      fen: E4,
      lastUci: "e2e4",
      clock: { minutes: 10, increment: 5 },
    }),
    null,
  );
  assert.deepEqual(urls, []);
});

test("fetchHistory: nothing on an error, a rate error on a 429", async () => {
  const g = { id: "AbCd1234", fen: E5, lastUci: "e7e5" };
  for (const status of [404, 500]) {
    fakeFetch(status);
    assert.equal(await fetchHistory(g), null);
  }
  fakeFetch(200, () => "not json\n");
  assert.equal(await fetchHistory(g), null);
  fakeFetch(429);
  await assert.rejects(fetchHistory(g), (err) => err.rate === true);
});

test("fetchGame: the export, null when Lichess doesn't know the game, errors otherwise", async () => {
  const urls = fakeFetch(200, () =>
    JSON.stringify({ id: "AbCd1234", status: "started" }),
  );
  assert.deepEqual(await fetchGame("AbCd1234"), {
    id: "AbCd1234",
    status: "started",
  });
  assert.match(urls[0], /^https:\/\/lichess\.org\/game\/export\/AbCd1234\?/);
  fakeFetch(404);
  assert.equal(await fetchGame("AbCd1234"), null);
  fakeFetch(429);
  await assert.rejects(fetchGame("AbCd1234"), (err) => err.rate === true);
  fakeFetch(500);
  await assert.rejects(
    fetchGame("AbCd1234"),
    (err) => !err.rate && /status 500/.test(err.message),
  );
});
