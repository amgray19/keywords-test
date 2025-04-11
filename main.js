let chartInstance = null;

document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("upload").value = "";
  document.getElementById("output").innerHTML = "";
  document.getElementById("chart").getContext("2d").clearRect(0, 0, 400, 200);
  chartInstance = null;
});

document.getElementById("generate").addEventListener("click", () => {
  const output = document.getElementById("output");
  output.innerHTML = "";
  const chartEl = document.getElementById("chart").getContext("2d");

  const keywords = document.getElementById("keywords").value
    .split(/\r?\n/)
    .map(k => k.trim())
    .filter(k => k);

  // Sort by longest first
  keywords.sort((a, b) => b.length - a.length);

  const files = document.getElementById("upload").files;
  if (!files.length) return alert("Please upload at least one .docx file.");

  const allMatches = {};
  let fullSummary = "";

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const zip = new PizZip(e.target.result);
      const xml = zip.file("word/document.xml").asText();
      const doc = new DOMParser().parseFromString(xml, "application/xml");

      const paragraphs = Array.from(doc.getElementsByTagName("w:p")).map(p =>
        Array.from(p.getElementsByTagName("w:t")).map(t => t.textContent).join("")
      ).filter(Boolean);

      const results = [];

      paragraphs.forEach((text, idx) => {
        keywords.forEach(keyword => {
          const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          // Use word boundary for single words, loose match for phrases
          const isPhrase = keyword.includes(" ");
          const regex = isPhrase
            ? new RegExp("(" + escaped + ")", "gi")
            : new RegExp("\\b(" + escaped + ")\\b", "gi");

          if (regex.test(text)) {
            allMatches[keyword] = (allMatches[keyword] || 0) + 1;
            const highlighted = text.replace(regex, '<span class="highlight">$1</span>');
            results.push(`Sentence ${idx + 1}: “${highlighted}”`);
          }
        });
      });

      fullSummary += `<div class='file-section'><h2>Results for: ${file.name}</h2><ul>`;
      Object.entries(allMatches).forEach(([k, v]) => {
        fullSummary += `<li>${k} — ${v} match(es)</li>`;
      });
      fullSummary += "</ul><div>" + results.join("<br>") + "</div></div>";

      const chartType = document.getElementById("chart-type").value || "bar";
      const labels = Object.keys(allMatches);
      const values = Object.values(allMatches);
      const total = values.reduce((a, b) => a + b, 0);

      const tooltipLabels = (ctx) => {
        const label = ctx.label;
        const count = ctx.raw;
        const percent = ((count / total) * 100).toFixed(1);
        return `${label}: ${count} (${percent}%)`;
      };

      if (chartInstance) chartInstance.destroy();
      chartInstance = new Chart(chartEl, {
        type: chartType,
        data: {
          labels,
          datasets: [{
            label: "Keyword Matches",
            data: values,
            backgroundColor: labels.map((_, i) =>
              `hsl(${i * 360 / labels.length}, 70%, 60%)`)
          }]
        },
        options: {
          responsive: true,
          plugins: {
            tooltip: {
              callbacks: {
                label: tooltipLabels
              }
            }
          },
          scales: chartType === "bar" ? { y: { beginAtZero: true } } : {}
        }
      });

      output.innerHTML += fullSummary;
    };
    reader.readAsArrayBuffer(file);
  });
});

document.getElementById("download-pdf").addEventListener("click", () => {
  const el = document.getElementById("output");
  const chartImage = new Image();
  chartImage.src = chartInstance.toBase64Image();
  chartImage.style.maxWidth = "6.5in";
  chartImage.style.display = "block";
  chartImage.style.marginBottom = "1em";
  el.prepend(chartImage);

  html2pdf().set({
    margin: 0.5,
    filename: "Keyword_Summary_With_Chart.pdf",
    html2canvas: { scale: 2 },
    jsPDF: { unit: "in", format: "letter", orientation: "portrait" }
  }).from(el).save();
});

document.getElementById("chart").addEventListener("click", () => {
  if (!chartInstance) return;
  const chartImg = chartInstance.toBase64Image();
  const newWin = window.open("");
  newWin.document.write("<img src='" + chartImg + "' style='width:100%;'>");
});

document.getElementById("chart-type").addEventListener("change", () => {
  document.getElementById("generate").click();
});
