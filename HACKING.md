# Hacking on lichess-league

Notes on how the page works, for changing it. For running a tournament, see
the [README](README.md).

## Layout

- `tournament.html`: the page, with its styles and one inline
  `<script type="module">`. There is no build step.
- `lib.js`: the pure logic, with no DOM or network access.
- `lichess.js`: the requests to Lichess, and the cache of finished games
  kept in `localStorage`.
- `test/`: the tests of both, with a fake `fetch` and a fake `localStorage`,
  and a check that the demo's stand-in for `lichess.js` has the same exports.
- `demo/`: made-up tournaments and a stand-in for `lichess.js`.
- `themes/`: sample themes (see [Theming](#theming)).
- `vendor/`: copies of what the page uses from other projects, made by
  `tools/vendor.py` (see [Copied files](#copied-files)).
- `screenshots/`: the README's screenshots, made by `tools/screenshots.py`
  (see [Screenshots](#screenshots)).
- `.github/workflows/pages.yml`: on every push to main, runs the tests and
  publishes the demo to https://csaavedra.github.io/lichess-league/. A main
  that fails its tests isn't published.

## Tests

The tests need nothing beyond Node 22 or later (`package.json` only marks
the files as ES modules; there is nothing to install):

    node --test

## How it talks to Lichess

- Games are fetched one at a time from `/game/export/{id}`. On a 429 the page
  backs off for two minutes. Any other error skips that game until the next
  refresh.
- Lichess leaves the last 3 moves out of the export while a game is in
  progress. For correspondence games the page reads the full move list from
  the game stream when a position changes. Games with a clock get the same
  delay on the stream, so their move list stays 3 moves behind until they
  end.
- Finished games are cached in `localStorage` and never fetched again.
- [chess.js](https://github.com/jhlywa/chess.js), copied in `vendor/`, is
  loaded only to replay moves. If it fails to load, the standings and boards
  still work.

## The demo

`demo/serve.py` serves the page as it is, with `demo/mock.js` as its
`lichess.js`. The mock has the same exports, makes up the games with random
legal moves and keeps finished games in memory only, so nothing is stored in
the browser. When `lichess.js` gets a new export, the mock needs it too;
`node --test` checks.

- Each scenario is a tournament file, `demo/NAME.json`, served at
  `/demo/NAME/`. Each game's `demo` field says what to fake: its result,
  swapped colours, whether it's rated, when the last move was made. The
  fields are listed at the top of `demo/mock.js`. To try a new situation,
  copy a scenario and edit it.
- The file's own `demo` field has `about`, its line on the demo's index page,
  and can name a sample theme in `themes/` with `theme`, as `finished` does.
  The other scenarios use `theme/` like the real page; `--theme some/folder`
  replaces the theme on all of them.
- Add `?moves` to a scenario's address, as in `/demo/halfway/?moves`, and its
  games in progress get a new move on every refresh.
- `--out DIR` writes the same pages to a folder, for a static host; the Pages
  workflow publishes that. The copy never takes `theme/`, only the scenarios'
  own themes or `--theme`, so a theme in `theme/` isn't published by mistake.
- The server and `--out` share one list of the page's files: when the page
  gets a new file or folder next to `lib.js`, add it to `PAGE_FILES` in
  `demo/serve.py`.

## Copied files

`vendor/` has copies of what the page uses from other projects, so that it
doesn't depend on other servers for them, and visitors' addresses don't reach
them. `tools/vendor.py` makes the whole folder, with each license next to its
files; don't edit `vendor/` by hand. The copies don't update themselves, so
check now and then, for example before a new tournament:

- chess.js, from its npm package, checked against the hash the npm registry
  gives for it. Its releases are at
  https://github.com/jhlywa/chess.js/releases; to update, change the version
  in `tools/vendor.py`.
- The default fonts, Figtree and Spectral, as Google Fonts serves them to
  browsers: one file per alphabet (and per weight for Spectral), with
  `fonts/fonts.css` to load them. Google Fonts has no versions to choose and
  updates its fonts now and then; running the script again takes whatever it
  serves now, and `git diff --stat` shows whether anything changed.
- Noto Sans for the Lichess sample theme, the same way, in
  `themes/lichess/fonts/`.

Then run `python3 tools/vendor.py`, check the page and the demo (the fonts,
and that games can still be stepped through), and commit `vendor/` and
`themes/lichess/fonts/`.

## Screenshots

The README shows two screenshots of the demo in the default look, 640px wide:
`standings.png`, the top of the halfway demo down to the end of the
crosstable, and `games.png`, round 1 of the problems demo with its warnings.
Retake them after a change to how either looks:

    python3 tools/screenshots.py

It needs Chrome and ImageMagick, and uses optipng if it's there. It takes
the pages from `demo/serve.py --out`, so a private `theme/` never shows,
renames the halfway demo to "Club Correspondence League", and captures each
at twice the pixel density: the standings 920px wide, the narrowest with
the title and the subtitle on one line each, and the games 680px wide, with
three cards in a row (four need 1080px, too small to read in the README). The
crops follow the page's headings, table and cards, so they keep the same
framing when the layout changes. Look at both before committing them.

## Theming

Colours, fonts and radii are CSS variables in `:root`, with a dark-mode set.
The page loads an optional `theme/theme.css` after its own styles to
override them, and has an empty `.brand` slot in the header for a logo. The
`theme/` folder is git-ignored. Without it the page uses its default look
(and logs one 404). The default fonts are copied in `vendor/fonts/`, and
browsers only download them when no theme replaces them.

`themes/` holds sample themes. Besides the variables, they show how to style
what the variables don't cover: the results in the crosstable (`.w`, `.d`,
`.l`), the move buttons (faded ones have `aria-disabled="true"`) and
scrollbars.
