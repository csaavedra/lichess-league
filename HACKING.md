# Hacking on lichess-league

Notes on how the page works, for changing it. For running a tournament, see
the [README](README.md).

## Layout

- `tournament.html`: the page, with its styles and one inline
  `<script type="module">`. There is no build step.
- `lib.js`: the pure logic (reading tournament.json, standings, tiebreaks,
  player stats, ID parsing, time control, time left, the subtitle), with no
  DOM or network access.
- `lib.test.js`: its tests.
- `lichess.js`: the requests to Lichess and the cache of finished games.
- `demo/`: made-up tournaments and a mock of the Lichess API.

## Tests

The tests need nothing beyond Node 22 or later (`package.json` only marks
the files as ES modules; there is nothing to install):

    node --test

## How it talks to Lichess

The requests and the cache are in `lichess.js`.

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
fields are listed at the top of `demo/mock.js`. `demo/serve.py` adds that
script to the page, and it answers the page's Lichess requests from those
fields, with random legal moves. To try a new situation, copy a scenario and
edit it.

The demo pages use `theme/` like the real page. To try another theme without
touching it, pass its folder: `python3 demo/serve.py --theme some/folder`.

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
