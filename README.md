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
- **Mailings:** mail merge from pasted CSV or spreadsheet data, or from a CSV, JSON or Excel file, with live preview and one-document-per-record printing
- **Equations** (type `\frac{a}{b}`, `\sqrt{x}`, `x^2` and so on; saved as real Word equations), **WordArt** and **SmartArt** (process, cycle, hierarchy, list, pyramid)
- **Sections** with their own header, footer, page-number restart, orientation and margins
- **Tables:** sort, repeat header rows, and formulas such as `=SUM(ABOVE)`
- **Templates** gallery, **version history**, **macros** (record typing and formatting, replay), a **thesaurus** and **translation**, **dictation**, and **document protection**
- Documents autosave in your browser (IndexedDB). Nothing is uploaded.

## Not possible without a server

- **Real-time collaboration and cloud storage.** Inkwell is a static site with no back end, so there is nowhere to sync to. Documents stay in your browser; use Save as .docx to move them.

## Known limits

- Sections: a section can switch orientation and margins (Normal, Narrow, Moderate, Wide) from its break onward, and each page is drawn at its own size and margins on screen (centred, with its own header and footer) in single-column documents. In multi-column documents every page on screen keeps one size and one set of margins, and the section break says what changes. Both are written to .docx and print. Importing a .docx keeps a section's margins only when they match one of the four presets; the document's first section keeps the document margins you have set.
- Document protection is a deterrent that stops editing in Inkwell and sets read-only in the .docx. It is not encryption, and anyone can open the file in another editor.
- Dictation and translation rely on the browser (speech recognition, and the on-device Translator API). They are unavailable in browsers without them. The thesaurus is a built-in list of about 1,000 words.
- Version history keeps the latest snapshots in this browser only. Macros record typing and formatting, not mouse selections.
- Mail merge reads pasted CSV, or a CSV, JSON or Excel (.xlsx, first sheet) file. Excel files are read from the first sheet's stored values and shared strings; formulas show their last saved result, and the Excel path has only been tested on files written by script, not real Excel output.
- Equation input is a LaTeX-style subset, not the full language.
- Pages: long paragraphs and list items split across pages at a line boundary (at least two lines stay on each side), and tables break between rows. A table row taller than a page splits across pages at line boundaries in each text cell (single-column documents only). A picture is capped on screen and in .docx to the height of the smallest page body, so it always fits (its shape is kept); shapes still move whole, and a tall row whose cells hold only pictures or nested tables still overflows. Repeated table header rows show on continuation pages in print/PDF and Word, not on screen. In multi-column documents text fills the left column, then the right, then the next page. Long paragraphs and list items run on into the next column at a line boundary (at least two lines each side; text and inline pictures are slid into place with temporary wrappers that are never saved). A table row, or a heading or short block that doesn't fit, still moves whole, so column bottoms can be ragged, and a table row taller than a column overflows (row splitting is not done in columns). Print and the HTML export use true CSS columns.
- Track changes records text you type, delete or paste, and formatting changes (bold, italic, underline, strike, sub/superscript, font, size, colour, highlight), which you can accept or reject. In Word export a formatting change is written as a Word formatting revision (w:rPrChange) recording the previous bold, italic, underline, strike, font, size, colour, highlight and sub/superscript.
- Grammar checking is pattern-based (about 100 rules, including comma splices, long sentences and commonly confused words), so it catches common mistakes rather than everything.
- Charts come in seven types (column, stacked column, bar, line, area, pie, doughnut) with up to 12 series. In Word export, charts become native Word charts with an embedded workbook, and shapes and text boxes become Word drawing objects; SmartArt is still a picture.
- Word import (.docx) keeps text, styles, tables, pictures, footnotes, endnotes, comments, tracked changes, the first section's header and footer, each later section's own header, footer, orientation and page-number restart, and the text of text boxes (as plain Inkwell text boxes, without fill, border or position). A first-page header's text is not kept, only the "different first page" setting, and anchored text boxes become inline ones. Only checked on files Inkwell wrote, not on real Word files.
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
