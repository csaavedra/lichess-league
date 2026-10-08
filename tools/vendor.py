#!/usr/bin/env python3
"""Updates the copies in vendor/ of what the page uses from other projects.

    python3 tools/vendor.py

- vendor/chess.js: chess.js, from its npm package, checked against the
  hash the npm registry gives for it, with its license next to it.
- vendor/fonts/: the page's default fonts, Figtree and Spectral, as Google
  Fonts serves them to browsers, with fonts.css to load them and each
  font's license in its folder.
- themes/lichess/fonts/: Noto Sans for the Lichess sample theme, the same
  way.

To update, change the version below, run this, check the page and the demo,
and commit vendor/ and themes/lichess/fonts/. Google Fonts has no versions
to choose: running this again takes whatever it serves now. Don't edit
either folder by hand: this script replaces them.
"""
import base64, hashlib, io, json, pathlib, re, shutil, tarfile, urllib.request

CHESS_JS = "1.4.0"
PAGE_FONTS = "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Spectral:wght@600;700&display=swap"
LICHESS_FONTS = "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&display=swap"
# Google Fonts picks the font format from the browser; this one gets woff2.
BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"


def get(url, agent=None):
    req = urllib.request.Request(url, headers={"User-Agent": agent} if agent else {})
    with urllib.request.urlopen(req, timeout=30) as res:
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


def folder(family):
    """A family's folder, named as in the google/fonts repository."""
    return family.lower().replace(" ", "")


def fonts(out, url, what):
    css = get(url, BROWSER).decode()
    # Each rule is one font file for one alphabet ("latin", "cyrillic", ...),
    # which the browser only downloads for text that needs it.
    rules = []
    for subset, rule in re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", css, re.S):
        family = re.search(r"font-family: '([^']+)'", rule)[1]
        weight = re.search(r"font-weight: (\d+)", rule)[1]
        url = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", rule)[1]
        rules.append((subset, rule, family, weight, url))
    if not rules:
        raise SystemExit("Google Fonts sent no fonts.")
    # A variable font serves all its weights from one file.
    weights = {}
    for _, _, _, weight, url in rules:
        weights.setdefault(url, set()).add(weight)
    names, out_rules = {}, []
    for subset, rule, family, weight, url in rules:
        if url not in names:
            name = f"{folder(family)}/" + (subset if len(weights[url]) > 1 else f"{weight}-{subset}") + ".woff2"
            data = get(url)
            if not data.startswith(b"wOF2"):
                raise SystemExit(f"{url} isn't a woff2 font.")
            (out / name).parent.mkdir(parents=True, exist_ok=True)
            (out / name).write_bytes(data)
            names[url] = name
        out_rules.append(f"/* {family} {weight}, {subset} */\n" + rule.replace(url, names[url]))
    for family in sorted({r[2] for r in rules}):
        (out / folder(family) / "OFL.txt").write_bytes(
            get(f"https://raw.githubusercontent.com/google/fonts/main/ofl/{folder(family)}/OFL.txt"))
    (out / "fonts.css").write_text(
        f"/* {what}, as Google Fonts serves them. Each font's license\n"
        "   is in its folder. Made by tools/vendor.py: don't edit by hand. */\n\n"
        + "\n\n".join(out_rules) + "\n")


shutil.rmtree(VENDOR, ignore_errors=True)
VENDOR.mkdir()
chess_js(VENDOR)
(VENDOR / "fonts").mkdir()
fonts(VENDOR / "fonts", PAGE_FONTS, "The page's default fonts")
print(f"Wrote chess.js {CHESS_JS} and the fonts to {VENDOR.relative_to(ROOT)}/")

LICHESS = ROOT / "themes" / "lichess" / "fonts"
shutil.rmtree(LICHESS, ignore_errors=True)
LICHESS.mkdir()
fonts(LICHESS, LICHESS_FONTS, "The Lichess theme's fonts")
print(f"Wrote its fonts to {LICHESS.relative_to(ROOT)}/")
