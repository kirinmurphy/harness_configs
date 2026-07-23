# Vendored dependencies

## mermaid.min.js

Version 11.16.0, from `npm pack mermaid@11.16.0` (`dist/mermaid.min.js`), MIT licensed
(see `mermaid.LICENSE.txt`). Vendored rather than loaded from a CDN so the "view docs" popup's
diagram rendering works fully offline on this loopback-only portal — see
`portal/shared/doc-guide-modal.js`'s `loadMermaid()`.

To upgrade: `npm pack mermaid@<version>`, extract, copy `dist/mermaid.min.js` and `LICENSE` here,
update this note.
