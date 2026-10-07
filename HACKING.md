# Hacking on lichess-league

Notes on how the page works, for changing it. For running a tournament, see
the [README](README.md).

## Layout

- `tournament.html`: the page, with its styles and one inline
  `<script type="module">`. There is no build step.
- `lib.js`: the pure logic (reading tournament.json, standings, tiebreaks,
  player stats, ID parsing, time control, time left, the subtitle, which
  pieces moved between two positions, the cache of finished games), with no
  DOM or network access.
- `lichess.js`: the requests to Lichess, and the cache of finished games
  kept in `localStorage`.
- `test/`: the tests of `lib.js` and `lichess.js`, the latter with a fake
  `fetch` and a fake `localStorage`, and a check that the demo's stand-in
  for `lichess.js` has the same exports.
- `demo/`: made-up tournaments and a stand-in for `lichess.js`.

## Tests

The tests need nothing beyond Node 22 or later (`package.json` only marks
the files as ES modules; there is nothing to install):

    node --test

## How it talks to Lichess

The requests are in `lichess.js`, which also sets up the cache.

- Games are fetched one at a time from `/game/export/{id}`. On a 429 the page
  backs off for two minutes.
- Lichess leaves the last few moves out of the export while a game is in
  progress, so the page reads the full move list from the game stream when a
  position changes.
- Finished games are cached in `localStorage` and never fetched again.
- [chess.js](https://github.com/jhlywa/chess.js) is loaded from jsDelivr only
  to replay moves. If it fails to load, the standings and boards still work.

## The demo

Each scenario is a tournament file, `demo/NAME.json`, whose games have an
extra `demo` field describing the game to fake: its result, whether the
colours are swapped, whether it's rated, when the last move was made. The
fields are listed at the top of `demo/mock.js`. `demo/serve.py` serves the
page as it is, but with that file as its `lichess.js`: it has the same
exports, makes up the games from those fields with random legal moves, and
keeps finished games in memory only, so nothing is stored in the browser.
When `lichess.js` gets a new export, the mock needs it too; `node --test`
checks. To try a new situation, copy a scenario and edit it. Add `?moves` to
a scenario's address, as in `/demo/halfway/?moves`, and its games in
progress get a new move on every refresh. A scenario's own `demo` field, at
the top of the file, has `about`, the line that describes it on the demo's
index page, and can name a sample theme in `themes/` for it with `theme`, as
`finished` does with `"theme": "lichess"`.

The other demo pages use `theme/` like the real page. To try another theme on
all of them without touching it, pass its folder:
`python3 demo/serve.py --theme some/folder`.

`python3 demo/serve.py --out DIR` writes the same pages to a folder instead,
for a static host. That copy never takes `theme/`, only the scenarios' own
themes or `--theme`, so a theme in `theme/` isn't published by mistake. The
server and `--out` share one list of files: when the page gets a new file next
to `lib.js`, add it to `PAGE_FILES` in `demo/serve.py`.

## Theming

Colours, fonts and radii are CSS variables in `:root`, with a dark-mode set.
The page loads an optional `theme/theme.css` after its own styles to
override them, and has an empty `.brand` slot in the header for a logo. The
`theme/` folder is git-ignored. Without it the page uses its default look
(and logs one 404). The default fonts come from Google Fonts, which the page
only loads when no theme replaces them.

`themes/` holds sample themes. Besides the variables, they show how to style
what the variables don't cover: the results in the crosstable (`.w`, `.d`,
`.l`), the move buttons (faded ones have `aria-disabled="true"`) and
scrollbars.
