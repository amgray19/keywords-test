// Keyword Search Tool
// Scans documents in the browser for a keyword list and reports where each
// term appears, with suggested alternatives and a frequency chart.
//
// Nothing is uploaded. Files are read with arrayBuffer/text, parsed by
// vendored mammoth.js (.docx) and pdf.js (.pdf), and every result is rendered
// from memory. No network request carries document content.
//
// Scanning core ported from FedInt, 2026-08-05. Charts are Apache ECharts,
// themed from the same CSS tokens as the page.

let keywordSuggestions = {};
let keywordSuggestionsLoaded = fetch('keywords.json?v=5f77060ca8')
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
// boundaries so "equity" does not match "Equitycorp", but only on the edges
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
  pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js?v=feabdf3097";
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

// Match totals across every document scanned, which is what the chart plots.
function keywordTotals(parsed) {
  const counts = {};
  parsed.forEach(file => {
    Object.entries(file.summary).forEach(([keyword, hits]) => {
      counts[keyword] = (counts[keyword] || 0) + hits.length;
    });
  });
  return counts;
}

// ---- chart theming ---------------------------------------------------------
const tok = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

// One colour per term, bars and slices alike. A single-colour bar chart with the
// leader highlighted was the earlier choice, on the theory that colour should
// only encode a distinction that exists in the data. It read as a chart that had
// failed to load the rest of its colours, which is the more important fact.
// Chosen for distinguishability rather than generated: interpolating between two
// brand colours ran the middle of the series through desaturated brown.
// Hues step by the golden angle, which spreads any number of series as far
// apart as they can get: neighbours in the list never land next to each other on
// the wheel, and the sequence never repeats until it has been all the way round.
// A fixed twelve-colour list ran out and started reusing colours on a long scan.
// Lightness alternates slightly so two hues that read alike still separate.
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}

const relLum = ([r, g, b]) => {
  const v = [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const contrast = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// HSL lightness is not perceptual: yellow at 47% is far brighter than blue at
// 47%, so a fixed lightness produced bars ranging from 1.9:1 to 10:1 against the
// same background. Each hue's lightness is solved for a contrast target instead,
// which keeps every bar distinguishable from the card behind it. WCAG asks 3:1
// of a graphical object; the target is 3.6 for margin.
function solveLightness(hue, sat, bg, target, dark) {
  let lo = dark ? 40 : 8, hi = dark ? 92 : 60, best = dark ? hi : lo;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const c = contrast(hslToRgb(hue, sat, mid), bg);
    if (c >= target) { best = mid; if (dark) hi = mid; else lo = mid; }
    else if (dark) lo = mid; else hi = mid;
  }
  return best;
}

// Hues step by the golden angle, which spreads any number of series as far apart
// as they can get: neighbours in the list never land next to each other on the
// wheel, and the sequence does not repeat until it has been all the way round. A
// fixed twelve-colour list ran out and started reusing colours on a long scan.
//
// Hue alone is not enough. Solving every colour to one contrast target pinned
// the whole set to the same lightness, an L* range of 8 across fourteen series,
// and the eye reads lightness far more strongly than hue: sixteen different
// hues at one brightness look like one family. Saturation and contrast target
// both cycle as well, so the set spans pale to deep and muted to vivid while
// every member still clears the 3:1 a graphical object needs.
const SAT_CYCLE = [58, 92, 72, 100, 66, 84];
const CONTRAST_CYCLE_DARK  = [4.2, 8.5, 5.6, 11.5, 6.8, 3.6];
const CONTRAST_CYCLE_LIGHT = [3.3, 6.5, 4.4, 9.5, 5.2, 3.8];

function palette(n, dark) {
  const bg = dark ? [20, 25, 32] : [255, 255, 255];
  const targets = dark ? CONTRAST_CYCLE_DARK : CONTRAST_CYCLE_LIGHT;
  return Array.from({ length: n }, (_, i) => {
    const hue = (i * 137.508 + 196) % 360;          // start on the cyan of the UI
    const sat = SAT_CYCLE[i % SAT_CYCLE.length];
    // The cycles are different lengths from each other and from the hue step, so
    // saturation and lightness do not fall back into step with the hue.
    const light = solveLightness(hue, sat, bg, targets[i % targets.length], dark);
    return `hsl(${hue.toFixed(1)} ${sat}% ${light.toFixed(1)}%)`;
  });
}

function chartOption(counts, type, forPrint = false) {
  const entries = Object.entries(counts).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const labels = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);
  const total = values.reduce((a, b) => a + b, 0);

  const ink = forPrint ? "#10141A" : tok("--ink");
  const dim = forPrint ? "#5A6472" : tok("--ink-dim");
  const line = forPrint ? "#DDE2E8" : tok("--line");
  const font = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const pct = v => `${((v / total) * 100).toFixed(1)}%`;

  const base = {
    animation: !forPrint,
    textStyle: { fontFamily: font, color: ink },
    tooltip: {
      trigger: type === "pie" ? "item" : "axis",
      backgroundColor: forPrint ? "#FFFFFF" : (isDark() ? "#141920" : "#FFFFFF"),
      borderColor: line,
      textStyle: { color: ink, fontFamily: font },
      formatter: p => {
        const d = Array.isArray(p) ? p[0] : p;
        return `${d.name}<br/><strong>${d.value}</strong> match${d.value === 1 ? "" : "es"} (${pct(d.value)})`;
      },
    },
  };

  if (type === "pie") {
    const pieColors = palette(labels.length, forPrint ? false : isDark());
    return {
      ...base,
      legend: { bottom: 0, textStyle: { color: dim, fontFamily: font }, type: "scroll" },
      series: [{
        type: "pie",
        radius: ["42%", "70%"],
        center: ["50%", "45%"],
        itemStyle: { borderColor: forPrint ? "#FFFFFF" : tok("--bg-card"), borderWidth: 2 },
        label: { color: ink, fontFamily: font, formatter: "{b}\n{c}" },
        data: labels.map((name, i) => ({ name, value: values[i],
                                         itemStyle: { color: pieColors[i] } })),
      }],
    };
  }

  // Horizontal bars once the labels stop fitting across the top. Vertical bars
  // with 30 rotated keyword labels are unreadable, which is what the previous
  // chart did past six terms.
  const horizontal = labels.length > 6;
  const cat = { type: "category", data: horizontal ? labels.slice().reverse() : labels,
                axisLabel: { color: dim, fontFamily: font },
                axisLine: { lineStyle: { color: line } }, axisTick: { show: false } };
  const val = { type: "value", axisLabel: { color: dim, fontFamily: font },
                splitLine: { lineStyle: { color: line } }, minInterval: 1 };
  // Colours follow the term, not the bar position, so reversing the axis for a
  // horizontal layout must carry them along or a term changes colour with the
  // chart type.
  const paint = palette(labels.length, forPrint ? false : isDark());
  const ordered = horizontal ? values.slice().reverse() : values;
  const orderedPaint = horizontal ? paint.slice().reverse() : paint;
  const data = ordered.map((v, i) => ({
    value: v,
    itemStyle: { color: orderedPaint[i],
                 borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
  }));

  return {
    ...base,
    grid: { left: 8, right: 26, top: 16, bottom: 8, containLabel: true },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? cat : val,
    series: [{
      type: "bar",
      data,
      barMaxWidth: 26,
      label: { show: true, position: horizontal ? "right" : "top",
               color: dim, fontFamily: font, formatter: "{c}" },
    }],
  };
}

// Height grows with the number of bars so labels never collide, capped so the
// card stays a card.
const chartHeight = n => (n > 6 ? Math.min(420, Math.max(200, n * 22 + 56)) : 260);

// ECharts to a PNG data URI, for the PDF and Word reports. Rendered off-screen
// in print colours. `animation: false` is not optional, with it on, the export
// captures the first frame of the entrance animation, which is an empty grid.
function chartPNG(counts, type, w, h) {
  const box = document.createElement("div");
  box.style.cssText = `position:absolute;left:-10000px;top:0;width:${w}px;height:${h}px`;
  document.body.appendChild(box);
  const c = echarts.init(box, null, { renderer: "canvas" });
  try {
    c.setOption(chartOption(counts, type, true), true);
    return c.getDataURL({ pixelRatio: 2, backgroundColor: "#FFFFFF" });
  } finally {
    c.dispose();
    box.remove();
  }
}

window.addEventListener("DOMContentLoaded", () => {
    const $ = id => document.getElementById(id);
    const keywordTextarea = $("keywordsPaste");
    const keywordUploadInput = $("keywordUpload");
    const keywordSourceIndicator = $("keywordSourceIndicator");
    const docUploadInput = $("upload");

    // ---- theme --------------------------------------------------------------
    function applyTheme(mode) {
        document.documentElement.setAttribute("data-theme", mode);
        try { localStorage.setItem("theme", mode); } catch (e) { /* private mode */ }
        document.querySelectorAll("[data-theme-set]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.themeSet === mode));
        if (chartInstance) renderChart();
    }
    document.querySelectorAll("[data-theme-set]").forEach(b =>
        b.addEventListener("click", () => applyTheme(b.dataset.themeSet)));
    applyTheme(document.documentElement.getAttribute("data-theme") || "light");

    // ---- segmented controls -------------------------------------------------
    // One handler for both groups: click sets the active button within its own
    // .seg and runs the callback.
    function wireSeg(attr, onPick) {
        document.querySelectorAll(`[${attr}]`).forEach(btn => {
            btn.addEventListener("click", () => {
                btn.parentElement.querySelectorAll(".seg-btn")
                   .forEach(b => b.classList.toggle("is-active", b === btn));
                onPick(btn.getAttribute(attr));
            });
        });
    }
    wireSeg("data-view", v => { $("viewMode").value = v; renderOutput(); });
    wireSeg("data-chart", t => { currentChartType = t; renderChart(); });

    // Load state for the Documents card. A file input reports what it holds
    // only in tiny grey type the browser draws, and with several files it says
    // "3 files" and nothing about which. This says how many are staged and
    // lights up when any are.
    function refreshDocStatus() {
        const chip = $("docStatus");
        const n = docUploadInput.files.length;
        chip.dataset.state = n ? "loaded" : "empty";
        chip.textContent = n ? `${n} file${n === 1 ? "" : "s"} loaded` : "No files";
        chip.title = n ? [...docUploadInput.files].map(f => f.name).join(", ") : "";
    }

    // Warn immediately when a legacy .doc is selected. .docx, .pdf and plain
    // text all work; the pre-2007 binary .doc format does not.
    docUploadInput.addEventListener("change", () => {
        const docFiles = Array.from(docUploadInput.files).filter(
            f => f.name.toLowerCase().endsWith(".doc") && !f.name.toLowerCase().endsWith(".docx"));
        if (docFiles.length) {
            alert(
                "Legacy .doc format is not supported:\n\n  " +
                docFiles.map(f => f.name).join("\n  ") + "\n\n" +
                "Please re-save as .docx in Word:\nFile, Save As, Word Document (.docx)"
            );
            docUploadInput.value = "";
        }
        refreshDocStatus();
    });
    refreshDocStatus();

    loadDefaultKeywordList();
    $("reloadKeywords").addEventListener("click", loadDefaultKeywordList);

    function loadDefaultKeywordList() {
        fetch('keywords.txt?v=e0a7873b89')
        .then(response => response.text())
        .then(text => {
            keywordTextarea.value = text.trim();
            keywordUploadInput.value = "";
            const n = text.trim().split(/\r?\n/).filter(Boolean).length;
            keywordSourceIndicator.textContent = `Using the default list: ${n} terms.`;
        })
        .catch(err => {
            keywordSourceIndicator.textContent = "Could not load the default keyword list.";
            console.error("Default keyword list failed to load:", err);
        });
    }

    keywordUploadInput.addEventListener("change", async () => {
        const file = keywordUploadInput.files[0];
        if (!file) return;
        let text = "";
        try { text = await readOne(file); }
        catch (err) {
            keywordSourceIndicator.textContent = `Could not read ${file.name}.`;
            console.error("Keyword file failed to read:", err);
            return;
        }
        keywordTextarea.value = text.trim();
        keywordSourceIndicator.textContent = `Using uploaded list: ${file.name}`;
    });

    // The filter never re-rendered on change: picking a keyword did nothing
    // until some other control happened to fire renderOutput.
    $("filterKeyword").addEventListener("change", renderOutput);

    $("reset").addEventListener("click", () => {
        docUploadInput.value = "";
        keywordUploadInput.value = "";
        keywordTextarea.value = "";
        refreshDocStatus();
        $("output").innerHTML = "";
        $("chartCard").hidden = true;
        $("scrollPrompt").style.display = "none";
        if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
        lastParsedData = [];
        updateFilterOptions([]);
        $("viewMode").value = "file";
        document.querySelectorAll("[data-view]").forEach(b =>
            b.classList.toggle("is-active", b.dataset.view === "file"));
        loadDefaultKeywordList();
    });

    $("generate").addEventListener("click", async () => {
        await keywordSuggestionsLoaded;

        const generateBtn = $("generate");
        const output = $("output");
        const status = $("scrollPrompt");

        const keywordUpload = keywordUploadInput.files[0];
        let keywordText = "";
        if (keywordUpload) {
            try { keywordText = await readOne(keywordUpload); }
            catch (err) { alert(`Could not read the keyword file ${keywordUpload.name}.`); return; }
        } else {
            keywordText = keywordTextarea.value;
        }

        const keywordList = [...new Set(
            keywordText.split(/\r?\n/).map(k => k.trim()).filter(Boolean))];
        if (!keywordList.length) {
            alert("Please provide at least one keyword (upload a file or paste a list).");
            return;
        }

        const files = Array.from(docUploadInput.files);
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
                "Please re-save as .docx in Word:\nFile, Save As, Word Document (.docx)"
            );
            return;
        }

        // Every file is read and matched before anything renders. The previous
        // version rendered inside each FileReader callback, so with several
        // documents the chart and the summary raced each other and a partial
        // scan could be displayed as though it were the whole submission.
        output.innerHTML = "";
        status.style.display = "block";
        status.textContent = `Scanning ${files.length} ${files.length === 1 ? "file" : "files"}…`;
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
            status.style.display = "none";
            output.innerHTML = `<div class="scan-problem">${escapeHTML(problems.join(" ") || "Nothing to scan.")}</div>`;
            $("chartCard").hidden = true;
            updateFilterOptions([]);
            return;
        }

        const allKeywords = new Set();
        lastParsedData.forEach(f => Object.keys(f.summary).forEach(k => allKeywords.add(k)));
        updateFilterOptions([...allKeywords].sort());

        const totalHits = Object.values(keywordTotals(lastParsedData)).reduce((a, b) => a + b, 0);
        status.textContent = `${totalHits} match${totalHits === 1 ? "" : "es"} across ` +
            `${lastParsedData.length} ${lastParsedData.length === 1 ? "document" : "documents"}.`;

        renderChart();
        renderOutput();
        if (problems.length) {
            output.insertAdjacentHTML("afterbegin",
                `<div class="scan-problem">${escapeHTML(problems.join(" "))}</div>`);
        }
    });

    // ---- exports ------------------------------------------------------------
    function reportData() {
        const counts = keywordTotals(lastParsedData);
        return {
            counts,
            docs: lastParsedData.map(f => f.filename),
            parsed: lastParsedData,
            png: Object.keys(counts).length
                ? chartPNG(counts, currentChartType, 760, currentChartType === "pie" ? 480
                                                       : chartHeight(Object.keys(counts).length))
                : null,
        };
    }

    $("download-pdf").addEventListener("click", () => {
        if (!lastParsedData.length) { alert("Run a scan first. There is nothing to export yet."); return; }
        const { png, docs } = reportData();
        const win = window.open("", "_blank", "width=900,height=1000");
        const d = win.document;
        d.write(`<!DOCTYPE html><html><head><title>Keyword Summary</title><style>
          @page { margin: 0.5in; }
          body { font-family: Georgia, "Times New Roman", serif; color: #0B0E16; margin: 0;
                 font-size: 10.5pt; line-height: 1.45; }
          h1 { font-size: 17pt; margin: 0 0 2pt; }
          h2 { font-size: 12pt; margin: 14pt 0 4pt; border-bottom: 1px solid #D8DCE7; padding-bottom: 2pt; }
          .meta { color: #4A4F5E; font-size: 9pt; margin: 0 0 10pt; }
          /* The chart used to run 80% of the page width and pushed the findings
             onto a second sheet on its own. Half-width keeps it legible and
             leaves the top of page one for the summary that matters. */
          img { width: 3.4in; display: block; margin: 6pt 0 10pt; }
          ul { margin: 4pt 0 0; padding-left: 16pt; }
          li { margin-bottom: 2pt; page-break-inside: avoid; }
          .term { font-weight: bold; }
          .highlight { background: #FCE3B8; font-weight: bold; }
          .alts { color: #1E40AF; font-style: italic; }
          .sentence { color: #33384A; }
          .file-section { page-break-inside: auto; }
        </style></head><body>
          <h1>Keyword Summary Report</h1>
          <p class="meta">${escapeHTML(docs.join(", "))}, scanned ${escapeHTML(new Date().toLocaleDateString())}</p>
          ${png ? `<img src="${png}" alt="Match frequency by keyword">` : ""}
          ${$("output").innerHTML}
        </body></html>`);
        d.close();
        win.onload = () => win.print();
    });

    $("download-docx").addEventListener("click", () => {
        if (!lastParsedData.length) { alert("Run a scan first. There is nothing to export yet."); return; }
        const { png, parsed } = reportData();
        try {
            exportDocx({ parsed, png, filter: $("filterKeyword").value,
                         suggestions: keywordSuggestions });
        } catch (err) {
            console.error("Word export failed:", err);
            alert("Could not build the Word file. The PDF export still works.");
        }
    });

    function updateFilterOptions(keywordList) {
      const select = $("filterKeyword");
      const previous = select.value;
      select.innerHTML = `<option value="">(Show all)</option>`;
      keywordList.forEach(k => {
        const option = document.createElement("option");
        option.value = k;
        option.textContent = k;
        select.appendChild(option);
      });
      select.value = keywordList.includes(previous) ? previous : "";
    }

    function renderChart() {
        const card = $("chartCard"), el = $("chart");
        const counts = keywordTotals(lastParsedData);
        const n = Object.keys(counts).length;
        if (!n) {
            card.hidden = true;
            if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
            return;
        }
        card.hidden = false;
        el.style.height = `${currentChartType === "pie" ? 420 : chartHeight(n)}px`;
        // Disposed rather than reused: theme changes rewrite every colour in
        // the option, and setOption merges rather than replaces.
        if (chartInstance) chartInstance.dispose();
        chartInstance = echarts.init(el);
        chartInstance.setOption(chartOption(counts, currentChartType), true);
    }
    window.addEventListener("resize", () => chartInstance && chartInstance.resize());

    function renderOutput() {
        const output = $("output");
        output.innerHTML = "";

        const filter = $("filterKeyword").value;
        const viewMode = $("viewMode").value;

        const flagged = lastParsedData.reduce((n, f) => n + Object.keys(f.summary).length, 0);
        if (lastParsedData.length && !flagged) {
            output.innerHTML = `<div class="scan-clean"><strong>Clean draft.</strong> No keywords ` +
                `found in ${escapeHTML(lastParsedData.map(f => f.filename).join(", "))}.</div>`;
            return;
        }

        if (viewMode === "file") {
            lastParsedData.forEach(file => {
                const section = document.createElement("div");
                section.className = "file-section";
                section.innerHTML = `<h2>${escapeHTML(file.filename)}</h2>`;
                const summaryData = Object.entries(file.summary)
                    .filter(([k]) => !filter || k === filter)
                    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
                const resultData = file.results.filter(e => !filter || e.keyword === filter);
                section.innerHTML += renderSummary(file.filename, summaryData, resultData);
                output.appendChild(section);
            });
        } else {
            const combined = {};
            lastParsedData.forEach(file => {
                file.results.forEach(entry => {
                    if (!filter || entry.keyword === filter) {
                        (combined[entry.keyword] = combined[entry.keyword] || [])
                            .push({ ...entry, filename: file.filename });
                    }
                });
            });
            Object.keys(combined)
                .sort((a, b) => combined[b].length - combined[a].length || a.localeCompare(b))
                .forEach(keyword => {
                    const section = document.createElement("div");
                    section.className = "file-section";
                    section.innerHTML = `<h2>${escapeHTML(keyword)}</h2>` +
                        renderHits(keyword, combined[keyword], lastParsedData.length > 1);
                    output.appendChild(section);
                });
        }
    }

    function altsHTML(keyword) {
        const suggestions = keywordSuggestions[keyword.toLowerCase()] || [];
        if (!suggestions.length) {
            return `<p class="alts-none">No suggested alternative. This term is flagged for review, not for replacement.</p>`;
        }
        // The colon and the space are literal, not a CSS margin. The label gets
        // copied along with the text into an email or a Word file, where a
        // margin does not exist and the words run together.
        return `<p class="alts"><span class="alts-label">Consider:</span> ` +
               suggestions.map(s => `<span class="alt">${escapeHTML(s)}</span>`).join(", ") + `</p>`;
    }

    const sentenceHTML = (raw, keyword, filename) =>
        `<p class="sentence">${highlightTerm(raw, keyword)}` +
        (filename ? `<span class="sentence-doc">${escapeHTML(filename)}</span>` : "") + `</p>`;

    function renderSummary(filename, summaryData, resultData) {
        if (!summaryData.length) return `<p class="alts-none">No results in this file.</p>`;
        return `<div class="summary"><ul>` + summaryData.map(([keyword, hits]) => {
            const matches = resultData.filter(r => r.keyword.toLowerCase() === keyword.toLowerCase());
            const alts = keywordSuggestions[keyword.toLowerCase()] || [];
            return `<li class="term-hit${alts.length ? "" : " no-alt"}">
                <span class="term-hit-head">
                  <span class="term-name">${escapeHTML(keyword)}</span>
                  <span class="term-count">${hits.length} match${hits.length === 1 ? "" : "es"} ·
                    sentence${[...new Set(hits)].length === 1 ? "" : "s"} ${[...new Set(hits)].join(", ")}</span>
                </span>
                ${matches.map(m => sentenceHTML(m.raw, m.keyword)).join("")}
                ${altsHTML(keyword)}
            </li>`;
        }).join("") + `</ul></div>`;
    }

    function renderHits(keyword, hits, showFilenames) {
        const alts = keywordSuggestions[keyword.toLowerCase()] || [];
        return `<div class="results"><ul><li class="term-hit${alts.length ? "" : " no-alt"}">
            <span class="term-hit-head">
              <span class="term-count">${hits.length} match${hits.length === 1 ? "" : "es"}</span>
            </span>
            ${hits.map(h => sentenceHTML(h.raw, h.keyword, showFilenames ? h.filename : "")).join("")}
            ${altsHTML(keyword)}
        </li></ul></div>`;
    }

    // ---- tabs ---------------------------------------------------------------
    // Declared before the tab wiring below: the #terms deep-link clicks the tab
    // synchronously, and a `let` further down would still be in its temporal
    // dead zone when loadTerms reads it.
    let termsData = null;

    const TABS = [["tab-scan", "view-scan"], ["tab-terms", "view-terms"]];
    TABS.forEach(([tabId, viewId]) => {
        $(tabId).addEventListener("click", () => {
            TABS.forEach(([t, v]) => {
                const on = t === tabId;
                $(t).setAttribute("aria-selected", String(on));
                $(v).hidden = !on;
            });
            location.hash = viewId === "view-terms" ? "terms" : "scan";
            if (viewId === "view-terms") loadTerms();
            // ECharts sizes to a container that was display:none while hidden,
            // so a chart laid out on the terms tab comes back 0px wide.
            else if (chartInstance) chartInstance.resize();
        });
    });
    if (location.hash === "#terms") $("tab-terms").click();

    // ---- Terms to Use -------------------------------------------------------
    // Vocabulary agencies are rewarding. Fetched on first view rather than at
    // load, so someone who only ever scans a document never pays for it.
    async function loadTerms() {
        if (termsData) return;
        const list = $("termsList");
        try {
            termsData = await (await fetch("terms-to-use.json?v=fcfecd6078")).json();
        } catch (err) {
            console.error("terms-to-use.json failed to load:", err);
            list.innerHTML = `<div class="scan-problem">Could not load the terms list.</div>`;
            return;
        }
        const clusters = [...new Set(termsData.map(t => t.cluster).filter(Boolean))].sort();
        const select = $("termsCluster");
        clusters.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c; opt.textContent = c;
            select.appendChild(opt);
        });
        ["termsFilter", "termsCluster", "termsSort"].forEach(id =>
            $(id).addEventListener("input", renderTerms));
        renderTerms();
    }

    function renderTerms() {
        const list = $("termsList");
        const needle = $("termsFilter").value.trim().toLowerCase();
        const cluster = $("termsCluster").value;
        const sort = $("termsSort").value;

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

        $("termsCount").textContent = `${rows.length} of ${termsData.length} terms`;

        if (!rows.length) {
            list.innerHTML = `<div class="scan-clean">Nothing matches that filter.</div>`;
            return;
        }

        list.innerHTML = rows.map(t => {
            // No count means the term is not in the tracked set, which is not
            // the same as appearing zero times. Printing a phrase there read as
            // a score of zero, so the badge is simply absent instead.
            const counted = t.mentions !== null && t.mentions !== undefined;
            return `<div class="term-card">
                <h3><span>${escapeHTML(t.term)}</span>` +
                (t.cluster ? `<span class="term-cluster">${escapeHTML(t.cluster)}</span>` : "") +
                (counted ? `<span class="term-mentions">${t.mentions} mention${t.mentions === 1 ? "" : "s"}</span>` : "") +
                `</h3>
                <p class="term-why">${escapeHTML(t.why)}</p>
            </div>`;
        }).join("");
    }
});
