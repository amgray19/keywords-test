// Word (.docx) export, no dependencies.
//
// A .docx is a ZIP of XML parts. Writing one by hand is a store-only zip (no
// compression, so no deflate implementation is needed) plus four small XML
// files and the chart PNG. Word opens store-only archives without complaint.
//
// The alternative, serving HTML as application/msword, produces a file Word
// renders but that is not a .docx, warns on open in current versions, and
// cannot carry an embedded image reliably. This is a real one.

(function (global) {
  "use strict";

  const EMU_PER_INCH = 914400;
  const TWIPS_PER_INCH = 1440;
  const PAGE_MARGIN_IN = 0.5;      // matches the PDF export
  const CHART_WIDTH_IN = 3.4;      // half-width: the chart informs, it is not the report

  // ---- zip ----------------------------------------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const utf8 = s => new TextEncoder().encode(s);

  // Store-only ZIP. Entries are {name, bytes}.
  function zip(entries) {
    const chunks = [], central = [];
    let offset = 0;

    const num = (v, n) => {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (v >>> (i * 8)) & 0xFF;
      return b;
    };
    const push = (arr, ...parts) => parts.forEach(p => arr.push(p));

    for (const { name, bytes } of entries) {
      const nameBytes = utf8(name);
      const crc = crc32(bytes);
      // Local file header. Zero date/time: a deterministic archive is easier to
      // diff, and Word does not care.
      const local = [];
      push(local, num(0x04034b50, 4), num(20, 2), num(0, 2), num(0, 2),
                  num(0, 2), num(0, 2), num(crc, 4),
                  num(bytes.length, 4), num(bytes.length, 4),
                  num(nameBytes.length, 2), num(0, 2), nameBytes, bytes);
      const localSize = local.reduce((n, p) => n + p.length, 0);
      chunks.push(...local);

      push(central, num(0x02014b50, 4), num(20, 2), num(20, 2), num(0, 2),
                    num(0, 2), num(0, 2), num(0, 2), num(crc, 4),
                    num(bytes.length, 4), num(bytes.length, 4),
                    num(nameBytes.length, 2), num(0, 2), num(0, 2),
                    num(0, 2), num(0, 2), num(0, 4), num(offset, 4), nameBytes);
      offset += localSize;
    }

    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = [];
    push(end, num(0x06054b50, 4), num(0, 2), num(0, 2),
              num(entries.length, 2), num(entries.length, 2),
              num(centralSize, 4), num(offset, 4), num(0, 2));

    const all = [...chunks, ...central, ...end];
    const total = all.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }

  // ---- helpers ------------------------------------------------------------
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

  function dataUriToBytes(uri) {
    const b64 = uri.slice(uri.indexOf(",") + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // PNG dimensions live in the IHDR chunk, big-endian at bytes 16..23. Read
  // them rather than assuming, so the aspect ratio survives a chart that grew
  // taller with more bars.
  function pngSize(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }

  // A run of text. `opts` covers the handful of styles the report needs.
  function run(text, opts = {}) {
    const props = [
      opts.bold ? "<w:b/>" : "",
      opts.italic ? "<w:i/>" : "",
      opts.size ? `<w:sz w:val="${opts.size * 2}"/><w:szCs w:val="${opts.size * 2}"/>` : "",
      opts.color ? `<w:color w:val="${opts.color}"/>` : "",
      opts.highlight ? `<w:highlight w:val="${opts.highlight}"/>` : "",
    ].join("");
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}` +
           `<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }

  const para = (runs, opts = {}) => {
    const props = [
      opts.spaceBefore || opts.spaceAfter
        ? `<w:spacing${opts.spaceBefore ? ` w:before="${opts.spaceBefore}"` : ""}` +
          `${opts.spaceAfter ? ` w:after="${opts.spaceAfter}"` : ""}/>`
        : "",
      opts.indent ? `<w:ind w:left="${opts.indent}"/>` : "",
      opts.border ? `<w:pBdr><w:left w:val="single" w:sz="12" w:space="6" w:color="D8DCE7"/></w:pBdr>` : "",
      opts.keepNext ? "<w:keepNext/>" : "",
    ].join("");
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;
  };

  // A matched sentence, with every occurrence of the term highlighted. Same
  // segment-by-segment assembly the page uses, for the same reason: splitting
  // on the match keeps the surrounding text intact.
  function sentenceRuns(sentence, keyword, wordRegexFn) {
    const re = wordRegexFn(keyword);
    let out = "", last = 0, m;
    while ((m = re.exec(sentence)) !== null) {
      if (m.index > last) out += run(sentence.slice(last, m.index), { size: 10, color: "33384A" });
      out += run(m[1], { size: 10, bold: true, highlight: "yellow" });
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out + run(sentence.slice(last), { size: 10, color: "33384A" });
  }

  // ---- document -----------------------------------------------------------
  function buildDocument({ parsed, png, filter, suggestions }) {
    const body = [];

    body.push(para(run("Keyword Summary Report", { bold: true, size: 18 })));
    body.push(para(run(`${parsed.map(f => f.filename).join(", ")}, ${new Date().toLocaleDateString()}`,
                       { size: 9, color: "4A4F5E" }), { spaceAfter: 160 }));

    if (png) {
      const bytes = dataUriToBytes(png);
      const { w, h } = pngSize(bytes);
      const cx = Math.round(CHART_WIDTH_IN * EMU_PER_INCH);
      const cy = Math.round(cx * (h / w));
      body.push(
        `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
        `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Match frequency"/>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:nvPicPr><pic:cNvPr id="0" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
      );
    }

    for (const file of parsed) {
      const rows = Object.entries(file.summary)
        .filter(([k]) => !filter || k === filter)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      if (!rows.length) continue;

      body.push(para(run(file.filename, { bold: true, size: 13 }),
                     { spaceBefore: 240, spaceAfter: 60, keepNext: true }));

      for (const [keyword, hits] of rows) {
        const unique = [...new Set(hits)];
        body.push(para(
          run(keyword, { bold: true, size: 11 }) +
          run(`   ${hits.length} match${hits.length === 1 ? "" : "es"} · ` +
              `sentence${unique.length === 1 ? "" : "s"} ${unique.join(", ")}`,
              { size: 9, color: "4A4F5E" }),
          { spaceBefore: 120, keepNext: true }));

        file.results
          .filter(r => r.keyword.toLowerCase() === keyword.toLowerCase())
          .forEach(m => body.push(para(sentenceRuns(m.raw, m.keyword, global.wordRegex),
                                       { indent: 240, border: true })));

        const alts = (suggestions[keyword.toLowerCase()] || []);
        body.push(para(
          alts.length
            ? run("Consider: ", { size: 9, bold: true, color: "4A4F5E" }) +
              run(alts.join(", "), { size: 9, italic: true, color: "1E40AF" })
            : run("No suggested alternative. Flagged for review, not replacement.",
                  { size: 9, italic: true, color: "4A4F5E" }),
          { indent: 240, spaceAfter: 80 }));
      }
    }

    const m = Math.round(PAGE_MARGIN_IN * TWIPS_PER_INCH);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${body.join("")}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="0" w:footer="0" w:gutter="0"/>
</w:sectPr></w:body></w:document>`;
  }

  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = hasImage => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  hasImage ? `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/>` : ""
}</Relationships>`;

  function exportDocx(opts) {
    const entries = [
      { name: "[Content_Types].xml", bytes: utf8(CONTENT_TYPES) },
      { name: "_rels/.rels", bytes: utf8(ROOT_RELS) },
      { name: "word/document.xml", bytes: utf8(buildDocument(opts)) },
      { name: "word/_rels/document.xml.rels", bytes: utf8(docRels(!!opts.png)) },
    ];
    if (opts.png) entries.push({ name: "word/media/chart.png", bytes: dataUriToBytes(opts.png) });

    const blob = new Blob([zip(entries)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keyword-summary-${new Date().toISOString().slice(0, 10)}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return blob;
  }

  global.exportDocx = exportDocx;
  global.__docx = { zip, crc32, buildDocument, pngSize, utf8 };   // for tests
})(window);
