#!/usr/bin/env python3
"""Updates the copies in vendor/ of what the page uses from other projects.

    python3 tools/vendor.py

- vendor/chess.js: chess.js, from its npm package, checked against the
  hash the npm registry gives for it, with its license next to it.

To update, change the version below, run this, check the page and the demo,
and commit vendor/. Don't edit vendor/ by hand: this script replaces it.
"""
import base64, hashlib, io, json, pathlib, shutil, tarfile, urllib.request

CHESS_JS = "1.4.0"

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"


def get(url):
    with urllib.request.urlopen(url, timeout=30) as res:
        return res.read()


def chess_js(out):
    meta = json.loads(get(f"https://registry.npmjs.org/chess.js/{CHESS_JS}"))
    tarball = get(meta["dist"]["tarball"])
    algo, digest = meta["dist"]["integrity"].split("-", 1)
    if algo != "sha512" or hashlib.sha512(tarball).digest() != base64.b64decode(digest):
        raise SystemExit("The chess.js package doesn't match the npm registry's hash.")
    with tarfile.open(fileobj=io.BytesIO(tarball)) as tar:
        for name, dest in [("package/dist/esm/chess.js", "chess.js"), ("package/LICENSE", "chess.js.LICENSE")]:
            (out / dest).write_bytes(tar.extractfile(name).read())


shutil.rmtree(VENDOR, ignore_errors=True)
VENDOR.mkdir()
chess_js(VENDOR)
print(f"Wrote chess.js {CHESS_JS} to {VENDOR.relative_to(ROOT)}/")
