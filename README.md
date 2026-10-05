# lichess-league

Lichess runs arenas and Swiss events, but not tournaments whose games the
players set up themselves: correspondence games, or a slow league where
opponents agree when to play each round. This page follows such a tournament
from a list of Lichess game IDs.

It's a single static page: a crosstable with tiebreaks, each round's games
with live boards, a move-by-move game view, and each player's performance.
Game data comes straight from the Lichess API, refreshed every few minutes.
There is no server, no build step and no account. For now it handles
round-robin tournaments.

There is no engine or evaluation anywhere on the page, by design: it's meant
for games still in progress.

## Running it

The page reads `tournament.json` next to it, so it has to be served over
HTTP (browsers block reading it from `file://`):

    cp tournament.example.json tournament.json
    python3 -m http.server --bind localhost 8000

Then open http://localhost:8000/tournament.html.

To publish it, copy `tournament.html` (or rename it `index.html`), `lib.js`
and `tournament.json` to any static host.

### Trying it without real games

`demo/` has made-up tournaments, to see how the page looks in situations
that are hard to set up on Lichess:

    python3 demo/serve.py

Then open http://localhost:8000/demo/ and pick one:

- `halfway`: finished, live and upcoming rounds.
- `finished`: every game played, with ties in the standings.
- `problems`: one game for each warning the page shows (reversed colours,
  wrong players, unrated game, wrong time control, unknown ID, private
  token, little time left, and more).
- `unrated`: an unrated tournament with two rated games.

Each scenario is a tournament file, `demo/NAME.json`, whose games have an
extra `demo` field describing the game to fake: its result, whether the
colours are swapped, whether it's rated, when the last move was made. The
fields are listed at the top of `demo/mock.js`. The server adds that
script to the page, and it answers the page's Lichess requests from those
fields, with random legal moves. Nothing is sent to Lichess. To try a new
situation, copy a scenario and edit it.

## The tournament file

`tournament.json` holds everything about the tournament. The page re-reads it
on every refresh, so editing it is how you update the tournament.

- `title`, `subtitle`: shown in the header.
- `players`: each player's Lichess `username`, display `name`, `seed`, and a
  `seedRating` (with `seedBasis`, the rating it came from). Seed ratings are
  used for expected score and performance.
- `rounds`: each round has a `name` and its `games`, as
  `{ "white": username, "black": username, "id": "" }`.
- `rated`: whether the games should be rated on Lichess (default `true`).
  The page flags a game that isn't set up that way.
- `timeControl`: the time control the games should have, either
  `{ "days": 3 }` (days per move) or `{ "minutes": 90, "increment": 30 }`
  (a clock, with the increment in seconds). The page flags a game with a
  different one. Without it, any time control is accepted.
- `scoring`: points for a win, draw and loss (default 1, ½, 0).
- `refreshSeconds`: how often to poll Lichess (default 300).

Once a game starts on Lichess, put its 8-character ID (or its link, like
`https://lichess.org/AbCd1234`) in `id`. The page flags a game whose players
or colours don't match the schedule, or that isn't rated or timed as
`rated` and `timeControl` say.

> **Only ever paste the first 8 characters.** A player who copies the link
> from their own game gets a 12-character URL; the last 4 characters are a
> private token that lets anyone move for them. The page warns about such
> IDs.

## Standings

Ties on points are broken, in order, by:

1. TW: wins against the other players on the same points (draws don't count)
2. Sonneborn–Berger
3. Total wins
4. Seed

Performance uses the Lichess Swiss formula: the average of each opponent's
rating, +500 for a win and −500 for a loss.

## How it talks to Lichess

- Games are fetched one at a time from `/game/export/{id}`. On a 429 the page
  backs off for two minutes.
- Lichess leaves the last few moves out of the export while a game is in
  progress, so the page reads the full move list from the game stream when a
  position changes.
- Finished games are cached in `localStorage` and never fetched again.
- [chess.js](https://github.com/jhlywa/chess.js) is loaded from jsDelivr only
  to replay moves. If it fails to load, the standings and boards still work.

## Theming

Colours, fonts and radii are CSS variables in `:root`, with a dark-mode set.
The page loads an optional `theme/theme.css` after its own styles to
override them, and has an empty `.brand` slot in the header for a logo. The
`theme/` folder is git-ignored. Without it the page uses its default look
(and logs one 404). The default fonts come from Google Fonts, which the page
only loads when no theme replaces them.

## Development

The pure logic (standings, tiebreaks, player stats, ID parsing, time
control, time left) lives in `lib.js`, with no DOM or network access. Its
tests need nothing beyond Node 22 or later (`package.json` only marks the
files as ES modules; there is nothing to install):

    node --test

## License

MIT. See [LICENSE](LICENSE).

The page loads, without bundling them:

- [chess.js](https://github.com/jhlywa/chess.js) by Jeff Hlywa, BSD-2-Clause,
  from jsDelivr.
- The cburnett pieces by Colin M.L. Burnett, GPLv2+, from Lichess.
- The Figtree and Spectral fonts, SIL Open Font License, from Google Fonts.

This project is not affiliated with Lichess. Game data comes from the
[Lichess API](https://lichess.org/api).
