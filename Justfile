set dotenv-load := true

[private]
default:
    @just --list --list-submodules

# Run the full test suite
test:
    bun test

# Typecheck
typecheck:
    tsc --noEmit

# Build the TypeScript plugin (tsc emit)
build:
    bun run build

# Bundle the CLI entrypoint (bun build + shebang)
build-cli:
    bun run scripts/build-cli.ts

# Install local plugin for development
install-local:
    mkdir -p .opencode/plugins
    printf 'import { SkillsPlugin } from "../../src/plugin.ts";\n' > .opencode/plugins/skills.ts

# Check if local plugin is installed
status:
    @ls -la .opencode/plugins/skills.js 2>/dev/null || echo "Not installed"

# Uninstall local plugin copy
uninstall-local:
    rm -f .opencode/plugins/skills.js

# Run a single test file
test-file file:
    bun test {{file}}

# Run typecheck only
check:
    tsc --noEmit
