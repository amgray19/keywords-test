#!/usr/bin/env python3
"""Refresh this tool's data from an upstream FedInt dashboard build.

A straight copy of keywords.json would undo three decisions at once:

  * the 46 alternatives blanked by the audit come back, including
    "disparate impact -> intentional discrimination", which inverts a legal
    standard;
  * Federal Register boilerplate leaks in, so a scan flags "comment period"
    and "data collection" as terms worth reviewing;
  * keywords.txt drifts from keywords.json, and a term present in one and not
    the other is either never looked for or found with nothing to offer.

So the refresh is a pipeline, not a copy. It takes the upstream term list,
filters it, re-applies the audit, rebuilds the curated terms tab, re-stamps the
asset URLs, and prints what changed so the diff can be read before committing.

Usage:  python3 sync-from-fedint.py [path-to-fedint/dashboard] [--dry-run]

Then:   node test.js && git add -A && git commit && git push origin main
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
DEFAULT_UPSTREAM = Path.home() / "FedInt" / "dashboard"

# Statistical n-grams that are Federal Register furniture rather than
# vocabulary anyone chooses. They arrive from the upstream engine's frequency
# pass, and flagging them in someone's document is noise that costs the tool its
# credibility. Extend this list rather than hand-editing keywords.json, so the
# exclusion survives the next refresh.
BOILERPLATE = [
    "advisory council", "comment period", "data collection", "department energy",
    "department interior", "environmental assessment", "environmental impact",
    "impact statement", "llc notice", "notice announces", "notice filing",
    "notice intent", "patent patent", "preliminary determination", "protection act",
    "sunshine act",
]


def run(script, *args):
    result = subprocess.run([sys.executable, str(HERE / script), *args],
                            capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  {script} FAILED:\n{result.stdout}{result.stderr}")
        raise SystemExit(1)
    for line in result.stdout.strip().splitlines():
        print(f"  {line}")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    upstream = Path(args[0]).expanduser() if args else DEFAULT_UPSTREAM

    source = upstream / "keywords.json"
    if not source.exists():
        print(f"No keywords.json under {upstream}.")
        print("Pass the path to FedInt's dashboard directory as an argument.")
        return 1

    before = {k["term"]: k.get("suggestions", []) for k in json.loads((HERE / "keywords.json").read_text())}
    incoming = json.loads(source.read_text())

    excluded = set(BOILERPLATE)
    kept = [k for k in incoming if k["term"] not in excluded]
    dropped = [k["term"] for k in incoming if k["term"] in excluded]

    after = {k["term"]: k.get("suggestions", []) for k in kept}
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))

    print(f"upstream: {upstream}")
    print(f"  {len(incoming)} terms in, {len(dropped)} boilerplate excluded, {len(kept)} kept")
    print(f"  {len(added)} new, {len(removed)} gone")
    if added:
        print(f"    new: {', '.join(added[:12])}{' ...' if len(added) > 12 else ''}")
    if removed:
        print(f"    gone: {', '.join(removed[:12])}{' ...' if len(removed) > 12 else ''}")

    if dry:
        print("\ndry run, nothing written")
        return 0

    (HERE / "keywords.json").write_text(json.dumps(kept, indent=2) + "\n")
    # keywords.txt is what actually gets scanned; keywords.json only supplies the
    # alternatives. They are written from one list so they cannot drift.
    (HERE / "keywords.txt").write_text(
        "\n".join(sorted((k["term"] for k in kept), key=str.lower)) + "\n")
    print(f"  wrote keywords.json and keywords.txt, {len(kept)} terms each")

    # Re-apply the ratified audit. Any alternative the upstream refresh restored
    # for a blanked term is removed again here.
    print("audit:")
    run("audit-suggestions.py")

    print("terms to use:")
    run("build-terms.py", str(upstream))

    print("asset stamps:")
    run("stamp-assets.py")

    # Record what was synced, so check-upstream.py can tell later whether the
    # upstream data has moved without depending on file timestamps.
    print("marker:")
    run("check-upstream.py", "--record")

    print("\nRefreshed. Now:")
    print("  node test.js")
    print("  git add -A && git commit -m 'Refresh keyword data from upstream'")
    print("  git push origin main")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
