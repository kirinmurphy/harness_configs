## Claude Specifics

- Optional package hooks may block broad tools and nudge toward package-specific alternatives. Treat that as redirect, not failure.
- For direct TypeScript compiler runs, prefer `tsc --noEmit --pretty false`.
- Summarize command results instead of pasting long logs.
