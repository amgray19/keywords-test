# keyword/scan

Checks a document against a keyword list. Reads Word, PDF, and plain text, reports every sentence
each term appears in, offers alternatives where the list supplies them, and charts match frequency.

Works with any list. Upload or paste your own to scan for anything else.

Nothing is uploaded. Files are parsed in the browser and every result is rendered from memory.

---

## ✨ Features

- Fully client-side processing (no files ever leave your computer)
- Reads Word (`.docx`), PDF, and plain text
- Scans several documents as one set, so a term repeating across a batch is visible
- 734-term default list, or upload/paste your own
- Download a sample [keywords.txt](./keywords.txt) for testing
- Bar and pie chart of match frequency (Apache ECharts)
- A **Terms to use** tab of vocabulary federal agencies are currently rewarding
- Export a report as PDF or Word (.docx)
- Dark/light mode toggle
- Strict Content Security Policy, and document text is escaped before display

---

## 🛡️ Security

**This tool is 100% client-side.**

- Uploaded files are processed in your browser.
- No file content is sent to any server.
- Text extracted from a document is escaped before it reaches the page, so a file carrying markup
  cannot execute anything.
- Strict Content Security Policy prevents injection.

---

## 🚀 Usage

1. Upload a `.txt` file of keywords (or paste keywords into the textarea).
2. If you don't have a list, [download the sample keywords.txt](./keywords.txt).
3. Upload one or more `.docx`, `.pdf`, or `.txt` files. (Legacy `.doc` is not supported, re-save as
   `.docx` in Word via File → Save As → Word Document.)
4. Click **Generate Summary**.
5. Review results, view charts, and see alternative keyword suggestions.
6. Use **Export PDF** or **Export Word** to produce a report.

---

## 📊 Data

Three files drive the tool, all regenerable:

| File | What it is |
|---|---|
| `keywords.txt` | The default scan list, one term per line. Replace it with anything. |
| `keywords.json` | `[{term, suggestions[]}]`, the alternatives offered when a term is found. |
| `terms-to-use.json` | The **Terms to use** tab. Specific to the bundled federal list. |

### Refreshing from upstream

The term data originates in an upstream FedInt dashboard build. One command pulls a refresh
through the filters that keep this tool's decisions intact:

```bash
python3 sync-from-fedint.py --dry-run     # see what would change
python3 sync-from-fedint.py               # do it
node test.js                              # then commit and push
```

It is not a copy. A straight copy would undo three decisions at once: the 46 blanked alternatives
return, Federal Register boilerplate leaks back in so a scan flags "comment period", and
`keywords.txt` drifts from `keywords.json`. The pipeline excludes the boilerplate, writes both
keyword files from one list, re-applies the audit, rebuilds the terms tab, and re-stamps the asset
URLs. Running it against unchanged upstream data is a no-op.

Not every flagged term has an alternative, and that is deliberate. A suggestion is only offered when
a writer can accept it without changing what they meant. `audit-suggestions.py` enforces that line
and writes [`suggestions-audit.md`](./suggestions-audit.md), which records every alternative that
was removed and why.

---

## 🛠️ Development

```bash
git clone https://github.com/amgray19/keywords-test.git
cd keywords-test
node test.js          # scanning core, shipped data, and asset-stamp freshness
python3 -m http.server 8912
```

Then open <http://localhost:8912/>. There is no build step.

---

## 🚀 Deploying

GitHub Pages builds from `main` at the repository root. Merging to `main` and pushing is the whole
deploy.

Pages does not allow response headers, so it serves every asset with its own `max-age` and an ETag.
A visitor who already has `style.css` keeps using it after a deploy, and the page looks unchanged
while the file on disk is correct. The fix is in the URLs: every reference carries a hash of that
file's contents, so changed bytes mean a changed URL and the cached copy stops matching. Files that
did not change keep their URL and stay cached.

Run this before committing a deploy:

```bash
python3 stamp-assets.py     # rewrites the ?v= stamps
node test.js                # fails if any stamp is stale
```

`index.html` itself is still subject to Pages' own cache for up to ten minutes, which is the one
part that cannot be controlled from here. Hard-reload once (Cmd+Shift+R) if you are checking a
deploy in the first few minutes.
