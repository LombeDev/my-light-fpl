#!/usr/bin/env python3
"""Checks the site's pages for the mistakes that cause most failures.

Usage:
    python analysis/check_pages.py public

For each JavaScript file it reports:
  - syntax errors, such as a file cut off mid-statement (needs Node.js installed)
  - element IDs the script looks up that the HTML page does not contain

Needs Python 3.9 or newer. Uses only the standard library.
"""
import pathlib
import re
import shutil
import subprocess
import sys

LOOKUP_PATTERNS = [
    r'\$\(\s*"([^"]+)"\s*\)',              # $("id")
    r'getElementById\(\s*"([^"]+)"\s*\)',  # document.getElementById("id")
]
# IDs a script creates itself, so they are not expected in the HTML.
CREATED_PATTERNS = [
    r'\.id\s*=\s*"([^"]+)"',               # el.id = "id"
    r'\bid="([^"]+)"',                     # id="..." inside template strings
]


def check_syntax(path, node):
    result = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    if result.returncode != 0:
        first = (result.stderr.strip().splitlines() or ["syntax error"])[0]
        return first
    return None


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    if not root.is_dir():
        print(f"Folder not found: {root}")
        sys.exit(1)

    pages = {p.name: p.read_text(encoding="utf-8") for p in root.glob("*.html")}
    page_ids = {name: set(re.findall(r'\sid="([^"]+)"', html)) for name, html in pages.items()}
    node = shutil.which("node")
    problems = 0

    if not node:
        print("Node.js not found, so syntax checks are skipped. Install it from nodejs.org to enable them.\n")

    for js in sorted(root.glob("*.js")):
        code = js.read_text(encoding="utf-8")

        if node:
            error = check_syntax(js, node)
            if error:
                problems += 1
                print(f"[syntax] {js.name}: {error}")

        looked_up = set()
        for pattern in LOOKUP_PATTERNS:
            looked_up |= set(re.findall(pattern, code))
        created = set()
        for pattern in CREATED_PATTERNS:
            created |= set(re.findall(pattern, code))
        expected = looked_up - created

        pages_using = [name for name, html in pages.items() if f'src="/{js.name}"' in html]
        if not pages_using:
            continue  # shared scripts such as app.js are checked through the pages that use them

        for name in pages_using:
            missing = sorted(expected - page_ids[name])
            if missing:
                problems += 1
                print(f"[missing ids] {js.name} expects on {name}: {', '.join(missing)}")

    if problems == 0:
        print("No problems found.")
    else:
        print(f"\n{problems} problem(s) found. Send this output to the assistant.")


if __name__ == "__main__":
    main()
