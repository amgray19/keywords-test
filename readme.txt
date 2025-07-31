Keyword Search Tool

This web application scans .docx files for specified keywords and generates a summary report with visual charts of keyword frequencies.

---

FEATURES

- Fully client-side processing (no files ever leave your computer)
- Supports multiple Word documents
- Upload or paste your own keyword list
- Download a sample keywords.txt for testing
- Bar and pie chart visualization
- Dark/light mode toggle
- Offline support with Service Worker caching
- Strict Content Security Policy for security

---

SECURITY

This tool is 100% client-side.

- Uploaded files are processed in your browser.
- No file content is sent to any server.
- Strict Content Security Policy prevents injection.
- Offline capability via Service Workers.

---

USAGE

1. Upload a .txt file of keywords (or paste keywords into the textarea).
2. If you don't have a list, download the sample keywords.txt file.
3. Upload one or more .docx files.
4. Click "Generate Summary".
5. Review results and charts.
6. Use "Print or Save Summary" to export a report.

---

DEVELOPMENT

Clone the repository:

git clone https://github.com/yourusername/keyword-search-tool.git

Serve locally (for example, with Python):

python3 -m http.server

Then visit:

http://localhost:8000

---

CONTENT SECURITY POLICY

<meta http-equiv="Content-Security-Policy"
      content="
        default-src 'self';
        script-src 'self' https://cdn.jsdelivr.net https://unpkg.com;
        style-src 'self' 'unsafe-inline';
        img-src 'self' data:;
        connect-src 'self';
        font-src 'self' https://fonts.googleapis.com;
        object-src 'none';
        base-uri 'self';
        form-action 'self';
      ">

---

LICENSE

MIT
