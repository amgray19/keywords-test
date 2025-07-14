// Theme setup
window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("theme") || "light";
  document.body.classList.add(`${saved}-mode`);
});

// Service Worker registration
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
    .then(reg => console.log("✅ Service Worker registered:", reg.scope))
    .catch(err => console.error("Service Worker registration failed:", err));
}

let chartInstance = null;
let lastParsedData = [];

// Theme toggle
document.getElementById("toggle-theme").addEventListener("click", () => {
  const current = localStorage.getItem("theme") || "light";
  const newMode = current === "dark" ? "light" : "dark";
  localStorage.setItem("theme", newMode);
  document.body.classList.remove("dark-mode", "light-mode");
  document.body.classList.add(`${newMode}-mode`);
  renderChart(document.getElementById("chartType").value);
});

// Reset
document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("upload").value = "";
  document.getElementById("keywordUpload").value = "";
  document.getElementById("keywordsPaste").value = "";
  document.getElementById("output").innerHTML = "";
  document.getElementById("chart").style.display = "none";
  document.getElementById("scrollPrompt").style.display = "none";
  if (chartInstance) chartInstance.destroy();
  chartInstance = null;
  lastParsedData = [];
  document.getElementById("filterKeyword").value = "";
  document.getElementById("viewMode").value = "file";
});

// Generate Summary
document.getElementById("generate").addEventListener("click", async () => {
  const output = document.getElementById("output");
  output.innerHTML = "";
  document.getElementById("scrollPrompt").style.display = "block";
  document.getElementById("scrollPrompt").textContent = "▼▼▼ Scroll Down for Summary Results ▼▼▼";
  lastParsedData = [];

  const keywordUpload = document.getElementById("keywordUpload").files[0];
  let keywordText = "";

  if (keywordUpload) {
    keywordText = await keywordUpload.text();
  } else {
    keywordText = document.getElementById("keywordsPaste").value;
  }

  const keywordList = keywordText.split(/\r?\n/).map(k => k.trim()).filter(k => k);
  if (!keywordList.length) {
    alert("Please provide at least one keyword (upload a file or paste).");
    return;
  }

  const files = document.getElementById("upload").files;
  if (!files.length) return alert("Please upload at least one .docx file.");

  const allKeywordsSet = new Set();
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const arrayBuffer = event.target.result;
      mammoth.extractRawText({ arrayBuffer }).then(result => {
        const text = result.value;
        const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

        const summary = {};
        const results = [];

        sentences.forEach((sentence, idx) => {
          keywordList.forEach(keyword => {
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = keyword.includes(" ")
              ? new RegExp("(" + escaped + ")", "gi")
              : new RegExp("\\b(" + escaped + ")\\b", "gi");

            if (regex.test(sentence)) {
              summary[keyword] = summary[keyword] || [];
              summary[keyword].push(idx + 1);
              const highlighted = sentence.replace(regex, "<span class='highlight'>$1</span>");
              results.push({ page: idx + 1, raw: sentence, html: highlighted, keyword });
              allKeywordsSet.add(keyword);
            }
          });
        });

        lastParsedData.push({ filename: file.name, summary, results });
        updateFilterOptions(Array.from(allKeywordsSet).sort());
        renderChart(document.getElementById("chartType").value);
        renderOutput();
      });
    };
    reader.readAsArrayBuffer(file);
  });
});

// Download PDF
document.getElementById("download-pdf").addEventListener("click", () => {
  renderChart(document.getElementById("chartType").value, true, () => {
    const chartCanvas = document.getElementById("chart");
    const chartImg = chartCanvas.toDataURL("image/png");

    const printWindow = window.open("", "_blank", "width=900,height=1000");
    const doc = printWindow.document;
    doc.write("<html><head><title>Keyword Summary</title><style>");
    doc.write("body { font-family: Arial; padding: 2em; color: #000; background: #fff; }");
    doc.write("img { width: 80%; max-width: 600px; display: block; margin: 2em auto 1em auto; }");
    doc.write(".highlight { background: yellow; font-weight: bold; color: red; }");
    doc.write("</style></head><body>");
    doc.write("<h1>Keyword Summary Report</h1>");
    doc.write(`<img src="${chartImg}" alt="Chart">`);
    doc.write(document.getElementById("output").innerHTML);
    doc.write("</body></html>");
    doc.close();
    printWindow.onload = () => printWindow.print();
  });
});

// Filter options
function updateFilterOptions(keywordList) {
  const select = document.getElementById("filterKeyword");
  select.innerHTML = `<option value="">(Show All Keywords)</option>`;
  keywordList.forEach(k => {
    const option = document.createElement("option");
    option.value = k;
    option.textContent = k;
    select.appendChild(option);
  });
}

// Chart events
document.getElementById("chartType").addEventListener("change", e => renderChart(e.target.value));
document.getElementById("filterKeyword").addEventListener("change", renderOutput);
document.getElementById("viewMode").addEventListener("change", renderOutput);

// Render Chart
function renderChart(type, forceLightMode = false, onComplete = null) {
  if (!lastParsedData.length) return;
  const ctx = document.getElementById("chart").getContext("2d");
  const chartCanvas = document.getElementById("chart");
  chartCanvas.style.display = "block";
  chartCanvas.style.border = "1px solid #ccc";
  chartCanvas.height = 500;

  if (chartInstance) chartInstance.destroy();

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
  const actualType = type === "bar" && keywords.length > 6 ? "bar" : type;
  const indexAxis = actualType === "bar" && keywords.length > 6 ? "y" : "x";
  const isDark = forceLightMode ? false : document.body.classList.contains("dark-mode");
  const backgroundColor = keywords.map((_, i) => `hsl(${(360 * i / keywords.length)}, 80%, 75%)`);
  const borderColor = actualType === "bar" || actualType === "pie" ? (isDark ? "#fff" : "#000") : null;

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
          anchor: actualType === "pie" ? "end" : "end",
          align: actualType === "pie" ? "end" : "right",
          offset: actualType === "pie" ? 8 : 0,
          font: { weight: "bold" },
          formatter: (value, ctx) => {
            const sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
            const percent = (value / sum) * 100;
            return percent < 5 ? "" : `${value} (${percent.toFixed(1)}%)`;
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

// Render Output
function renderOutput() {
  const output = document.getElementById("output");
  output.innerHTML = "";
  const filter = document.getElementById("filterKeyword").value;
  const viewMode = document.getElementById("viewMode").value;

  if (viewMode === "file") {
    lastParsedData.forEach(file => {
      const section = document.createElement("div");
      section.classList.add("file-section");
      section.innerHTML = `<h2>Results for: ${file.filename}</h2>`;
      const summaryData = Object.entries(file.summary).filter(([k]) => !filter || k === filter);
      const resultData = file.results.filter(entry => !filter || entry.keyword === filter);
      section.innerHTML += renderSummary(summaryData);
      section.innerHTML += renderResults(resultData);
      output.appendChild(section);
    });
  } else if (viewMode === "keyword") {
    const combined = {};
    lastParsedData.forEach(file => {
      file.results.forEach(entry => {
        if (!filter || entry.keyword === filter) {
          if (!combined[entry.keyword]) combined[entry.keyword] = [];
          combined[entry.keyword].push(entry);
        }
      });
    });

    Object.keys(combined).sort().forEach(keyword => {
      const section = document.createElement("div");
      section.classList.add("file-section");
      section.innerHTML = `<h2>Results for Keyword: ${keyword}</h2>`;
      section.innerHTML += renderResults(combined[keyword]);
      output.appendChild(section);
    });
  }
}

function renderSummary(summaryData) {
  if (!summaryData.length) {
    return "<div class='summary'><h3>Summary</h3><p>No results found.</p></div>";
  }
  let html = "<div class='summary'><h3>Summary</h3><ul>";
  summaryData.forEach(([keyword, pages]) => {
    html += `<li><strong>${keyword}</strong> — ${pages.length} match(es) (Sentences ${[...new Set(pages)].join(", ")})</li>`;
  });
  html += "</ul></div>";
  return html;
}

function renderResults(resultData) {
  if (!resultData.length) return "";
  let html = "<div class='results'><h3>Matched Sentences</h3><ul>";
  resultData.forEach(entry => {
    html += `<li><strong>Sentence ${entry.page}:</strong> “${entry.html}”</li>`;
  });
  html += "</ul></div>";
  return html;
}
