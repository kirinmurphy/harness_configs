# Representation

Match the form to the content. Prose is the fallback, not the default.

| Content | Form |
| --- | --- |
| Workflow, sequence, lifecycle, entity relationship | Mermaid diagram |
| Commands, CLI interaction, config, file layout | Fenced code block |
| Glossary, options, config keys, any set of like items | Table |
| Two or more alternatives | Comparison table, one row per dimension |
| Data-model-heavy features | Mermaid `erDiagram` |

## Rules

- Keep prose terse and guiding — it introduces and connects the other forms. No large dense blocks.
- Never narrate in prose what a diagram or table already shows.
- Show real captured output in CLI examples, not paraphrased output. Replace machine-specific paths
  with placeholders (`<checkout>`, `<npm-prefix>`).
- Every diagram edge needs a correct direction and a verb label. A backwards arrow is a factual
  error.
- Add an `erDiagram` only when data-model changes are central; skip it when they are ancillary.
- Prefer one diagram per idea over a single diagram carrying several.
