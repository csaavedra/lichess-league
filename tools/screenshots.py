#!/usr/bin/env python3
"""Retakes the README's screenshots from the demo.

    python3 tools/screenshots.py

- screenshots/standings.png: the top of the halfway demo, title to the end
  of the crosstable, 920px wide. The demo's title becomes "Club
  Correspondence League" so it doesn't read "Demo: halfway".
- screenshots/games.png: round 1 of the problems demo, from the Games
  heading to the end of the first row of cards, 680px wide, for the
  warnings under each board.

Both are taken at twice the pixel density and shown 640px wide in the
README. The standings are the narrowest at which the title and the subtitle
each fit on one line. The games are narrower, with three cards in a row:
four need 1080px, and their warnings would be too small to read at 640px.

It needs google-chrome (or CHROME pointing to another Chrome) and
ImageMagick, and uses optipng if it's there. The pages come from
demo/serve.py --out, which never takes theme/, so the screenshots always show
the default look. The crops come from where the page puts the headings, the
table and the cards, so they follow changes to the layout. Check the images
before committing them.
"""
import json, os, pathlib, shutil, subprocess, sys, tempfile, threading
import functools, http.server

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"
CHROME = os.environ.get("CHROME", "google-chrome")
SCALE = 2
TITLE = "Club Correspondence League"
STANDINGS_WIDTH = 920
GAMES_WIDTH = 680

# Where things are on the page once the games have loaded, in CSS pixels
# from the top of the page.
MEASURE = """
setTimeout(() => {
  const at = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.top + scrollY, r.bottom + scrollY]; };
  const p = document.createElement("pre"); p.id = "measured";
  p.textContent = JSON.stringify({ cross: at("table.cross"), gamesH: at("#games-h"), card: at("#games .game") });
  document.body.append(p);
}, 4000);
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def chrome(*args):
    return subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                           "--virtual-time-budget=8000", *args],
                          capture_output=True, text=True, check=True).stdout


def measure(url, width):
    dom = chrome(f"--window-size={width},3000", "--dump-dom", url.replace("/index.html", "/measure.html"))
    return json.loads(dom.split('<pre id="measured">', 1)[1].split("</pre>", 1)[0])


def shoot(url, width, top, bottom, dest, tmp):
    full = tmp / f"{dest.stem}-full.png"
    chrome(f"--force-device-scale-factor={SCALE}", f"--window-size={width},{bottom + 100}",
           f"--screenshot={full}", url)
    convert = shutil.which("magick") or shutil.which("convert")
    subprocess.run([convert, full, "-crop", f"{width * SCALE}x{(bottom - top) * SCALE}+0+{top * SCALE}",
                    "+repage", dest], check=True)
    if shutil.which("optipng"):
        subprocess.run(["optipng", "-quiet", "-o5", dest], check=True)
    print(f"{dest.relative_to(ROOT)}: {width * SCALE}x{(bottom - top) * SCALE}")


def main():
    if not shutil.which(CHROME) or not (shutil.which("magick") or shutil.which("convert")):
        sys.exit("Needs google-chrome (or CHROME) and ImageMagick.")
    with tempfile.TemporaryDirectory() as t:
        tmp = pathlib.Path(t)
        site = tmp / "site"
        subprocess.run([sys.executable, ROOT / "demo/serve.py", "--out", site], check=True, capture_output=True)
        config = site / "demo/halfway/tournament.json"
        data = json.loads(config.read_text())
        data["title"] = TITLE
        config.write_text(json.dumps(data))
        for name in ("halfway", "problems"):
            page = site / "demo" / name
            (page / "measure.js").write_text(MEASURE)
            (page / "measure.html").write_text((page / "index.html").read_text()
                                               .replace("</body>", '<script src="measure.js"></script></body>'))

        handler = functools.partial(Quiet, directory=site)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}/demo"
        try:
            OUT.mkdir(exist_ok=True)
            url = f"{base}/halfway/index.html"
            m = measure(url, STANDINGS_WIDTH)
            # From the top of the page to just below the table, before its legend.
            shoot(url, STANDINGS_WIDTH, 0, round(m["cross"][1]) + 8, OUT / "standings.png", tmp)
            url = f"{base}/problems/index.html"
            m = measure(url, GAMES_WIDTH)
            # From a little above the Games heading to just below the first row of cards.
            shoot(url, GAMES_WIDTH, round(m["gamesH"][0]) - 14, round(m["card"][1]) + 10, OUT / "games.png", tmp)
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
