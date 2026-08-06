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

`terms-to-use.json` is built from the upstream curated artifacts:

```bash
python3 build-terms.py ../FedInt/dashboard
```

Not every flagged term has an alternative, and that is deliberate. A suggestion is only offered when
a writer can accept it without changing what they meant. `audit-suggestions.py` enforces that line
and writes [`suggestions-audit.md`](./suggestions-audit.md), which records every alternative that
was removed and why.

---

## 🛠️ Development

```bash
git clone https://github.com/amgray19/keywords-test.git
cd keywords-test
node test.js          # scanning core: escaping, matching, sentence splitting, shipped data
python3 -m http.server 8912
```

Then open <http://localhost:8912/>. There is no build step.
