// node test.js
//
// Checks the scanning core: the parts that decide what counts as a match and
// what reaches the DOM. Everything below the DOMContentLoaded handler needs a
// browser, so the file is split at that line and only the pure half is loaded.

const assert = require("assert");
const fs = require("fs");

const src = fs.readFileSync(`${__dirname}/main.js`, "utf8");
const pure = src.split('window.addEventListener("DOMContentLoaded"')[0];
assert(pure.length > 500, "split failed — did the DOMContentLoaded line change?");

// The top of the file kicks off a fetch for the suggestions.
global.fetch = () => Promise.resolve({ json: () => Promise.resolve([]) });
const { escapeHTML, wordRegex, highlightTerm, splitSentences, scanText } =
  new Function(`${pure}\nreturn {escapeHTML, wordRegex, highlightTerm, splitSentences, scanText};`)();

// --- escaping ---------------------------------------------------------------
assert.strictEqual(escapeHTML(`<img src=x onerror="alert(1)">`),
  "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
assert.strictEqual(escapeHTML(null), "");

// A document carrying markup must not produce a live tag. This is the bug the
// port fixes: v2 wrote raw sentence text into innerHTML.
const evil = highlightTerm(`Our <script>alert(1)</script> equity plan.`, "equity");
assert(!evil.includes("<script>"), "raw script tag survived highlighting");
assert(evil.includes("<span class='highlight'>equity</span>"), "highlight missing");

// --- word matching ----------------------------------------------------------
assert(wordRegex("equity").test("The equity plan."), "plain word should match");
assert(!wordRegex("equity").test("Equitycorp Holdings."), "must not match inside a word");
assert(wordRegex("equity").test("EQUITY."), "matching is case-insensitive");
assert(wordRegex("c++").test("We used c++ here."), "regex metacharacters must be escaped");
assert(wordRegex("environmental justice").test("An environmental justice review."),
  "multi-word phrases match as a substring");

// Highlighting survives characters that change length when escaped. Matching
// against pre-escaped text would misplace the span.
const amp = highlightTerm(`R&D and equity & more`, "equity");
assert(amp.includes("R&amp;D"), "ampersand not escaped");
assert(amp.includes("<span class='highlight'>equity</span>"), "highlight lost around &");

// --- sentences --------------------------------------------------------------
assert.deepStrictEqual(splitSentences("One. Two! Three?  "), ["One.", "Two!", "Three?"]);
assert.deepStrictEqual(splitSentences("   "), []);

// --- scanning ---------------------------------------------------------------
const doc = "We advance equity here. Nothing to see. Equity again, plus diversity.";
const r = scanText("a.docx", doc, ["equity", "diversity", "absent"]);
assert.strictEqual(r.sentences, 3);
assert.deepStrictEqual(r.summary.equity, [1, 3], "both equity sentences, numbered from 1");
assert.deepStrictEqual(r.summary.diversity, [3]);
assert(!("absent" in r.summary), "a term with no hits must not appear in the summary");
assert.strictEqual(r.results.length, 3);
assert.strictEqual(r.results[0].raw, "We advance equity here.",
  "the raw sentence is kept for safe re-highlighting");

// A clean document produces an empty summary rather than throwing.
assert.deepStrictEqual(scanText("b.txt", "Nothing here.", ["equity"]).summary, {});

// --- shipped data -----------------------------------------------------------
const terms = JSON.parse(fs.readFileSync(`${__dirname}/terms-to-use.json`, "utf8"));
assert(terms.length, "terms-to-use.json is empty");
assert(terms.every(t => t.term && t.why && t.cluster), "every term needs a why and a theme");
assert(!JSON.stringify(terms).includes("evidence"),
  "the cited evidence layer must not ship in the public tool");

const kw = JSON.parse(fs.readFileSync(`${__dirname}/keywords.json`, "utf8"));
assert(kw.every(k => typeof k.term === "string" && Array.isArray(k.suggestions)),
  "keywords.json must stay [{term, suggestions[]}] — the shape FedInt exports");

console.log(`ok — scanning core, ${terms.length} terms to use, ${kw.length} keywords`);
