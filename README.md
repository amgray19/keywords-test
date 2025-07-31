# Keyword Search Tool

This web application scans `.docx` files for specified keywords and generates a summary report with visual charts of keyword frequencies.  
A default keyword list is pre-loaded, but you can upload your own or paste a custom list.

---

## ✨ Features

- Fully client-side processing (no files ever leave your computer)
- Supports multiple Word documents
- Pre-loaded keyword list with alternative suggestions
- Upload or paste your own keyword list
- Download a sample [keywords.txt](./keywords.txt) for testing
- Bar and pie chart visualization with Chart.js
- Dark/light mode toggle
- Offline support with Service Worker caching
- Strict Content Security Policy for security

---

## 🛡️ Security

**This tool is 100% client-side.**

- Uploaded files are processed in your browser.
- No file content is sent to any server.
- Strict Content Security Policy prevents injection.
- Offline capability via Service Workers.

---

## 🚀 Usage

1. Upload a `.txt` file of keywords (or paste keywords into the textarea).
2. If you don't have a list, [download the sample keywords.txt](./keywords.txt).
3. Upload one or more `.docx` files.
4. Click **Generate Summary**.
5. Review results, view charts, and see alternative keyword suggestions.
6. Use **Print or Save Summary** to export a report.

---

## 🛠️ Development

Clone the repository:

```bash
git clone https://github.com/yourusername/keyword-search-tool.git
```

Then open `index.html` in your browser or use a local server.
