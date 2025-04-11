let chartInstance = null;
let lastParsedData = [];

// ✅ Configurable threshold for switching to horizontal bar
const HORIZONTAL_CHART_THRESHOLD = 6;

document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("upload").value = "";
  document.getElementById("output").innerHTML = "";
  document.getElementById("chart").getContext("2d").clearRect(0, 0, 400, 200);
  if (chartInstance) chartInstance.destroy();
  chartInstance = null;
  lastParsedData = [];
});

document.getElementById("generate").addEventListener("click", () => {
  const output = document.getElementById("output");
  output.innerHTML = "";
  const chartEl = document.getElementById("chart").getContext("2d");

  const keywords = document.getElementById("keywords").value
    .split(/\r?\n/)
    .map(k => k.trim())
    .filter(k => k);
  keywords.sort((a, b) => b.length - a.length);

  const files = document.getElementById("upload").files;
  if (!files.length) return alert("Please upload at least one .docx file.");

  const allMatches = {};
  lastParsedData = [];

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const zip = new PizZip(e.target.result);
      const xml = zip.file("word/document.xml").asText();
      const doc = new DOMParser().parseFromString(xml, "application/xml");

      const paragraphs = Array.from(doc.getElementsByTagName("w:p")).map(p =>
        Array.from(p.getElementsByTagName("w:t")).map(t => t.textContent).join("")
      ).filter(Boolean);

      const summary = {};
      const results = [];

      paragraphs.forEach((text, idx) => {
        keywords.forEach(keyword => {
          const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const isPhrase = keyword.includes(" ");
          const regex = isPhrase
            ? new RegExp("(" + escaped + ")", "gi")
            : new RegExp("\\b(" + escaped + ")\\b", "gi");

          if (regex.test(text)) {
            summary[keyword] = summary[keyword] || [];
            summary[keyword].push(idx + 1);
            allMatches[keyword] = (allMatches[keyword] || 0) + 1;
            const highlighted = text.replace(regex, "<span class='highlight'>$1</span>");
            results.push({ para: idx + 1, keyword, text: highlighted, raw: text, file: file.name });
          }
        });
      });

      lastParsedData.push({ filename: file.name, summary, results });
      renderChart(allMatches);
      renderOutput();
    };
    reader.readAsArrayBuffer(file);
  });
});

function renderOutput() {
  const view = document.getElementById("view-mode").value;
  const container = document.getElementById("output");
  container.innerHTML = "";

  if (view === "file") {
    lastParsedData.forEach(file => {
      const section = document.createElement("div");
      section.className = "file-section";
      section.innerHTML = `<h2>Results for: ${file.filename}</h2>`;

      let summaryHTML = "<div class='summary'><h3>Summary</h3><ul>";
      Object.entries(file.summary).forEach(([k, v]) => {
        summaryHTML += `<li>${k} — ${v.length} match(es) (Sentences ${[...new Set(v)].join(", ")})</li>`;
      });
      summaryHTML += "</ul></div>";

      let resultsHTML = "<div class='results'><h3>Matched Sentences</h3>";
      file.results.forEach(entry => {
        resultsHTML += `<div class="result-sentence">Sentence ${entry.para}: “${entry.text}”</div>`;
      });
      resultsHTML += "</div>";

      section.innerHTML += summaryHTML + resultsHTML;
      container.appendChild(section);
    });
  } else {
    const grouped = {};
    lastParsedData.forEach(file => {
      file.results.forEach(entry => {
        grouped[entry.keyword] = grouped[entry.keyword] || [];
        grouped[entry.keyword].push(entry);
      });
    });

    Object.entries(grouped).forEach(([keyword, entries]) => {
      const section = document.createElement("div");
      section.className = "file-section";
      section.innerHTML = `<h2>Keyword: ${keyword}</h2>`;
      entries.forEach(r => {
        section.innerHTML += `<div class="result-sentence">${r.file} — Sentence ${r.para}: “${r.text}”</div>`;
      });
      container.appendChild(section);
    });
  }
}

function renderChart(data) {
  const ctx = document.getElementById("chart").getContext("2d");
  const labels = Object.keys(data);
  const counts = Object.values(data);
  const total = counts.reduce((a, b) => a + b, 0);
  const typeChoice = document.getElementById("chart-type").value || "bar";
  const useHorizontal = typeChoice === "bar" && labels.length > HORIZONTAL_CHART_THRESHOLD;

  if (chartInstance) chartInstance.destroy();

  // Ensure chart title is always present (only once)
  const titleEl = document.getElementById("chart-title");
  if (!titleEl) {
    const chartTitle = document.createElement("h3");
    chartTitle.textContent = "Found Keyword Instances";
    chartTitle.id = "chart-title";
    chartTitle.style.marginTop = "1em";
    chartTitle.style.marginBottom = "0.5em";
    const canvas = document.getElementById("chart");
    canvas.before(chartTitle);
  }

  chartInstance = new Chart(ctx, {
    type: typeChoice,
    data: {
      labels,
      datasets: [{
        label: "Keyword Matches",
        data: counts,
        backgroundColor: labels.map((_, i) =>
          `hsl(${i * 360 / labels.length}, 70%, 60%)`)
      }]
    },
    options: {
      responsive: true,
      indexAxis: useHorizontal ? 'y' : 'x',
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => {
              const label = ctx.label;
              const count = ctx.raw;
              const percent = ((count / total) * 100).toFixed(1);
              return `${label}: ${count} (${percent}%)`;
            }
          }
        },
        legend: {
          display: typeChoice === "pie"
        }
      },
      scales: typeChoice === "bar" ? { y: { beginAtZero: true } } : {}
    }
  });
}

document.getElementById("chart").addEventListener("click", () => {
  if (!chartInstance) return;
  const chartImg = chartInstance.toBase64Image();
  const newWin = window.open("");
  newWin.document.write("<img src='" + chartImg + "' style='width:100%;'>");
});

document.getElementById("chart-type").addEventListener("change", () => {
  document.getElementById("generate").click();
});

document.getElementById("view-mode").addEventListener("change", () => {
  renderOutput();
});

document.getElementById("download-pdf").addEventListener("click", () => {
  const outputEl = document.getElementById("output");

  const chartImage = new Image();
  chartImage.src = chartInstance.toBase64Image();
  chartImage.style.width = "100%";
  chartImage.style.maxWidth = "6.5in";
  chartImage.style.display = "block";
  chartImage.style.marginTop = "1em";
  chartImage.style.marginBottom = "1em";

  const chartTitle = document.createElement("h3");
  chartTitle.textContent = "Found Keyword Instances";
  chartTitle.style.marginTop = "1em";
  chartTitle.style.marginBottom = "0.5em";

  const container = document.createElement("div");
  container.innerHTML = outputEl.innerHTML;
  container.appendChild(chartTitle);
  container.appendChild(chartImage);

  html2pdf().set({
    margin: 0.5,
    filename: "Keyword_Summary_With_Chart.pdf",
    html2canvas: { scale: 2 },
    jsPDF: { unit: "in", format: "letter", orientation: "portrait" }
  }).from(container).save();
});
