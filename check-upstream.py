#!/usr/bin/env python3
"""Say whether the upstream term data has moved since the last sync.

Silent when nothing changed, which is most days. A reminder that fires on a
schedule regardless of whether there is anything to do gets ignored within a
week, so this one only speaks when the upstream file actually differs from what
was last synced.

The marker is a hash of the upstream keywords.json recorded at sync time and
committed, so the answer survives a new machine and does not depend on file
timestamps, which a git checkout rewrites anyway.

"Differs" means the refresh would actually change the shipped data, not merely
that the upstream file's bytes moved. Most upstream edits do not survive the
pipeline's boilerplate filter and audit re-blanking, and reporting those as work
is how a reminder becomes wallpaper.

Usage:
  python3 check-upstream.py                  print status, exit 1 if drifted
  python3 check-upstream.py --self-test      check the drift model both ways
  python3 check-upstream.py --notify         macOS notification if drifted
  python3 check-upstream.py --reminder       add a line to FedInt reminders.md
  python3 check-upstream.py --record         mark current upstream as synced
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent
MARKER = HERE / ".upstream-sync.json"
UPSTREAM = Path.home() / "FedInt" / "dashboard" / "keywords.json"
REMINDERS = Path.home() / "FedInt" / ".claude" / "reminders.md"
TOOL_URL = "https://amgray19.github.io/keywords-test/"


def upstream_state():
    raw = UPSTREAM.read_bytes()
    terms = {k["term"] for k in json.loads(raw)}
    return hashlib.sha256(raw).hexdigest()[:12], terms


def suggestions_map(path):
    return {k["term"]: k.get("suggestions", []) for k in json.loads(Path(path).read_text())}


def would_change_anything(upstream_json):
    """True if running sync-from-fedint.py would alter the shipped data.

    The marker hashes the upstream FILE, so any upstream edit trips it — but
    most upstream edits do not survive the refresh pipeline, which drops
    boilerplate and re-blanks the audited alternatives. FedInt restoring
    suggestions for the 46 blanked terms is the normal case and produces a
    byte-identical result here, so reporting it as work to do trains the
    reminder into noise, which this tool's whole design is trying to avoid.

    Both filters are read from where the pipeline itself defines them rather
    than restated: BOILERPLATE from the sync script, the blank list from
    blanked-terms.json, which audit-suggestions.py writes from its own DROP.
    """
    spec = importlib.util.spec_from_file_location("sync", HERE / "sync-from-fedint.py")
    sync = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sync)
    boilerplate = set(sync.BOILERPLATE)
    blanked = set(json.loads((HERE / "blanked-terms.json").read_text()))

    expected = {
        k["term"]: ([] if k["term"] in blanked else k.get("suggestions", []))
        for k in upstream_json if k["term"] not in boilerplate
    }
    return expected != suggestions_map(HERE / "keywords.json")


def record(digest, terms):
    MARKER.write_text(json.dumps(
        {"upstream_sha256": digest, "term_count": len(terms), "synced": str(date.today())},
        indent=2) + "\n")


def self_test() -> int:
    """Both directions of would_change_anything, against the real committed data.

    The dangerous failure is the False side: a filter model that is too eager
    reports "nothing to sync" for a real upstream change and the tool silently
    stops tracking upstream at all.
    """
    upstream = json.loads(UPSTREAM.read_bytes())
    assert not would_change_anything(upstream), \
        "live upstream should filter down to exactly the committed data"

    blanked = set(json.loads((HERE / "blanked-terms.json").read_text()))
    restored = [dict(k, suggestions=["something"]) if k["term"] in blanked else k
                for k in upstream]
    assert not would_change_anything(restored), \
        "upstream restoring a blanked term's alternatives is a no-op downstream"

    assert would_change_anything(upstream + [{"term": "brand new term", "suggestions": []}]), \
        "a genuinely new upstream term must still be reported"

    without = [k for k in upstream if k["term"] != upstream[0]["term"]]
    assert would_change_anything(without), "an upstream term going away must still be reported"

    live = next(k for k in upstream if k["term"] not in blanked and k.get("suggestions"))
    changed = [dict(k, suggestions=k["suggestions"] + ["new alt"]) if k is live else k
               for k in upstream]
    assert would_change_anything(changed), \
        "a changed alternative on a NON-blanked term must still be reported"

    print("self-test ok")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    if not UPSTREAM.exists():
        # Not an error worth shouting about: the NAS share may simply be
        # unmounted. Say so and exit clean so a scheduled run does not nag.
        print(f"upstream not reachable at {UPSTREAM}")
        return 0

    digest, terms = upstream_state()

    if "--record" in sys.argv:
        record(digest, terms)
        print(f"recorded upstream {digest}, {len(terms)} terms")
        return 0

    if not MARKER.exists():
        print("no sync marker yet, run: python3 sync-from-fedint.py")
        return 1

    last = json.loads(MARKER.read_text())
    if last.get("upstream_sha256") == digest:
        print(f"up to date, upstream unchanged since {last.get('synced')} ({digest})")
        return 0

    if not would_change_anything(json.loads(UPSTREAM.read_bytes())):
        print(f"upstream moved ({digest}) but the filtered result is identical, nothing to sync")
        return 0

    mine = {k["term"] for k in json.loads((HERE / "keywords.json").read_text())}
    added, gone = sorted(terms - mine), sorted(mine - terms)
    summary = (f"upstream changed since {last.get('synced')}: "
               f"{len(added)} new, {len(gone)} gone")
    print(summary)
    if added:
        print(f"  new: {', '.join(added[:10])}{' ...' if len(added) > 10 else ''}")
    if gone:
        print(f"  gone: {', '.join(gone[:10])}{' ...' if len(gone) > 10 else ''}")
    print("  refresh with: python3 sync-from-fedint.py")

    if "--notify" in sys.argv:
        subprocess.run(["osascript", "-e",
                        f'display notification "{summary}. Run sync-from-fedint.py" '
                        f'with title "keyword/scan" subtitle "Term data is stale"'],
                       capture_output=True)

    if "--reminder" in sys.argv and REMINDERS.exists():
        text = REMINDERS.read_text()
        stamp = f"_from check-upstream {date.today()}_"
        # One line per day at most. A reminder file that accumulates the same
        # item every run stops being read.
        if stamp not in text:
            REMINDERS.write_text(
                text.rstrip("\n") +
                f"\n\n- [ ] keyword/scan term data is stale: {summary}. "
                f"Run `python3 ~/keywords-test/sync-from-fedint.py`, then test, commit, push. "
                f"Live at {TOOL_URL} {stamp}\n")
            print(f"  added a reminder to {REMINDERS}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
