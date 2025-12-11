# Agent Guidelines

## Commands
- **Package manager:** Bun (not npm/yarn)
- **Test:** `bun test` or `just test`
- **Single test:** `bun test path/to/file.test.ts` or `bun test --grep "pattern"`
- **Typecheck:** `bun run typecheck` (runs `tsc --noEmit`)
- **Build:** `just build`

## Code Style
- **TypeScript strict mode** with `noUncheckedIndexedAccess` - always check array/object access
- **ES modules** - use `import`/`export`, no CommonJS
- **Node imports** - use `node:` prefix (e.g., `import * as fs from "node:fs/promises"`)
- **Zod** for runtime validation schemas
- **Naming:** camelCase for functions/variables, PascalCase for types/interfaces
- **JSDoc comments** (`/** */`) for public functions
- **Error handling:** try/catch with graceful fallbacks; silent catches OK for optional operations
- **Async/await** - prefer over raw promises
- **Path safety:** validate user paths don't escape base directories using `path.resolve`

## Project Structure
- Single plugin file at `src/plugin.ts`
- Plugin exports a single `Plugin` function that returns tools and event handlers
