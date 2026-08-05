// Keyword Search Tool
// Scans documents in the browser for a keyword list and reports where each
// term appears, with suggested alternatives and a frequency chart.
//
// Nothing is uploaded. Files are read with arrayBuffer/text, parsed by
// vendored mammoth.js (.docx) and pdf.js (.pdf), and every result is rendered
// from memory. No network request carries document content.
//
// Scanning core ported from FedInt, 2026-08-05.

let keywordSuggestions = {};
let keywordSuggestionsLoaded = fetch('keywords.json')
  .then(response => response.json())
  .then(data => {
    data.forEach(entry => {
      keywordSuggestions[entry.term.toLowerCase()] = entry.suggestions;
    });
  })
  .catch(err => {
    console.warn("Keyword suggestions failed to load:", err);
  });

let chartInstance = null;
let lastParsedData = [];
let currentChartType = "bar";

// ---- text helpers ----------------------------------------------------------
// Document text is untrusted: a .docx can carry markup that would execute if
// dropped into innerHTML. Everything derived from a file is escaped before it
// reaches the DOM.
function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A phrase matches as a substring, so "environmental justice" is still found
// inside "environmental justices". A single token is anchored to word
// boundaries so "equity" does not match "Equitycorp" — but only on the edges
// that are word characters. \b between two non-word characters never matches,
// so anchoring a term like "c++" unconditionally made it unfindable no matter
// how many times it appeared.
function wordRegex(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (term.includes(" ")) return new RegExp("(" + escaped + ")", "gi");
  const left = /^\w/.test(term) ? "\\b" : "";
  const right = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(left + "(" + escaped + ")" + right, "gi");
}

// Highlight on the RAW sentence, escaping segments as they are assembled.
// Matching against already-escaped text corrupts highlights around &, <, and
// quotes, because the escape sequences move the offsets.
function highlightTerm(sentence, keyword) {
  const re = wordRegex(keyword);
  let out = "", last = 0, m;
  while ((m = re.exec(sentence)) !== null) {
    out += escapeHTML(sentence.slice(last, m.index))
        + "<span class='highlight'>" + escapeHTML(m[1]) + "</span>";
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out + escapeHTML(sentence.slice(last));
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

async function readDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// PDF text extraction, fully client-side (vendored pdf.js, same-origin worker).
async function readPdf(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map(it => it.str).join(" "));
  }
  return pages.join("\n");
}

async function readOne(file) {
  const name = file.name.toLowerCase();
  return name.endsWith(".docx") ? await readDocx(file)
       : name.endsWith(".pdf")  ? await readPdf(file)
       : await file.text();
}

// One document against the keyword list. Sentences are numbered so a finding
// can be pointed at, and each match keeps the RAW sentence so the highlight is
// rebuilt safely at render time.
function scanText(filename, text, keywordList) {
  const sentences = splitSentences(text);
  const summary = {};
  const results = [];

  sentences.forEach((sentence, idx) => {
    keywordList.forEach(keyword => {
      if (wordRegex(keyword).test(sentence)) {
        (summary[keyword] = summary[keyword] || []).push(idx + 1);
        results.push({ page: idx + 1, raw: sentence, keyword });
      }
    });
  });

  return { filename, summary, results, sentences: sentences.length };
}

window.addEventListener("DOMContentLoaded", () => {
    const keywordTextarea = document.getElementById("keywordsPaste");
    const keywordUploadInput = document.getElementById("keywordUpload");
    const keywordSourceIndicator = document.getElementById("keywordSourceIndicator");
    const reloadKeywordsBtn = document.getElementById("reloadKeywords");
    const toggleTheme = document.getElementById("toggle-theme");
    const viewToggle = document.getElementById("viewModeToggle");
    const viewHidden = document.getElementById("viewMode");
    const chartTypeToggle = document.getElementById("chartTypeToggle");
    const docUploadInput = document.getElementById("upload");

    // Warn immediately when a legacy .doc is selected. .docx, .pdf and plain
    // text all work; the pre-2007 binary .doc format does not.
    docUploadInput.addEventListener("change", () => {
        const docFiles = Array.from(docUploadInput.files).filter(
            f => f.name.toLowerCase().endsWith(".doc") && !f.name.toLowerCase().endsWith(".docx")
        );
        if (docFiles.length) {
            const names = docFiles.map(f => f.name).join("\n  ");
            alert(
                "Legacy .doc format is not supported:\n\n  " + names + "\n\n" +
                "Please re-save as .docx in Word:\n" +
                "File → Save As → Word Document (.docx)"
            );
            docUploadInput.value = "";
        }
    });

    // Theme setup
    const saved = localStorage.getItem("theme") || "light";
    document.body.classList.add(`${saved}-mode`);
    toggleTheme.checked = saved === "dark";

    // View toggle sync
    if (viewToggle && viewHidden) {
        viewToggle.checked = viewHidden.value === "keyword";
        viewHidden.value = viewToggle.checked ? "keyword" : "file";
    }

    loadDefaultKeywordList();

    reloadKeywordsBtn?.addEventListener("click", loadDefaultKeywordList);

    function loadDefaultKeywordList() {
        fetch('keywords.txt')
        .then(response => response.text())
        .then(text => {
            keywordTextarea.value = text.trim();
            keywordUploadInput.value = "";
            const n = text.trim().split(/\r?\n/).filter(Boolean).length;
            keywordSourceIndicator.textContent = `Using default keyword list (${n} terms).`;
        })
        .catch(err => {
            keywordSourceIndicator.textContent = "⚠️ Failed to load default keyword list.";
            console.error("Default keyword list failed to load:", err);
        });
    }

    keywordUploadInput.addEventListener("change", async () => {
        const file = keywordUploadInput.files[0];
        if (!file) return;
        let text = "";
        try { text = await readOne(file); }
        catch (err) {
            keywordSourceIndicator.textContent = `⚠️ Could not read ${file.name}.`;
            console.error("Keyword file failed to read:", err);
            return;
        }
        keywordTextarea.value = text.trim();
        keywordSourceIndicator.textContent = `Using uploaded keyword file: ${file.name}`;
    });

    toggleTheme.addEventListener("change", (e) => {
        const isDark = e.target.checked;
        const newMode = isDark ? "dark" : "light";
        localStorage.setItem("theme", newMode);
        document.body.classList.remove("dark-mode", "light-mode");
        document.body.classList.add(`${newMode}-mode`);
        renderChart(currentChartType);
        renderOutput();
    });

    chartTypeToggle.addEventListener("change", () => {
        currentChartType = chartTypeToggle.checked ? "pie" : "bar";
        renderChart(currentChartType, false);
        renderOutput();
    });

    viewToggle.addEventListener("change", (e) => {
        viewHidden.value = e.target.checked ? "keyword" : "file";
        renderOutput();
    });

    // The filter dropdown never re-rendered on change: picking a keyword did
    // nothing until some other control fired renderOutput.
    document.getElementById("filterKeyword").addEventListener("change", renderOutput);

    document.getElementById("reset").addEventListener("click", () => {
        document.getElementById("upload").value = "";
        keywordUploadInput.value = "";
        keywordTextarea.value = "";
        document.getElementById("output").innerHTML = "";
        document.getElementById("chart").style.display = "none";
        document.getElementById("scrollPrompt").style.display = "none";
        if (chartInstance) chartInstance.destroy();
        chartInstance = null;
        lastParsedData = [];
        document.getElementById("filterKeyword").value = "";
        viewHidden.value = "file";
        viewToggle.checked = false;
    });

    document.getElementById("generate").addEventListener("click", async () => {
        await keywordSuggestionsLoaded;

        const generateBtn = document.getElementById("generate");
        const output = document.getElementById("output");
        const prompt = document.getElementById("scrollPrompt");

        const keywordUpload = keywordUploadInput.files[0];
        let keywordText = "";
        if (keywordUpload) {
            try { keywordText = await readOne(keywordUpload); }
            catch (err) { alert(`Could not read the keyword file ${keywordUpload.name}.`); return; }
        } else {
            keywordText = keywordTextarea.value;
        }

        const keywordList = [...new Set(
            keywordText.split(/\r?\n/).map(k => k.trim()).filter(Boolean)
        )];
        if (!keywordList.length) {
            alert("Please provide at least one keyword (upload a file or paste).");
            return;
        }

        const files = Array.from(document.getElementById("upload").files);
        if (!files.length) {
            alert("Please upload at least one document (.docx, .pdf, or .txt).");
            return;
        }

        const legacyDoc = files.filter(f => f.name.toLowerCase().endsWith(".doc") &&
                                            !f.name.toLowerCase().endsWith(".docx"));
        if (legacyDoc.length) {
            alert(
                "Legacy .doc format is not supported:\n\n  " +
                legacyDoc.map(f => f.name).join("\n  ") + "\n\n" +
                "Please re-save as .docx in Word:\n" +
                "File → Save As → Word Document (.docx)"
            );
            return;
        }

        // Every file is read and matched before anything renders. The previous
        // version rendered inside each FileReader callback, so with several
        // documents the chart and the summary raced each other and a partial
        // scan could be displayed as though it were the whole submission.
        output.innerHTML = "";
        prompt.style.display = "block";
        prompt.textContent = `Scanning ${files.length} ${files.length === 1 ? "file" : "files"}…`;
        generateBtn.disabled = true;
        lastParsedData = [];

        const unreadable = [], empty = [];
        try {
            for (const file of files) {
                let text = "";
                try { text = await readOne(file); }
                catch (err) { console.error(file.name, err); unreadable.push(file.name); continue; }
                if (!text.trim()) { empty.push(file.name); continue; }
                lastParsedData.push(scanText(file.name, text, keywordList));
            }
        } finally {
            generateBtn.disabled = false;
        }

        const problems = [
            unreadable.length ? `Could not read ${unreadable.join(", ")}. Use .docx, .pdf, or .txt.` : "",
            empty.length ? `No extractable text in ${empty.join(", ")}. A scanned-image PDF needs OCR first.` : "",
        ].filter(Boolean);

        if (!lastParsedData.length) {
            prompt.style.display = "none";
            output.innerHTML = `<div class="scan-problem">${escapeHTML(problems.join(" ") || "Nothing to scan.")}</div>`;
            renderChart(currentChartType, false);
            updateFilterOptions([]);
            return;
        }

        const allKeywords = new Set();
        lastParsedData.forEach(f => Object.keys(f.summary).forEach(k => allKeywords.add(k)));
        updateFilterOptions([...allKeywords].sort());

        prompt.textContent = "▼▼▼ Scroll Down for Summary Results ▼▼▼";
        renderChart(currentChartType, false);
        renderOutput();
        if (problems.length) {
            output.insertAdjacentHTML("afterbegin",
                `<div class="scan-problem">${escapeHTML(problems.join(" "))}</div>`);
        }
    });

    document.getElementById("download-pdf").addEventListener("click", () => {
        if (!lastParsedData.length) {
            alert("Run a scan first — there is nothing to print yet.");
            return;
        }
        renderChart(currentChartType, true, () => {
            const chartCanvas = document.getElementById("chart");
            const chartImg = chartCanvas.toDataURL("image/png");
            const scanned = lastParsedData.map(f => f.filename).join(", ");

            const printWindow = window.open("", "_blank", "width=900,height=1000");
            const doc = printWindow.document;
            doc.write("<html><head><title>Keyword Summary</title><style>");
            doc.write("body { font-family: Arial; padding: 2em; color: #000; background: #fff; }");
            doc.write("img { width: 80%; max-width: 600px; display: block; margin: 2em auto 1em auto; }");
            doc.write(".highlight { background: yellow; font-weight: bold; color: red; }");
            doc.write(".scan-meta { color: #444; font-size: 0.9em; }");
            doc.write("</style></head><body>");
            doc.write("<h1>Keyword Summary Report</h1>");
            doc.write(`<p class="scan-meta">${escapeHTML(scanned)} — scanned ${escapeHTML(new Date().toLocaleDateString())}</p>`);
            doc.write(`<img src="${chartImg}" alt="Chart">`);
            doc.write(document.getElementById("output").innerHTML);
            doc.write("</body></html>");
            doc.close();
            printWindow.onload = () => printWindow.print();
        });
    });

    function updateFilterOptions(keywordList) {
      const select = document.getElementById("filterKeyword");
      const previous = select.value;
      select.innerHTML = `<option value="">(Show All Keywords)</option>`;
      keywordList.forEach(k => {
        const option = document.createElement("option");
        option.value = k;
        option.textContent = k;
        select.appendChild(option);
      });
      select.value = keywordList.includes(previous) ? previous : "";
    }

    function renderChart(type, forceLightMode = false, onComplete = null) {
        const chartCanvas = document.getElementById("chart");
        if (!lastParsedData.length) {
            chartCanvas.style.display = "none";
            if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
            return;
        }

        // Counts are summed across every document scanned, so the chart shows
        // the vocabulary of the submission as a whole rather than of one file.
        const keywordCounts = {};
        lastParsedData.forEach(file => {
            Object.entries(file.summary).forEach(([keyword, pages]) => {
                keywordCounts[keyword] = (keywordCounts[keyword] || 0) + pages.length;
            });
        });

        const entries = Object.entries(keywordCounts).sort(([a], [b]) => a.localeCompare(b));
        const keywords = entries.map(([k]) => k);
        const counts = entries.map(([, v]) => v);
        const total = counts.reduce((a, b) => a + b, 0);

        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
        if (!keywords.length) {
            chartCanvas.style.display = "none";
            if (typeof onComplete === "function") onComplete();
            return;
        }

        const ctx = chartCanvas.getContext("2d");
        chartCanvas.style.display = "block";
        chartCanvas.style.backgroundColor = document.body.classList.contains("dark-mode") ? "#000" : "#fff";
        chartCanvas.style.border = "1px solid #ccc";
        chartCanvas.height = 500;

        const actualType = type === "bar" && keywords.length > 6 ? "bar" : type;
        const indexAxis = actualType === "bar" && keywords.length > 6 ? "y" : "x";
        const isDark = forceLightMode ? false : document.body.classList.contains("dark-mode");

        const backgroundColor = keywords.map((_, i) =>
                                             isDark
                                             ? `hsl(${(360 * i / keywords.length)}, 100%, 35%)`
                                             : `hsl(${(360 * i / keywords.length)}, 80%, 75%)`
                                             );
        const borderColor = isDark ? "#fff" : "#000";

        Chart.register(ChartDataLabels);

        chartInstance = new Chart(ctx, {
            type: actualType,
            data: {
                labels: keywords,
                datasets: [{
                    label: "Keyword Matches",
                    data: counts,
                    backgroundColor,
                    borderColor,
                    borderWidth: 1
                }]
            },
            options: {
                radius: "70%",
                indexAxis,
                responsive: false,
                maintainAspectRatio: false,
                animation: {
                    onComplete: () => { if (typeof onComplete === "function") onComplete(); }
                },
                layout: {
                    padding: {
                        top: actualType === "pie" ? 30 : 20,
                        bottom: actualType === "pie" ? 30 : 10
                    }
                },
                scales: actualType === "pie" ? {} : {
                    x: {
                        ticks: { color: isDark ? "#fff" : "#000" },
                        grid: { color: isDark ? "#444" : "#ccc" }
                    },
                    y: {
                        ticks: { color: isDark ? "#fff" : "#000" },
                        grid: { color: isDark ? "#444" : "#ccc" }
                    }
                },
                plugins: {
                    legend: {
                        display: actualType === "pie",
                        position: "bottom",
                        labels: {
                            color: isDark ? "#fff" : "#000",
                            padding: 10,
                            boxHeight: 12,
                            boxWidth: 12
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const count = ctx.raw;
                                const percent = ((count / total) * 100).toFixed(1);
                                return `${ctx.label}: ${count} match(es) (${percent}%)`;
                            }
                        }
                    },
                    datalabels: {
                        color: isDark ? "#fff" : "#000",
                        anchor: "center",
                        align: "center",
                        font: { weight: "bold" },
                        formatter: (value, ctx) => {
                            const sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                            const percent = (value / sum) * 100;
                            return `${value} (${percent.toFixed(1)}%)`;
                        }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    function renderOutput() {
        const output = document.getElementById("output");
        output.innerHTML = "";

        const filterSelect = document.getElementById("filterKeyword");
        const filter = filterSelect ? filterSelect.value : "";
        const viewMode = document.getElementById("viewMode").value;

        const flagged = lastParsedData.reduce((n, f) => n + Object.keys(f.summary).length, 0);
        if (lastParsedData.length && !flagged) {
            output.innerHTML = `<div class="scan-clean">No keywords found in ` +
                `${escapeHTML(lastParsedData.map(f => f.filename).join(", "))}. Clean draft.</div>`;
            return;
        }

        if (viewMode === "file") {
            lastParsedData.forEach(file => {
                const section = document.createElement("div");
                section.classList.add("file-section");
                section.innerHTML = `<h2>Results for: ${escapeHTML(file.filename)}</h2>`;
                const summaryData = Object.entries(file.summary).filter(([k]) => !filter || k === filter);
                const resultData = file.results.filter(entry => !filter || entry.keyword === filter);
                section.innerHTML += renderSummary(file.filename, summaryData, resultData);
                output.appendChild(section);
            });
        } else if (viewMode === "keyword") {
            const combined = {};
            lastParsedData.forEach(file => {
                file.results.forEach(entry => {
                    if (!filter || entry.keyword === filter) {
                        if (!combined[entry.keyword]) combined[entry.keyword] = [];
                        combined[entry.keyword].push({ ...entry, filename: file.filename });
                    }
                });
            });

            Object.keys(combined).sort().forEach(keyword => {
                const section = document.createElement("div");
                section.classList.add("file-section");
                section.innerHTML = `<h2>Results for Keyword: ${escapeHTML(keyword)}</h2>`;
                section.innerHTML += renderResults(combined[keyword], lastParsedData.length > 1);
                output.appendChild(section);
            });
        }
    }

    function suggestionsHTML(keyword) {
        const suggestions = keywordSuggestions[keyword.toLowerCase()] || [];
        const label = "margin-left: 1.5em; font-style: italic; font-weight: bold; color: #3b8ed9;";
        if (!suggestions.length) {
            return `<div class="suggested-alternatives" style="${label}">` +
                   `No suggested alternatives for "<strong>${escapeHTML(keyword)}</strong>."</div>`;
        }
        return `<div style="${label} margin-top: 0.5em;">Suggested alternatives for ` +
               `"<strong>${escapeHTML(keyword)}</strong>":</div>` +
               `<ol style="margin-left: 3em; margin-top: 0.25em; margin-bottom: 0.5em; color: #3b8ed9; font-style: italic;">` +
               suggestions.map(s => `<li>"${escapeHTML(s)}"</li>`).join("") + `</ol>`;
    }

    function renderSummary(filename, summaryData, resultData) {
        if (!summaryData.length) {
            return `<div class='summary'><h3>Summary for ${escapeHTML(filename)}</h3><p>No results found.</p></div>`;
        }
        let html = `<div class='summary'><h3>Summary for ${escapeHTML(filename)}</h3><ul>`;
        summaryData.forEach(([keyword, pages]) => {
            const unique = [...new Set(pages)];
            html += `<li><strong>"${escapeHTML(keyword)}"</strong> — ${pages.length} match(es) ` +
                    `(Sentence${unique.length > 1 ? "s" : ""} ${unique.join(", ")})`;

            const allMatches = resultData.filter(r => r.keyword.toLowerCase() === keyword.toLowerCase());
            if (allMatches.length) {
                html += `<div style="margin-left: 1.5em; margin-top: 0.3em;">Results:</div><ul style="margin-left: 2.5em;">`;
                allMatches.forEach(match => {
                    html += `<li style="margin-bottom: 0.3em;">“${highlightTerm(match.raw, match.keyword)}”</li>`;
                });
                html += `</ul>`;
            }

            html += suggestionsHTML(keyword);
            html += `</li>`;
        });
        html += "</ul></div>";
        return html;
    }

    // ---- tabs ---------------------------------------------------------------
    // Declared before the tab wiring below: the #terms deep-link clicks the tab
    // synchronously, and a `let` further down would still be in its temporal
    // dead zone when loadTerms reads it.
    let termsData = null;

    const TABS = [["tab-scan", "view-scan"], ["tab-terms", "view-terms"]];
    TABS.forEach(([tabId, viewId]) => {
        document.getElementById(tabId).addEventListener("click", () => {
            TABS.forEach(([t, v]) => {
                const on = t === tabId;
                document.getElementById(t).setAttribute("aria-selected", String(on));
                document.getElementById(v).hidden = !on;
            });
            location.hash = viewId === "view-terms" ? "terms" : "scan";
            if (viewId === "view-terms") loadTerms();
        });
    });
    if (location.hash === "#terms") document.getElementById("tab-terms").click();

    // ---- Terms to Use -------------------------------------------------------
    // Vocabulary agencies are rewarding. Fetched on first view rather than at
    // load, so someone who only ever scans a document never pays for it.
    async function loadTerms() {
        if (termsData) return;
        const list = document.getElementById("termsList");
        try {
            const res = await fetch("terms-to-use.json");
            termsData = await res.json();
        } catch (err) {
            console.error("terms-to-use.json failed to load:", err);
            list.innerHTML = `<div class="scan-problem">Could not load the terms list.</div>`;
            return;
        }
        const clusters = [...new Set(termsData.map(t => t.cluster).filter(Boolean))].sort();
        const select = document.getElementById("termsCluster");
        clusters.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c; opt.textContent = c;
            select.appendChild(opt);
        });
        ["termsFilter", "termsCluster", "termsSort"].forEach(id =>
            document.getElementById(id).addEventListener("input", renderTerms));
        renderTerms();
    }

    function renderTerms() {
        const list = document.getElementById("termsList");
        const needle = document.getElementById("termsFilter").value.trim().toLowerCase();
        const cluster = document.getElementById("termsCluster").value;
        const sort = document.getElementById("termsSort").value;

        let rows = termsData.filter(t =>
            (!cluster || t.cluster === cluster) &&
            (!needle || t.term.toLowerCase().includes(needle) ||
                        t.why.toLowerCase().includes(needle) ||
                        t.cluster.toLowerCase().includes(needle)));

        // A term with no mention count is untracked, not absent, so it sorts
        // below the counted terms rather than tying with a genuine zero.
        const rank = t => (t.mentions === null || t.mentions === undefined ? -1 : t.mentions);
        rows = rows.slice().sort(
            sort === "mentions" ? (a, b) => rank(b) - rank(a) || a.term.localeCompare(b.term)
          : sort === "alpha"    ? (a, b) => a.term.localeCompare(b.term)
          :                       (a, b) => a.cluster.localeCompare(b.cluster) ||
                                            a.term.localeCompare(b.term));

        document.getElementById("termsCount").textContent =
            `${rows.length} of ${termsData.length} terms`;

        if (!rows.length) {
            list.innerHTML = `<div class="scan-clean">Nothing matches that filter.</div>`;
            return;
        }

        list.innerHTML = rows.map(t => {
            const mentions = (t.mentions === null || t.mentions === undefined)
                ? "not yet tracked"
                : `${t.mentions} ${t.mentions === 1 ? "mention" : "mentions"} in the federal corpus`;
            return `<div class="term-card">
                <h3><span>${escapeHTML(t.term)}</span>` +
                (t.cluster ? `<span class="term-cluster">${escapeHTML(t.cluster)}</span>` : "") +
                `<span class="term-mentions">${escapeHTML(mentions)}</span></h3>
                <p class="term-why">${escapeHTML(t.why)}</p>
            </div>`;
        }).join("");
    }

    function renderResults(resultData, showFilenames) {
        if (!resultData.length) return "";
        let html = "<div class='results'><h3>Matched Sentences</h3><ul>";
        resultData.forEach(entry => {
            html += `<li><strong>Sentence ${entry.page}:</strong> “${highlightTerm(entry.raw, entry.keyword)}”`;
            if (showFilenames && entry.filename) {
                html += ` <span class="sentence-doc">${escapeHTML(entry.filename)}</span>`;
            }
            html += suggestionsHTML(entry.keyword);
            html += `</li>`;
        });
        html += "</ul></div>";
        return html;
    }
});
