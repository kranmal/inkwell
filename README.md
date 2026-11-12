# Inkwell

A word processor that runs entirely in the browser. Live at https://kranmal.github.io/inkwell/

- Fonts, sizes, colours, highlights, styles (Title, Headings, Quote, Code) and document themes
- Edit the built-in styles or create your own, and adjust a theme's fonts and colours
- Lists, indents, alignment, line and paragraph spacing, columns, margins, paper size
- Real pages on screen, with headers, footers and page numbers (optionally different on the first page)
- Footnotes, endnotes and a table of contents that follows your headings and page numbers
- Tables with merged and split cells, shading, border styles and drag-to-resize columns
- Shapes, text boxes and charts (column, bar, line, pie) built from data you type in
- Comments and track changes, with accept and reject
- Pictures, links, page breaks, symbols
- Spelling (UK and US English) and rule-based grammar checking, with a proofing score
- Find and replace, word count, read aloud, outline, focus mode, dark mode
- Opens .docx, .html, .txt and .md; saves as .docx, .html, .txt or PDF (print)
- Documents autosave in your browser (IndexedDB). Nothing is uploaded.

## Known limits

- Pages: a paragraph, table or picture moves to the next page whole; it is never split across two pages. Multi-column text is laid out as one continuous sheet.
- Track changes records text you type, delete or paste. Formatting changes are not tracked.
- Grammar checking is pattern-based, so it catches common mistakes rather than everything.
- Charts take up to 8 series. In Word export, charts and shapes become pictures and a text box becomes a one-cell table.
- Word export writes headers, footers, footnotes, endnotes, comments, tracked changes and custom styles. Its XML is checked for well-formedness, but the output has not yet been opened in Microsoft Word itself.

## Run locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8771
```

Then open http://localhost:8771

## Third-party

- [Typo.js](https://github.com/cfinke/Typo.js) (Modified BSD) for spell checking
- Hunspell en_US and en_GB dictionaries (see the licence headers in `vendor/dict/`)
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) (BSD-2-Clause) for .docx import
- [JSZip](https://github.com/Stuk/jszip) (MIT) for .docx export
