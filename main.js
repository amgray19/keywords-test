// Global setup
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

window.addEventListener("DOMContentLoaded", () => {
    const keywordTextarea = document.getElementById("keywordsPaste");
    const keywordUploadInput = document.getElementById("keywordUpload");
    const keywordSourceIndicator = document.getElementById("keywordSourceIndicator");
    const reloadKeywordsBtn = document.getElementById("reloadKeywords");
    const toggleTheme = document.getElementById("toggle-theme");
    const viewToggle = document.getElementById("viewModeToggle");
    const viewHidden = document.getElementById("viewMode");
    const chartTypeToggle = document.getElementById("chartTypeToggle");
    
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
    
    // Keyword reload
    reloadKeywordsBtn?.addEventListener("click", loadDefaultKeywordList);
    
    function loadDefaultKeywordList() {
        fetch('keywords.txt')
        .then(response => response.text())
        .then(text => {
            keywordTextarea.value = text.trim();
            keywordUploadInput.value = "";
            keywordSourceIndicator.textContent = "Using default keyword list.";
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
        if (file.name.endsWith(".docx")) {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            text = result.value;
        } else {
            text = await file.text();
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
        
        const output = document.getElementById("output");
        output.innerHTML = "";
        document.getElementById("scrollPrompt").style.display = "block";
        document.getElementById("scrollPrompt").textContent = "▼▼▼ Scroll Down for Summary Results ▼▼▼";
        lastParsedData = [];
        
        const keywordUpload = keywordUploadInput.files[0];
        let keywordText = "";
        
        if (keywordUpload && keywordUpload.name.endsWith(".docx")) {
            const arrayBuffer = await keywordUpload.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            keywordText = result.value;
        } else if (keywordUpload) {
            keywordText = await keywordUpload.text();
        } else {
            keywordText = keywordTextarea.value;
        }
        
        const keywordList = keywordText.split(/\r?\n/).map(k => k.trim()).filter(k => k);
        if (!keywordList.length) {
            alert("Please provide at least one keyword (upload a file or paste).");
            return;
        }
        
        const files = document.getElementById("upload").files;
        if (!files.length) {
            alert("Please upload at least one .docx file.");
            return;
        }
        
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
                    if (typeof updateFilterOptions === "function") {
                        updateFilterOptions(Array.from(allKeywordsSet).sort());
                    }
                    renderChart(currentChartType, false);
                    renderOutput();
                });
            };
            reader.readAsArrayBuffer(file);
        });
    });
    
    document.getElementById("download-pdf").addEventListener("click", () => {
        renderChart(currentChartType, true, () => {
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
    
    document.getElementById("viewModeToggle").addEventListener("change", (e) => {
        document.getElementById("viewMode").value = e.target.checked ? "keyword" : "file";
        renderOutput();
    });
    
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
    
    function renderChart(type, forceLightMode = false, onComplete = null) {
        if (!lastParsedData.length) {
            const canvas = document.getElementById("chart");
            canvas.style.display = "none";
            return;
        }
        
        const ctx = document.getElementById("chart").getContext("2d");
        const chartCanvas = document.getElementById("chart");
        chartCanvas.style.display = "block";
        chartCanvas.style.backgroundColor = document.body.classList.contains("dark-mode") ? "#000" : "#fff";
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

        if (viewMode === "file") {
            lastParsedData.forEach(file => {
                const section = document.createElement("div");
                section.classList.add("file-section");
                section.innerHTML = `<h2>Results for: ${file.filename}</h2>`;
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
    
    function renderSummary(filename, summaryData, resultData) {
        if (!summaryData.length) {
            return `<div class='summary'><h3>Summary for ${filename}</h3><p>No results found.</p></div>`;
        }
        let html = `<div class='summary'><h3>Summary for ${filename}</h3><ul>`;
        summaryData.forEach(([keyword, pages]) => {
            html += `<li><strong>"${keyword}"</strong> — ${pages.length} match(es) (Sentence${pages.length > 1 ? "s" : ""} ${[...new Set(pages)].join(", ")})`;
            
            const allMatches = resultData.filter(r => r.keyword.toLowerCase() === keyword.toLowerCase());
            if (allMatches.length) {
                html += `<div style="margin-left: 1.5em; margin-top: 0.3em;">Results:</div><ul style="margin-left: 2.5em;">`;
                allMatches.forEach(match => {
                    html += `<li style="margin-bottom: 0.3em;">“${match.html}”</li>`;
                });
                html += `</ul>`;
            }
            
            const suggestions = keywordSuggestions[keyword.toLowerCase()] || [];
            if (suggestions.length > 0) {
                html += `<div style="margin-left: 1.5em; font-style: italic; font-weight: bold; color: #3b8ed9; margin-top: 0.5em;">Suggested alternatives for "<strong>${keyword}:</strong>"</div>`;
                html += `<ol style="margin-left: 3em; margin-top: 0.25em; margin-bottom: 0.5em; color: #3b8ed9; font-style: italic;">`;
                suggestions.forEach(s => {
                    html += `<li>"${s}"</li>`;
                });
                html += `</ol>`;
            }
            else {
                html += `<div class="suggested-alternatives" style="margin-left: 1.5em; font-style: italic; font-weight: bold; color: #3b8ed9; margin-bottom: 1em;">No suggested alternatives for "<strong>${keyword}.</strong>"</div>`;
            }
            
            html += `</li>`;
        });
        html += "</ul></div>";
        return html;
    }
    
    function renderResults(resultData) {
        if (!resultData.length) return "";
        let html = "<div class='results'><h3>Matched Sentences</h3><ul>";
        resultData.forEach(entry => {
            const keyword = entry.keyword.toLowerCase();
            const suggestions = keywordSuggestions[keyword] || [];
            html += `<li><strong>Sentence ${entry.page}:</strong> “${entry.html}”`;
            
            if (suggestions.length > 0) {
                html += `<div style="margin-left: 1.5em; font-style: italic; font-weight: bold; color: #3b8ed9; margin-top: 0.5em;">Suggested alternatives for "<strong>${entry.keyword}</strong>":</div>`;
                html += `<ol style="margin-left: 3em; margin-top: 0.25em; margin-bottom: 0.5em; color: #3b8ed9; font-style: italic;">`;
                suggestions.forEach(s => {
                    html += `<li>"${s}"</li>`;
                });
                html += `</ol>`;
            } else {
                html += `<div style="margin-left: 1.5em; font-style: italic; font-weight: bold; color: #3b8ed9;">No suggested alternatives for "<strong>${entry.keyword}</strong>."</div>`;
            }
            
            html += `</li>`;
        });
        html += "</ul></div>";
        return html;
    }
});
