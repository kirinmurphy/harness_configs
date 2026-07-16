---
name: javascript-typescript
description: "Use when working on TypeScript, JavaScript, ECMAScript modules, TSX/JSX utility code, lint/type errors, exports/imports, helper functions, type safety, or JS/TS code style. Pair with react when touched files contain React components or hooks."
---

# JavaScript TypeScript

Apply this when the repo or touched files use JavaScript or TypeScript. Pair with `react` for components, hooks, or TSX UI behavior.

## Functions

- Use `function` declarations for context-agnostic utilities, especially exported helpers.
- Use arrow functions for callbacks, inline handlers, closures, and functions that intentionally capture local state or props.
- Keep reusable pure functions in their own file when shared across modules.
- Small local helpers can live below the main function/export and rely on hoisting.

## Types

- Avoid `any`; prefer precise types, `unknown` with narrowing, generics, or local interfaces.
- Use `as const` for stable literal maps and default tables.
- Extract repeated or meaningful string/number values into named constants.
- Keep runtime parsing and type assumptions close together so callers receive typed values.

## Modules

- Prefer named exports unless the project has a clear default-export convention.
- Keep imports explicit and remove unused imports after edits.
- Preserve the repo's module style: ESM, CommonJS, path aliases, and file extension rules.

## Lint And Formatting

- Use repo-native scripts and config. Do not invent ESLint, Prettier, or typecheck commands.
- For file-scoped fixes, prefer scoped lint/format commands only when the repo supports them.
