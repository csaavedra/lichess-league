#!/usr/bin/env python3
"""Serves the page with made-up games, to see how it looks without real ones.

    python3 demo/serve.py [--theme DIR] [port]
    python3 demo/serve.py --out DIR [--theme DIR]

Then open http://localhost:8000/demo/. Each scenario NAME.json in this folder
is a tournament file served at /demo/NAME/, with demo/mock.js as the page's
lichess.js, which makes up the games from the "demo" field of each game. A
scenario that names a sample theme in its own "demo" field uses that one,
from themes/; the others use the theme in theme/. --theme DIR replaces both.

With --out, it writes the same pages to the folder DIR instead, to put on a
static host. That copy never takes theme/, only the scenarios' own themes or
--theme, so that a theme kept in theme/ isn't published by mistake.
"""
import argparse, html, http.server, json, mimetypes, pathlib, re, urllib.parse

DEMO = pathlib.Path(__file__).resolve().parent
ROOT = DEMO.parent
THEMES = ROOT / "themes"
# The page's own files and folders besides tournament.html, lichess.js and the theme.
PAGE_FILES = ["lib.js", "vendor"]


def scenarios():
    return sorted(DEMO.glob("*.json"))


# A scenario's own "demo" field: "about", its line on the index page, and
# optionally "theme", the name of a sample theme in themes/.
def about(p):
    return json.loads(p.read_text()).get("demo") or {}


def theme_files(theme):
    return sorted(f for f in theme.rglob("*") if f.is_file()
                  and not any(part.startswith(".") for part in f.relative_to(theme).parts))


def index():
    items = "".join(
        f'<li><a href="{p.stem}/">{p.stem}</a>: {html.escape(about(p).get("about", ""))}</li>'
        for p in scenarios())
    return f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lichess-league demo</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 16px; }}
  li {{ margin: 0.4rem 0; }}
</style>
<h1>lichess-league demo</h1>
<p>Demo tournaments that show how lichess-league looks and its
functionalities. Games are made up with random moves and not from
Lichess.</p>
<ul>{items}</ul>
<p>Add <code>?moves</code> to a tournament's address, as in
<a href="halfway/?moves">halfway/?moves</a>, and its games in progress get a
new move on every refresh.</p>
<p>The page and how to run a tournament with it:
<a href="https://github.com/csaavedra/lichess-league">lichess-league on GitHub</a>.</p>
</html>
""".encode()


ROOT_INDEX = b"""<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=demo/">
<title>lichess-league demo</title>
<a href="demo/">lichess-league demo</a>
"""


def site(theme, fallback):
    """Every file of the demo, as {path: bytes or the file to copy}. theme,
    if given, replaces each scenario's own; fallback is for those without one."""
    files = {"index.html": ROOT_INDEX, "demo/index.html": index()}
    for p in scenarios():
        d = f"demo/{p.stem}/"
        own = about(p).get("theme")
        if own and not (re.fullmatch(r"[\w-]+", own) and (THEMES / own).is_dir()):
            raise ValueError(f"{p.name} asks for the theme {own!r}, which isn't a folder in themes/")
        use = theme or (THEMES / own if own else fallback)
        files[d + "index.html"] = ROOT / "tournament.html"
        files[d + "tournament.json"] = p
        files[d + "lichess.js"] = DEMO / "mock.js"
        for name in PAGE_FILES:
            src = ROOT / name
            for f in sorted(src.rglob("*")) if src.is_dir() else [src]:
                if f.is_file():
                    files[d + f.relative_to(ROOT).as_posix()] = f
        for f in theme_files(use) if use else []:
            files[d + "theme/" + f.relative_to(use).as_posix()] = f
    return files


def read(src):
    return src if isinstance(src, bytes) else src.read_bytes()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path).lstrip("/")
        try:
            files = site(THEME, FALLBACK)
        except ValueError as err:
            return self.send_error(500, str(err))
        key = path + "index.html" if path == "" or path.endswith("/") else path
        if key not in files:
            if path + "/index.html" in files:
                self.send_response(301)
                self.send_header("Location", f"/{path}/" + (f"?{url.query}" if url.query else ""))
                self.end_headers()
                return
            return self.send_error(404)
        body = read(files[key])
        ctype = mimetypes.guess_type(key)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


parser = argparse.ArgumentParser(description="Serve the demo scenarios, or write them to a folder.")
parser.add_argument("port", nargs="?", type=int, default=8000)
parser.add_argument("--theme", type=pathlib.Path, help="theme folder to use instead of theme/")
parser.add_argument("--out", type=pathlib.Path, help="write the demo to this new or empty folder instead of serving it")
args = parser.parse_args()
if args.theme and not args.theme.is_dir():
    parser.error(f"{args.theme} is not a folder")

THEME = args.theme.resolve() if args.theme else None
FALLBACK = None if args.out or not (ROOT / "theme").is_dir() else ROOT / "theme"
try:
    files = site(THEME, FALLBACK)
except ValueError as err:
    parser.error(str(err))

if args.out:
    if args.out.exists() and (not args.out.is_dir() or any(args.out.iterdir())):
        parser.error(f"{args.out} has to be a new or empty folder")
    for path, src in files.items():
        dest = args.out / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(read(src))
    print(f"Wrote the demo to {args.out}/")
else:
    print(f"Demo scenarios at http://localhost:{args.port}/demo/")
    # Local only: with no --theme, it serves theme/, which may not be meant to be public.
    http.server.ThreadingHTTPServer(("localhost", args.port), Handler).serve_forever()
