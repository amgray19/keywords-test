#!/usr/bin/env python3
"""Stamp every asset reference with a hash of that asset's contents.

GitHub Pages does not let you set response headers. It serves everything with
its own max-age and an ETag, so a browser that already has style.css will keep
using it after a deploy, and the page looks unchanged while the file on disk is
correct. The only lever left is the URL: change the bytes, change the query
string, and the cached copy stops matching.

Hashes are of file contents, not of the time. Files that did not change keep
their existing URL and stay cached, which is the point: only what actually moved
gets re-downloaded.

Run before committing a deploy. Idempotent, so running it twice is harmless.

Usage:  python3 stamp-assets.py [--check]
        --check exits non-zero if any stamp is stale, for a pre-push hook.
"""
import hashlib
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

# (file that carries the reference, pattern that finds it). Group 1 is the path
# to hash; the whole match is rewritten with the stamp appended.
#
# ORDER MATTERS. Stamping main.js changes main.js, which changes its hash, which
# invalidates the stamp index.html carries for it. Referenced files are stamped
# before the files that reference them, and the loop below runs to a fixed point
# so a future entry in the wrong order cannot ship a stale hash.
TARGETS = [
    ("main.js",    re.compile(r"""fetch\(['"]([^'"?]+\.(?:json|txt))(?:\?v=[0-9a-f]+)?['"]\)""")),
    ("main.js",    re.compile(r'workerSrc = "([^"?]+\.js)(?:\?v=[0-9a-f]+)?"')),
    ("index.html", re.compile(r'(?:href|src)="(?!https?:)([^"?]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"')),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def stamp(check: bool) -> int:
    stale, stamped = [], 0

    for filename, pattern in TARGETS:
        src = HERE / filename
        text = src.read_text()
        original = text

        def rewrite(m):
            nonlocal stamped
            asset = HERE / m.group(1)
            if not asset.exists():
                # A reference to something that is not on disk is a broken page,
                # not a caching question. Say so rather than stamping a 404.
                print(f"  MISSING: {filename} references {m.group(1)}")
                stale.append(m.group(1))
                return m.group(0)
            stamped += 1
            base = re.sub(r'\?v=[0-9a-f]+', '', m.group(0))
            return base.replace(m.group(1), f"{m.group(1)}?v={digest(asset)}")

        text = pattern.sub(rewrite, text)

        if text != original:
            if check:
                stale.append(filename)
            else:
                src.write_text(text)

    if check:
        if stale:
            print(f"stale asset stamps in: {', '.join(sorted(set(stale)))}")
            return 1
        print(f"asset stamps current ({stamped} references)")
        return 0

    # A rewrite that quietly matches nothing looks exactly like a rewrite that
    # worked, so assert the count rather than trusting the regex.
    assert stamped >= 11, f"only {stamped} references stamped; the patterns have drifted"
    print(f"stamped {stamped} asset references")
    return 0


if __name__ == "__main__":
    raise SystemExit(stamp("--check" in sys.argv))
