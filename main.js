let lastParsedData = [];
let chartInstance = null;

document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("upload").value = "";
  document.getElementById("output").innerHTML = "";
  document.getElementById("chart").style.display = "none";
  lastParsedData = [];
});

document.getElementById("generate").addEventListener("click", () => {
  const output = document.getElementById("output");
  const chartEl = document.getElementById("chart");
  output.innerHTML = "";
  chartEl.style.display = "none";
  lastParsedData = [];

  const keywordList = document.getElementById("keywords").value
    .split(/\r?\n/)
    .map(k => k.trim())
    .filter(k => k);

  const files = document.getElementById("upload").files;
  if (!files.length) return alert("Please upload at least one .docx file.");

  const allMatches = {};

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const zip = new PizZip(e.target.result);
      const xml = zip.file("word/document.xml").asText();
      const doc = new DOMParser().parseFromString(xml, "application/xml");

      const paragraphs = Array.from(doc.getElementsByTagName("w:p")).map(p =>
        Array.from(p.getElementsByTagName("w:t")).map(t => t.textContent).join("")
      ).filter(Boolean);

      const summary = {};
      const results = [];

      paragraphs.forEach((text, idx) => {
        keywordList.forEach(keyword => {
          const regex = keyword.includes(" ")
            ? new RegExp("(" + keyword + ")", "gi")
            : new RegExp("\\b(" + keyword + ")\\b", "gi");
          if (regex.test(text)) {
            summary[keyword] = summary[keyword] || [];
            summary[keyword].push(idx + 1);
            const highlighted = text.replace(regex, "<span class='highlight'>$1</span>");
            results.push({ para: idx + 1, keyword, text: highlighted });
            allMatches[keyword] = (allMatches[keyword] || 0) + 1;
          }
        });
      });

      lastParsedData.push({ filename: file.name, summary, results });
      updateFilterOptions(keywordList);
      renderChart(allMatches);
      renderOutput();
    };
    reader.readAsArrayBuffer(file);
  });
});

function renderOutput() {
  const view = document.getElementById("view-mode").value;
  const filter = document.getElementById("keyword-filter").value;
  const container = document.getElementById("output");
  container.innerHTML = "";

  if (view === "file") {
    lastParsedData.forEach(file => {
      const section = document.createElement("div");
      section.className = "file-section";
      section.innerHTML = `<h2>Results for: ${file.filename}</h2>`;

      let summaryHTML = "<div class='summary'><h3>Summary</h3><ul>";
      Object.entries(file.summary).forEach(([k, v]) => {
        if (filter === "all" || filter === k) {
          summaryHTML += `<li>${k} — ${v.length} match(es) (Sentences ${[...new Set(v)].join(", ")})</li>`;
        }
      });
      summaryHTML += "</ul></div>";

      let resultsHTML = "<div class='results'><h3>Matched Sentences</h3>";
      file.results.forEach(r => {
        if (filter === "all" || r.keyword === filter) {
          resultsHTML += `<div class="result-sentence">Sentence ${r.para}: “${r.text}”</div>`;
        }
      });
      resultsHTML += "</div>";

      section.innerHTML += summaryHTML + resultsHTML;
      container.appendChild(section);
    });
  } else {
    const grouped = {};
    lastParsedData.forEach(file => {
      file.results.forEach(r => {
        if (filter === "all" || r.keyword === filter) {
          grouped[r.keyword] = grouped[r.keyword] || [];
          grouped[r.keyword].push({ ...r, file: file.filename });
        }
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

function updateFilterOptions(keywords) {
  const filter = document.getElementById("keyword-filter");
  filter.innerHTML = '<option value="all">All</option>';
  [...new Set(keywords)].forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    filter.appendChild(opt);
  });
}

function renderChart(data) {
  const ctx = document.getElementById("chart").getContext("2d");
  const labels = Object.keys(data);
  const counts = Object.values(data);

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Keyword Matches",
        data: counts,
        backgroundColor: "rgba(75,192,192,0.6)"
      }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });

  document.getElementById("chart").style.display = "block";
}

document.getElementById("view-mode").addEventListener("change", renderOutput);
document.getElementById("keyword-filter").addEventListener("change", renderOutput);

document.getElementById("download-pdf").addEventListener("click", () => {
  const el = document.getElementById("output");
  if (!el.innerHTML.trim()) return alert("Generate a summary first.");
  html2pdf().set({
    margin: 0.5,
    filename: "Keyword_Summary.pdf",
    html2canvas: { scale: 2 },
    jsPDF: { unit: "in", format: "letter", orientation: "portrait" }
  }).from(el).save();
});
