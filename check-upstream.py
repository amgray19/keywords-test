#!/usr/bin/env python3
"""Say whether the upstream term data has moved since the last sync.

Silent when nothing changed, which is most days. A reminder that fires on a
schedule regardless of whether there is anything to do gets ignored within a
week, so this one only speaks when the upstream file actually differs from what
was last synced.

The marker is a hash of the upstream keywords.json recorded at sync time and
committed, so the answer survives a new machine and does not depend on file
timestamps, which a git checkout rewrites anyway.

Usage:
  python3 check-upstream.py                  print status, exit 1 if drifted
  python3 check-upstream.py --notify         macOS notification if drifted
  python3 check-upstream.py --reminder       add a line to FedInt reminders.md
  python3 check-upstream.py --record         mark current upstream as synced
"""
import hashlib
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


def record(digest, terms):
    MARKER.write_text(json.dumps(
        {"upstream_sha256": digest, "term_count": len(terms), "synced": str(date.today())},
        indent=2) + "\n")


def main() -> int:
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
