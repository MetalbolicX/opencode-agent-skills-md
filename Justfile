set dotenv-load := true
set unstable := true

[private]
default:
    @just --list --list-submodules

[private]
fmt:
    @just --fmt

# Build both workspace packages (core engine + OpenCode plugin)
build:
    pnpm run build

# Install dev plugin locally (project-scoped stub that re-exports the built bundle)
install: build
    mkdir -p .opencode/plugins
    printf 'export { SkillsPlugin as default, SkillsPlugin } from "../../packages/opencode-agent-skills-md/dist/plugin.mjs";\n' > .opencode/plugins/skills.js

# Uninstall local plugin copy
uninstall:
    rm -f .opencode/plugins/skills.js

# Check if local plugin is installed
status:
    @ls -la .opencode/plugins/skills.js 2>/dev/null || echo "Not installed"

# Run the full test suite (both packages + workspace contract test)
test:
    pnpm test

# Run the workspace contract test in isolation
test-workspace:
    pnpm run test:workspace

# Typecheck both workspace packages
typecheck:
    pnpm run typecheck

# Verify the manual publish flow end-to-end without publishing: install, typecheck, test, pack, and dry-run the package contents.
release-check:
    pnpm install --frozen-lockfile
    pnpm run typecheck
    pnpm test
    pnpm -F opencode-agent-skills-md pack
    cd packages/opencode-agent-skills-md && npm pack --dry-run