#!/usr/bin/env python3
"""Audit the alternatives in keywords.json and blank the ones that shouldn't ship.

A suggested alternative is only useful if a writer can accept it without
changing what they meant. Three kinds fail that test and are removed here:

  wrong     The replacement means something different in law or in fact.
            "disparate impact -> intentional discrimination" swaps a legal
            standard for its opposite; "racism -> ethnic prejudice" redefines
            the term rather than rephrasing it.

  erasure   The concept is replaced by a euphemism with nothing behind it.
            "racial justice -> fair treatment" is not a wording choice.

  uncited   The swap is real federal policy, and FedInt ships it WITH the
            executive order or OMB section that demands it. This tool carries
            no citations, so the same line reads as the tool's own editorial
            advice rather than as a report of what an agency requires. These
            belong behind the evidence layer, not in a free scanner.

What survives is plain-language rephrasing that preserves meaning, plus the
handful of terminology updates that are professionally uncontroversial
("life sciences -> biological sciences" is a stated OMB preference and costs a
writer nothing).

Writes suggestions-audit.md alongside the patched keywords.json so every
decision is reviewable and reversible.

Usage:  python3 audit-suggestions.py [--dry-run]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
KEYWORDS = HERE / "keywords.json"
REPORT = HERE / "suggestions-audit.md"

# term -> (category, why). Everything not listed keeps its alternatives.
DROP = {
    # --- wrong: the replacement changes the legal or factual meaning ---------
        "disparate impact": ("wrong", "Disparate impact is liability WITHOUT intent. Offering "                                   "'intentional discrimination' as a substitute inverts the standard.", ["intentional discrimination", "equal protection"]),
        "disparate-impact liability": ("wrong", "Same inversion as 'disparate impact'.", ["intentional discrimination", "equal protection"]),
        "racism": ("wrong", "'Ethnic prejudice' redefines the term rather than rephrasing it.", ["ethnic prejudice", "bias based on heritage"]),
        "gender": ("wrong", "Sex and gender are not synonyms; the substitution is a category error.", ["sex"]),
        "gender identity": ("wrong", "'Biological sex' is not a rewording of gender identity.", ["biological sex"]),
        "identity": ("wrong", "'Identity -> sex' is incoherent outside the specific EO context.", ["sex"]),
        "historically": ("wrong", "Ordinary English word. 'Traditionally' means something else, and "                               "the term should not be flagged at all.", ["traditionally"]),
        "institutional": ("wrong", "Ordinary English word with a different sense in most contexts.", ["organizational", "system-level"]),
        "political": ("wrong", "Ordinary English word; 'government-related' is not a synonym.", ["government-related", "policy-related"]),

    # --- erasure: a concept swapped for a euphemism, no source behind it -----
        "antiracist": ("erasure", "'Fair-minded' does not carry the claim.", ["fair-minded", "equitable approach"]),
        "allyship": ("erasure", "'Partnership' drops the meaning entirely.", ["partnership", "mutual support"]),
        "hate speech": ("erasure", "'Offensive language' understates a defined category.", ["offensive language"]),
        "ethnicity": ("erasure", "'Heritage' is not interchangeable with ethnicity.", ["heritage", "background"]),
        "race and ethnicity": ("erasure", "Same substitution, compounded.", ["background and heritage"]),
        "racial": ("erasure", "'Ethnic' is a different category, not a synonym.", ["ethnic", "heritage-based"]),
        "racially": ("erasure", "Same as 'racial'.", ["ethnically"]),
        "racial diversity": ("erasure", "Recasts race as ethnic background.", ["variety of ethnic backgrounds"]),
        "racial identity": ("erasure", "Recasts race as ethnic background.", ["ethnic background"]),
        "racial inequality": ("erasure", "'Ethnic gaps' drops both the race and the inequality.", ["ethnic gaps"]),
        "racial justice": ("erasure", "'Fair treatment' is not the same claim.", ["fair treatment"]),
        "social justice": ("erasure", "'Fairness in society' is a paraphrase that loses the term.", ["fairness in society"]),
        "injustice": ("erasure", "'Unfairness' is weaker and not equivalent.", ["unfairness"]),
        "oppression": ("erasure", "'Control, domination' describes a mechanism, not the concept.", ["control", "domination"]),
        "oppressive": ("erasure", "Same as 'oppression'.", ["controlling", "harsh"]),
        "marginalize": ("erasure", "'Push aside' is a paraphrase, not a usable replacement.", ["push aside", "overlook"]),
        "marginalized": ("erasure", "'Overlooked' understates it.", ["overlooked", "disregarded"]),
        "discrimination": ("erasure", "A legal term of art; 'unfair treatment' is not equivalent.", ["unfair treatment"]),
        "discriminated": ("erasure", "Same as 'discrimination'.", ["treated unfairly"]),
        "discriminatory": ("erasure", "Same as 'discrimination'.", ["unjust", "biased"]),
        "intersectional": ("erasure", "'Overlapping factors' drops the analytic meaning.", ["overlapping factors"]),
        "intersectionality": ("erasure", "Same as 'intersectional'.", ["overlapping challenges"]),
        "sense of belonging": ("erasure", "'Connection' is not the same construct.", ["connection", "acceptance"]),
        "fostering inclusivity": ("erasure", "'Building connection' means something else.", ["building connection"]),
        "feminism": ("erasure", "Substituting a description for the name of the movement.", ["women's rights advocacy"]),
        "inequality": ("erasure", "'Imbalance, gap' softens a measured claim.", ["imbalance", "gap"]),
        "inequalities": ("erasure", "Same as 'inequality'.", ["imbalances", "gaps"]),
        "inequity": ("erasure", "Same family.", ["unfairness", "imbalance"]),
        "inequities": ("erasure", "Same family.", ["unfairness", "gaps"]),
        "inequitable": ("erasure", "Same family.", ["unfair"]),
        "equal opportunity": ("erasure", "'Fair consideration' is a weaker, different claim.", ["fair consideration"]),
        "health equity": ("erasure", "Defined term in public health; the paraphrase loses it.", ["fair access to healthcare"]),
        "biases": ("erasure", "'Preferences, tendencies' removes the criticism the word carries.", ["preferences", "tendencies"]),
        "biases towards": ("erasure", "Same as 'biases'.", ["preferences", "inclinations"]),

    # --- uncited: real federal policy, but only defensible WITH the citation -
        "racial preferences": ("uncited", "Drawn from executive-order language; needs the citation "                                       "to read as reporting rather than advocacy.", ["merit-based selection", "individual qualifications"]),
        "historically received": ("uncited", "Same; the replacement is an argument, not a synonym.", ["open to new applicants", "competitive on merit"]),
        "underrepresented": ("uncited", "'Merit-based' as a replacement is a policy position.", ["broad range of applicants", "merit-based"]),
}

# Kept deliberately despite being political, because they ARE the tool's
# purpose: the scanner exists to say which words put federal funding at risk
# and what agencies fund instead. Without these it flags a term and offers
# nothing. Listed here so the choice is visible rather than implicit.
KEPT_ON_PURPOSE = ["DEI", "DEIA", "DEIJ", "diversity", "diversity, equity, and inclusion",
                   "equity", "equitable", "equality", "inclusion", "inclusive",
                   "life sciences", "basic research", "prestige"]


def main() -> int:
    dry = "--dry-run" in sys.argv
    data = json.loads(KEYWORDS.read_text())
    by_term = {k["term"]: k for k in data}

    missing = [t for t in DROP if t not in by_term]
    assert not missing, f"DROP names terms that are not in keywords.json: {missing}"

    # Report on the DROP list itself, not on what this particular run changed.
    # Reporting only the newly-blanked meant a second run found nothing to do and
    # rewrote the document with an empty Blanked section, discarding every reason
    # recorded in the first.
    dropped, newly = [], 0
    for term, (category, why, was) in DROP.items():
        entry = by_term[term]
        if entry.get("suggestions"):
            newly += 1
            if not dry:
                entry["suggestions"] = []
        dropped.append((term, was, category, why))

    kept = [k for k in data if k.get("suggestions")]

    lines = [
        "# Suggested-alternatives audit",
        "",
        f"{len(data)} terms. {len(kept)} carry alternatives after this pass, "
        f"{len(dropped)} were blanked, {len(data) - len(kept) - len(dropped)} had none to begin with.",
        "",
        "A term with no alternative still gets flagged in a scan. It just does not "
        "put words in the writer's mouth.",
        "",
        "## Blanked",
        "",
    ]
    for category in ("wrong", "erasure", "uncited"):
        rows = [d for d in dropped if d[2] == category]
        if not rows:
            continue
        lines += [f"### {category} ({len(rows)})", ""]
        lines += [f"- **{t}**, was `{', '.join(w)}`. {why}" for t, w, _, why in sorted(rows)]
        lines.append("")

    lines += ["## Kept as a deliberate call", "",
              "Political, and kept anyway: these are the swaps the tool exists to make. "
              "Each one has a primary source behind it in FedInt.", ""]
    lines += [f"- **{t}**, `{', '.join(by_term[t]['suggestions'])}`"
              for t in KEPT_ON_PURPOSE if by_term.get(t, {}).get("suggestions")]
    lines += ["", "## Kept as ordinary rephrasing", ""]
    lines += [f"- **{k['term']}**, `{', '.join(k['suggestions'])}`"
              for k in sorted(kept, key=lambda x: x["term"].lower())
              if k["term"] not in KEPT_ON_PURPOSE]
    lines.append("")

    if dry:
        print(f"dry run: would blank {len(dropped)}, leaving {len(kept) - 0} with alternatives")
        for t, s, c, _ in sorted(dropped):
            print(f"  [{c}] {t}: {', '.join(s)}")
        return 0

    KEYWORDS.write_text(json.dumps(data, indent=2) + "\n")
    REPORT.write_text("\n".join(lines))
    # The machine-readable half, so the test suite can hold the line without
    # parsing prose.
    (HERE / "blanked-terms.json").write_text(
        json.dumps(sorted(DROP), indent=2) + "\n")
    remaining = [k for k in data if k.get("suggestions")]
    print(f"{len(dropped)} terms held blank ({newly} changed this run); "
          f"{len(remaining)} keep alternatives; wrote {REPORT.name}")

    assert not any(by_term[t]["suggestions"] for t in DROP), "a dropped term kept its alternatives"
    assert all(isinstance(k["suggestions"], list) for k in data), "shape must stay [{term, suggestions[]}]"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
