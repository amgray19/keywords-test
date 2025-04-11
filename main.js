
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

  const keywords = document.getElementById("keywords").value.split(/\r?\n/).map(k => k.trim()).filter(k => k);
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
          const regex = keyword.includes(" ")
            ? new RegExp("(" + keyword + ")", "gi")
            : new RegExp("\b(" + keyword + ")\b", "gi");
          if (regex.test(text)) {
            allMatches[keyword] = (allMatches[keyword] || 0) + 1;
            const highlighted = text.replace(regex, "<span class='highlight'>$1</span>");
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
      if (chartInstance) chartInstance.destroy();
      chartInstance = new Chart(chartEl, {
        type: chartType,
        data: {
          labels: Object.keys(allMatches),
          datasets: [{
            label: "Keyword Matches",
            data: Object.values(allMatches),
            backgroundColor: "rgba(75,192,192,0.6)"
          }]
        },
        options: {
          responsive: true,
          scales: { y: { beginAtZero: true } }
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
