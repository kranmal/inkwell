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
- **References:** figure/table/equation captions, cross-references, an index built from marked entries, citations with a bibliography (APA, MLA, IEEE)
- **Mailings:** mail merge from pasted CSV or spreadsheet data, with live preview and one-document-per-record printing
- **Equations** (type `\frac{a}{b}`, `\sqrt{x}`, `x^2` and so on; saved as real Word equations), **WordArt** and **SmartArt** (process, cycle, hierarchy, list, pyramid)
- **Sections** with their own header, footer, page-number restart and orientation
- **Tables:** sort, repeat header rows, and formulas such as `=SUM(ABOVE)`
- **Templates** gallery, **version history**, **macros** (record typing and formatting, replay), a **thesaurus** and **translation**, **dictation**, and **document protection**
- Documents autosave in your browser (IndexedDB). Nothing is uploaded.

## Not possible without a server

- **Real-time collaboration and cloud storage.** Inkwell is a static site with no back end, so there is nowhere to sync to. Documents stay in your browser; use Save as .docx to move them.

## Known limits

- Sections: a different orientation or margin per section is written to .docx and print. On screen all pages share one size, because the page engine uses a single page size.
- Document protection is a deterrent that stops editing in Inkwell and sets read-only in the .docx. It is not encryption, and anyone can open the file in another editor.
- Dictation and translation rely on the browser (speech recognition, and the on-device Translator API). They are unavailable in browsers without them. The thesaurus is a built-in list of about 1,000 words.
- Version history keeps the latest snapshots in this browser only. Macros record typing and formatting, not mouse selections.
- Mail merge does its own CSV parsing; there is no Excel file import.
- Equation input is a LaTeX-style subset, not the full language.
- Pages: a paragraph, table or picture moves to the next page whole; it is never split across two pages. Multi-column text is laid out as one continuous sheet.
- Track changes records text you type, delete or paste. Formatting changes are not tracked.
- Grammar checking is pattern-based, so it catches common mistakes rather than everything.
- Charts take up to 8 series. In Word export, charts and shapes become pictures and a text box becomes a one-cell table.
- Word export writes headers, footers, footnotes, endnotes, comments, tracked changes and custom styles. Equations (OMML), section breaks with their own headers, repeated header rows and the protection flag are included, with SmartArt as a picture. Its XML is checked for well-formedness, but the output has not yet been opened in Microsoft Word itself.

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
