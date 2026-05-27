set dotenv-load := true
set unstable := true

[private]
default:
    @just --list --list-submodules

[private]
fmt:
    @just --fmt

# Build the plugin
build:
    npm run build

# Install dev plugin locally (project-scoped copy)
install: build
    mkdir -p .opencode/plugins
    cp dist/plugin.js .opencode/plugins/skills.js

# Uninstall local plugin copy
uninstall:
    rm -f .opencode/plugins/skills.js

# Check if local plugin is installed
status:
    @ls -la .opencode/plugins/skills.js 2>/dev/null || echo "Not installed"

# Run tests
test:
    npm test
