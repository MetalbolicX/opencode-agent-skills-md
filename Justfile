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

# Install dev plugin globally
install: build
    mkdir -p ~/.config/opencode/plugin
    ln -sf "$(pwd)/dist/plugin.js" ~/.config/opencode/plugin/skills.js

# Uninstall plugin
uninstall:
    rm -f ~/.config/opencode/plugin/skills.js

# Check if plugin is installed
status:
    @ls -la ~/.config/opencode/plugin/skills.js 2>/dev/null || echo "Not installed"

# Run tests
test:
    npm test