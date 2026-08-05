#!/usr/bin/env python3
"""Build terms-to-use.json from FedInt's curated favored-vocabulary artifacts.

The Terms to Use tab needs three things per term: the term, a plain-English
reason it matters, and a sense of how established it already is. The first two
come from FedInt's curated favored list; the third from the mention counts in
its harvest history.

The citation quotes in favored.json are deliberately NOT copied. They are the
evidence layer FedInt sells; this tool ships the conclusion, not the proof.

Usage:  python3 build-terms.py [path-to-fedint-dashboard]
"""
import json
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "../FedInt/dashboard").expanduser()
OUT = Path(__file__).parent / "terms-to-use.json"


def main() -> int:
    favored_path, history_path = SRC / "favored.json", SRC / "history.json"
    if not favored_path.exists():
        print(f"No favored.json under {SRC}. Pass the dashboard path as an argument.")
        return 1

    favored = json.loads(favored_path.read_text())

    # Latest snapshot only. Counts across snapshots are not comparable: the
    # corpus grew roughly twentyfold at the 2026-07-14 harvest, so a rise in raw
    # count over time measures how much text was harvested, not how much the
    # government's language moved. One snapshot is a fair cross-sectional
    # ranking; a time series of these numbers would not be.
    counts = {}
    if history_path.exists():
        history = json.loads(history_path.read_text())
        if history:
            counts = history[-1].get("counts", {})

    # favored.json holds two different things. About half its entries are
    # curated: a named theme and a specific reason the term matters. The rest
    # are stubs carrying the placeholder rationale below and no theme, and that
    # set is the EO 14168 sex/gender vocabulary plus merit-ideology words. They
    # have no business in a tab that tells a proposal writer what to write, and
    # ranking by mention count floats them straight to the top, so they are
    # dropped here rather than filtered in the browser.
    STUB_WHY = "Mandated/preferred by primary source."

    terms, dropped = [], []
    for f in favored:
        term = f.get("term", "").strip()
        if not term:
            continue
        if f.get("why", "").strip() == STUB_WHY or not f.get("cluster", "").strip():
            dropped.append(term)
            continue
        terms.append({
            "term": term,
            "why": f.get("why", ""),
            "cluster": f.get("cluster", ""),
            "agencies": f.get("agencies", []),
            # None, not 0: "not tracked" and "tracked and never appeared" are
            # different claims, and the tab says so rather than printing a zero.
            "mentions": counts.get(term),
        })

    terms.sort(key=lambda t: (t["cluster"].lower(), t["term"].lower()))
    OUT.write_text(json.dumps(terms, indent=2) + "\n")

    tracked = sum(1 for t in terms if t["mentions"] is not None)
    print(f"{OUT.name}: {len(terms)} terms, {tracked} with mention counts")
    print(f"dropped {len(dropped)} uncurated stubs: {', '.join(sorted(dropped))}")

    assert terms, "favored list produced no terms"
    assert all(t["term"] and t["cluster"] for t in terms), "every shipped term needs a theme"
    assert all("evidence" not in t for t in terms), \
        "evidence must never be copied into the public tool"
    assert not any(t["why"].strip() == STUB_WHY for t in terms), "a stub survived the filter"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
