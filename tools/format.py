#!/usr/bin/env python3
"""Format the page's JavaScript with Prettier, in its default style.

Runs Prettier on the .js files (vendor/ is left alone, see .prettierignore)
and on the inline script of tournament.html, which Prettier would otherwise
only touch together with the page's markup and CSS. Needs npx.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "tournament.html"
PRETTIER = ["npx", "--yes", "prettier@3"]
SCRIPT = re.compile(r'(<script type="module">\n)(.*?)(</script>)', re.S)


def main():
    check = "--check" in sys.argv[1:]
    cmd = PRETTIER + ["--check" if check else "--write", "**/*.js"]
    ok = subprocess.run(cmd, cwd=ROOT).returncode == 0

    html = PAGE.read_text()
    m = SCRIPT.search(html)
    if not m:
        sys.exit(f"{PAGE.name}: no inline module script found")
    formatted = subprocess.run(
        PRETTIER + ["--parser", "babel"], cwd=ROOT, input=m[2],
        capture_output=True, text=True, check=True,
    ).stdout
    if formatted != m[2]:
        if check:
            print(f"[warn] {PAGE.name} (inline script)")
            ok = False
        else:
            PAGE.write_text(html[: m.start(2)] + formatted + html[m.end(2):])
            print(PAGE.name)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
