// v1.1.1-safe — PDF works, Word export temporarily disabled due to docx.js MIME issue

document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("upload").value = "";
  document.getElementById("output").innerHTML = "";
});

let lastParsedData = []; // Cache parsed results for export

document.getElementById("generate").addEventListener("click", () => {
  const output = document.getElementById("output");
  output.innerHTML = "";
  lastParsedData = [];

  const keywordList = document.getElementById("keywords").value
    .split(/\r?\n/)
    .map(k => k.trim().toLowerCase())
    .filter(k => k);

  const files = document.getElementById("upload").files;

  if (!files.length) {
    alert("Please upload at least one .docx file.");
    return;
  }

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const zip = new PizZip(e.target.result);
        const doc = new window.docxtemplater.DocUtils().getFullText(zip);
        const paragraphs = doc.split(/\\r\\n|\\n|\\r/).filter(Boolean);

        const container = document.createElement("div");
        container.className = "file-section";

        const heading = document.createElement("h3");
        heading.textContent = `Results for: ${file.name}`;
        container.appendChild(heading);

        paragraphs.forEach(p => {
          const lowerP = p.toLowerCase();
          const matchedTerms = keywordList.filter(k =>
            new RegExp("\\b" + k + "\\b", "i").test(lowerP)
          );
          if (matchedTerms.length === 0) return;

          const para = document.createElement("p");

          let highlighted = p;
          matchedTerms.forEach(term => {
            const regex = new RegExp("\\b(" + term + ")\\b", "gi");
            highlighted = highlighted.replace(
              regex,
              '<span class="highlight">$1</span>'
            );
          });

          para.innerHTML = highlighted;
          container.appendChild(para);

          lastParsedData.push({
            filename: file.name,
            sentence: p,
            matches: matchedTerms
          });
        });

        output.appendChild(container);
      } catch (err) {
        console.error("Error reading docx file:", err);
        alert("There was an error processing the Word file.");
      }
    };
    reader.readAsBinaryString(file);
  });
});

// === INLINE SUGGESTIONS FOR MATCHED SENTENCES ONLY (STABLE VERSION) ===

let keywordSuggestions = {};
if (typeof keywordsWithSuggestions !== 'undefined') {
  keywordsWithSuggestions.forEach(entry => {
    keywordSuggestions[entry.term.toLowerCase()] = entry.suggestions;
  });
}

function createSuggestionSpan(term) {
  const suggestions = keywordSuggestions[term.toLowerCase()];
  if (!suggestions || !suggestions.length) return null;
  const span = document.createElement('span');
  span.className = 'suggestion-inline';
  span.style.fontWeight = 'bold';
  span.style.color = 'blue';
  span.style.marginLeft = '0.5em';
  span.textContent = "(Suggested: " + suggestions.join(", ") + ")";
  return span;
}

const outputEl = document.getElementById("output");
if (outputEl) {
  const observer = new MutationObserver(() => {
    const matchedSentences = new Set();

    document.querySelectorAll("#output .highlight").forEach(highlightEl => {
      const keyword = highlightEl.textContent.trim().toLowerCase();
      const sentence = highlightEl.closest("p, li");

      if (!sentence || matchedSentences.has(sentence)) return;

      const suggestionSpan = createSuggestionSpan(keyword);
      if (suggestionSpan) {
        sentence.appendChild(suggestionSpan);
        matchedSentences.add(sentence);
      }

      highlightEl.dataset.suggestionAppended = "true";
    });
  });

  observer.observe(outputEl, { childList: true, subtree: true });
}
