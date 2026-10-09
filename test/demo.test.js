// Run with: node --test
// The demo serves demo/mock.js as the page's lichess.js, next to lib.js. If
// it's missing a name the page imports, the demo page doesn't load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("the demo's lichess.js exports the same names as the real one", async () => {
  // Load it from a folder laid out as the demo serves it.
  const dir = mkdtempSync(join(tmpdir(), "lichess-league-demo-"));
  try {
    copyFileSync(new URL("../lib.js", import.meta.url), join(dir, "lib.js"));
    copyFileSync(
      new URL("../demo/mock.js", import.meta.url),
      join(dir, "lichess.js"),
    );
    writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
    const fake = await import(pathToFileURL(join(dir, "lichess.js")));
    const real = await import("../lichess.js");
    assert.deepEqual(Object.keys(fake).sort(), Object.keys(real).sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
