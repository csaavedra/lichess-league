#!/usr/bin/env python3
"""Serves the page with made-up games, to see how it looks without real ones.

    python3 demo/serve.py [port]

Then open http://localhost:8000/demo/. Each scenario NAME.json in this folder
is a tournament file served at /demo/NAME/, where demo/mock.js answers the
page's Lichess requests from the "demo" field of each game.
"""
import http.server, pathlib, re, sys

DEMO = pathlib.Path(__file__).resolve().parent
ROOT = DEMO.parent
PAGE = re.compile(r"^/demo/([\w-]+)/(.*)$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/demo", "/demo/"):
            return self.index()
        if path == "/demo/mock.js":
            return self.reply((DEMO / "mock.js").read_bytes(), "text/javascript")
        m = PAGE.match(path)
        if not m or not (DEMO / f"{m[1]}.json").is_file():
            return super().do_GET()
        name, rest = m[1], m[2]
        if rest in ("", "index.html"):
            html = (ROOT / "tournament.html").read_text()
            html = html.replace("<head>", '<head>\n<script src="/demo/mock.js"></script>', 1)
            return self.reply(html.encode(), "text/html; charset=utf-8")
        if rest == "tournament.json":
            return self.reply((DEMO / f"{name}.json").read_bytes(), "application/json")
        # lib.js, theme/ and anything else the page loads come from the repository.
        self.path = "/" + rest
        return super().do_GET()

    def index(self):
        links = "".join(f'<li><a href="/demo/{p.stem}/">{p.stem}</a></li>'
                        for p in sorted(DEMO.glob("*.json")))
        self.reply(f"<!doctype html><meta charset=utf-8><title>Demo scenarios</title>"
                   f"<h1>Demo scenarios</h1><ul>{links}</ul>".encode(), "text/html; charset=utf-8")


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"Demo scenarios at http://localhost:{port}/demo/")
# Local only: the server hands out the whole checkout, theme/ and tournament.json included.
http.server.ThreadingHTTPServer(("localhost", port), Handler).serve_forever()
