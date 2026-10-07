// Run with: node --test
// The cache of finished games in lichess.js. It reads localStorage when the
// module loads, so each test puts a fake one in place and loads a fresh copy
// of the module.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../lib.js";

afterEach(() => { delete globalThis.localStorage; });

// A localStorage that keeps its items in a Map. Pass a function as
// getItem or setItem to replace that method, e.g. to make it throw.
function fakeStorage(overrides = {}) {
  const items = new Map();
  return {
    items,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => { items.set(k, String(v)); },
    removeItem: (k) => { items.delete(k); },
    ...overrides,
  };
}

let loads = 0;
async function load(storage) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: storage });
  return import(`../lichess.js?load=${++loads}`);
}
const loadWith = (storage) => load(() => storage);

// An export as Lichess sends it, with fields the page doesn't use.
const exported = (fields = {}) => ({
  id: "AbCd1234", rated: true, variant: "standard", speed: "correspondence", perf: "correspondence",
  createdAt: 1759300000000, lastMoveAt: 1759900000000, status: "mate", source: "friend",
  players: {
    white: { user: { name: "Alice", id: "alice" }, rating: 1850, ratingDiff: 7 },
    black: { user: { name: "Bob", id: "bob" }, rating: 1790, ratingDiff: -7, provisional: true },
  },
  winner: "white", opening: { eco: "C20", name: "King's Pawn Game", ply: 2 },
  moves: "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#",
  lastFen: "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4",
  lastMove: "h5f7", daysPerTurn: 3,
  ...fields,
});

test("keeps finished games and not games in progress", async () => {
  const { finishedGame, cacheFinished } = await loadWith(fakeStorage());
  cacheFinished(exported({ id: "Created1", status: "created", winner: undefined }));
  cacheFinished(exported({ id: "Started1", status: "started", winner: undefined }));
  cacheFinished(exported({ id: "Finish01" }));
  cacheFinished(exported({ id: "Aborted1", status: "aborted", winner: undefined }));
  assert.equal(finishedGame("Created1"), undefined);
  assert.equal(finishedGame("Started1"), undefined);
  assert.ok(finishedGame("Finish01"));
  assert.ok(finishedGame("Aborted1"));
});

test("a cached game reads like its export, also after a reload", async () => {
  const storage = fakeStorage();
  const first = await loadWith(storage);
  const games = [
    exported(),
    exported({ id: "Clock123", daysPerTurn: undefined, clock: { initial: 5400, increment: 30, totalTime: 6600 }, status: "draw", winner: undefined }),
  ];
  for (const g of games) first.cacheFinished(g);
  const again = await loadWith(storage);
  for (const g of games) {
    assert.deepEqual(summarize(first.finishedGame(g.id)), summarize(g));
    assert.deepEqual(summarize(again.finishedGame(g.id)), summarize(g));
  }
});

test("starts empty when the stored games can't be read", async () => {
  const storage = fakeStorage();
  storage.setItem("tournament:finished-games:v3", "{not json");
  const { finishedGame, cacheFinished } = await loadWith(storage);
  assert.equal(finishedGame("AbCd1234"), undefined);
  cacheFinished(exported());
  assert.ok(finishedGame("AbCd1234"));
});

test("keeps games in memory when storage is full or blocked", async () => {
  const full = await loadWith(fakeStorage({ setItem: () => { throw new Error("QuotaExceededError"); } }));
  full.cacheFinished(exported());
  assert.ok(full.finishedGame("AbCd1234"));

  const blocked = await load(() => { throw new Error("SecurityError"); });
  blocked.cacheFinished(exported());
  assert.ok(blocked.finishedGame("AbCd1234"));
});
