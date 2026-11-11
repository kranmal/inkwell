# Inkwell

A word processor that runs entirely in the browser. Live at https://kranmal.github.io/inkwell/

- Fonts, sizes, colours, highlights, styles (Title, Headings, Quote, Code) and document themes
- Lists, indents, alignment, line and paragraph spacing, columns, margins, paper size
- Tables, pictures, links, page breaks, symbols
- Spelling (UK and US English) and rule-based grammar checking, with a proofing score
- Find and replace, word count, read aloud, outline, focus mode, dark mode
- Opens .docx, .html, .txt and .md; saves as .docx, .html, .txt or PDF (print)
- Documents autosave in your browser (IndexedDB). Nothing is uploaded.

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
