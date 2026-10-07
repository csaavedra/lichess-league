#!/usr/bin/env python3
"""Serves the page with made-up games, to see how it looks without real ones.

    python3 demo/serve.py [--theme DIR] [port]
    python3 demo/serve.py --out DIR [--theme DIR]

Then open http://localhost:8000/demo/. Each scenario NAME.json in this folder
is a tournament file served at /demo/NAME/, with demo/mock.js as the page's
lichess.js, which makes up the games from the "demo" field of each game. The
pages use the theme in theme/, or the one in DIR with --theme.

With --out, it writes the same pages to the folder DIR instead, to put on a
static host. That copy has no theme unless --theme is given, so that a theme
kept in theme/ isn't published by mistake.
"""
import argparse, html, http.server, json, mimetypes, pathlib, urllib.parse

DEMO = pathlib.Path(__file__).resolve().parent
ROOT = DEMO.parent
# The page's own files besides tournament.html, lichess.js and the theme.
PAGE_FILES = ["lib.js"]


def scenarios():
    return sorted(DEMO.glob("*.json"))


def index():
    items = "".join(
        f'<li><a href="{p.stem}/">{p.stem}</a>: {html.escape(json.loads(p.read_text()).get("demo", ""))}</li>'
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


def site(theme):
    """Every file of the demo, as {path: bytes or the file to copy}."""
    files = {"index.html": ROOT_INDEX, "demo/index.html": index()}
    themed = sorted(f for f in theme.rglob("*") if f.is_file()
                    and not any(part.startswith(".") for part in f.relative_to(theme).parts)) if theme else []
    for p in scenarios():
        d = f"demo/{p.stem}/"
        files[d + "index.html"] = ROOT / "tournament.html"
        files[d + "tournament.json"] = p
        files[d + "lichess.js"] = DEMO / "mock.js"
        for name in PAGE_FILES:
            files[d + name] = ROOT / name
        for f in themed:
            files[d + "theme/" + f.relative_to(theme).as_posix()] = f
    return files


def read(src):
    return src if isinstance(src, bytes) else src.read_bytes()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path).lstrip("/")
        files = site(THEME)
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

if args.out:
    if args.out.exists() and (not args.out.is_dir() or any(args.out.iterdir())):
        parser.error(f"{args.out} has to be a new or empty folder")
    for path, src in site(args.theme.resolve() if args.theme else None).items():
        dest = args.out / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(read(src))
    print(f"Wrote the demo to {args.out}/")
else:
    THEME = args.theme.resolve() if args.theme else (ROOT / "theme" if (ROOT / "theme").is_dir() else None)
    print(f"Demo scenarios at http://localhost:{args.port}/demo/")
    # Local only: with no --theme, it serves theme/, which may not be meant to be public.
    http.server.ThreadingHTTPServer(("localhost", args.port), Handler).serve_forever()
