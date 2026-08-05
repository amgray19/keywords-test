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
    "disparate impact": ("wrong", "Disparate impact is liability WITHOUT intent. Offering "
                                  "'intentional discrimination' as a substitute inverts the standard."),
    "disparate-impact liability": ("wrong", "Same inversion as 'disparate impact'."),
    "racism": ("wrong", "'Ethnic prejudice' redefines the term rather than rephrasing it."),
    "gender": ("wrong", "Sex and gender are not synonyms; the substitution is a category error."),
    "gender identity": ("wrong", "'Biological sex' is not a rewording of gender identity."),
    "identity": ("wrong", "'Identity -> sex' is incoherent outside the specific EO context."),
    "historically": ("wrong", "Ordinary English word. 'Traditionally' means something else, and "
                              "the term should not be flagged at all."),
    "institutional": ("wrong", "Ordinary English word with a different sense in most contexts."),
    "political": ("wrong", "Ordinary English word; 'government-related' is not a synonym."),

    # --- erasure: a concept swapped for a euphemism, no source behind it -----
    "antiracist": ("erasure", "'Fair-minded' does not carry the claim."),
    "allyship": ("erasure", "'Partnership' drops the meaning entirely."),
    "hate speech": ("erasure", "'Offensive language' understates a defined category."),
    "ethnicity": ("erasure", "'Heritage' is not interchangeable with ethnicity."),
    "race and ethnicity": ("erasure", "Same substitution, compounded."),
    "racial": ("erasure", "'Ethnic' is a different category, not a synonym."),
    "racially": ("erasure", "Same as 'racial'."),
    "racial diversity": ("erasure", "Recasts race as ethnic background."),
    "racial identity": ("erasure", "Recasts race as ethnic background."),
    "racial inequality": ("erasure", "'Ethnic gaps' drops both the race and the inequality."),
    "racial justice": ("erasure", "'Fair treatment' is not the same claim."),
    "social justice": ("erasure", "'Fairness in society' is a paraphrase that loses the term."),
    "injustice": ("erasure", "'Unfairness' is weaker and not equivalent."),
    "oppression": ("erasure", "'Control, domination' describes a mechanism, not the concept."),
    "oppressive": ("erasure", "Same as 'oppression'."),
    "marginalize": ("erasure", "'Push aside' is a paraphrase, not a usable replacement."),
    "marginalized": ("erasure", "'Overlooked' understates it."),
    "discrimination": ("erasure", "A legal term of art; 'unfair treatment' is not equivalent."),
    "discriminated": ("erasure", "Same as 'discrimination'."),
    "discriminatory": ("erasure", "Same as 'discrimination'."),
    "intersectional": ("erasure", "'Overlapping factors' drops the analytic meaning."),
    "intersectionality": ("erasure", "Same as 'intersectional'."),
    "sense of belonging": ("erasure", "'Connection' is not the same construct."),
    "fostering inclusivity": ("erasure", "'Building connection' means something else."),
    "feminism": ("erasure", "Substituting a description for the name of the movement."),
    "inequality": ("erasure", "'Imbalance, gap' softens a measured claim."),
    "inequalities": ("erasure", "Same as 'inequality'."),
    "inequity": ("erasure", "Same family."),
    "inequities": ("erasure", "Same family."),
    "inequitable": ("erasure", "Same family."),
    "equal opportunity": ("erasure", "'Fair consideration' is a weaker, different claim."),
    "health equity": ("erasure", "Defined term in public health; the paraphrase loses it."),
    "biases": ("erasure", "'Preferences, tendencies' removes the criticism the word carries."),
    "biases towards": ("erasure", "Same as 'biases'."),

    # --- uncited: real federal policy, but only defensible WITH the citation -
    "racial preferences": ("uncited", "Drawn from executive-order language; needs the citation "
                                      "to read as reporting rather than advocacy."),
    "historically received": ("uncited", "Same; the replacement is an argument, not a synonym."),
    "underrepresented": ("uncited", "'Merit-based' as a replacement is a policy position."),
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

    dropped = []
    for term, (category, why) in DROP.items():
        entry = by_term[term]
        if entry.get("suggestions"):
            dropped.append((term, entry["suggestions"], category, why))
            if not dry:
                entry["suggestions"] = []

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
        lines += [f"- **{t}**, was `{', '.join(s)}`. {why}" for t, s, _, why in sorted(rows)]
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
    remaining = [k for k in data if k.get("suggestions")]
    print(f"blanked {len(dropped)}; {len(remaining)} terms keep alternatives; wrote {REPORT.name}")

    assert not any(by_term[t]["suggestions"] for t in DROP), "a dropped term kept its alternatives"
    assert all(isinstance(k["suggestions"], list) for k in data), "shape must stay [{term, suggestions[]}]"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
