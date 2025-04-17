// Enhanced version — shows suggestions at the end of each sentence in bold blue

// Load keyword suggestions
let keywordSuggestions = {};
if (typeof keywordsWithSuggestions !== 'undefined') {
  keywordsWithSuggestions.forEach(entry => {
    keywordSuggestions[entry.term.toLowerCase()] = entry.suggestions;
  });
}

// [INSERT YOUR ORIGINAL main.js CODE HERE]
// (This assumes you already have the logic for parsing .docx files and inserting <p> or <li> elements into #output)


// Create styled suggestion span
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

// Append suggestions at end of sentence (if keyword is in that sentence)
const outputEl = document.getElementById("output");
if (outputEl) {
  const observer = new MutationObserver(() => {
    const sentences = outputEl.querySelectorAll("p, li");
    sentences.forEach(sentenceEl => {
      if (sentenceEl.dataset.suggestionsAppended) return;

      const text = sentenceEl.innerText.toLowerCase();
      let foundTerm = null;

      for (const term in keywordSuggestions) {
        if (text.includes(term)) {
          foundTerm = term;
          break;
        }
      }

      if (foundTerm) {
        const suggestionSpan = createSuggestionSpan(foundTerm);
        if (suggestionSpan) {
          sentenceEl.appendChild(suggestionSpan);
        }
      }

      sentenceEl.dataset.suggestionsAppended = "true";
    });
  });
  observer.observe(outputEl, { childList: true, subtree: true });
}
