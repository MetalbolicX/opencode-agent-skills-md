# opencode-agent-skills-md

<p align="center">
  <a href="https://github.com/MetalbolicX/opencode-agent-skills-md/actions/workflows/release.yml"><img alt="release" src="https://img.shields.io/github/actions/workflow/status/MetalbolicX/opencode-agent-skills-md/release.yml?style=flat-square&logo=githubactions&label=release" /></a>
  <a href="https://www.npmjs.com/package/opencode-agent-skills-md"><img alt="npm" src="https://img.shields.io/npm/v/opencode-agent-skills-md?style=flat-square&logo=npm" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/MetalbolicX/opencode-agent-skills-md?style=flat-square" /></a>
</p>

<p align="center">OpenCode plugin for agent skills — single-package Bun layout with semantic matching.</p>

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [How it Works](#how-it-works)
- [Examples](#examples)
- [Maintainer release flow](#maintainer-release-flow)
- [Contributing](#contributing)
- [License](#license)

## Description

`opencode-agent-skills-md` is an OpenCode plugin that provides reusable agent skills. It discovers skills from project and user locations, loads skill content into the context window, and uses semantic ranking with fuzzy fallback to suggest relevant skills.

## Features

- **Standardized Skill Discovery**: Finds skills from project and user locations, supporting both OpenCode and Claude skill directory layouts.
- **Context Injection**: Loads `SKILL.md` content directly into the context window as synthetic, non-reply messages.
- **Semantic Ranking with Fuzzy Fallback**: Uses keyword scoring as the primary signal with bag-of-words embeddings for semantic ranking, falling back to Levenshtein-based fuzzy matching when needed.
- **Compaction Resilient**: Re-injects the list of loaded skills after session compaction events to ensure they remain available in long-running sessions.
- **Script Execution**: Recursively finds and executes scripts (files with the executable bit set) within skill directories.
- **Superpowers Mode**: Optional integration to automatically bootstrap the `using-superpowers` workflow.
- **Preference Layer**: Hooks for annotating native tool definitions and system prompts with skill policy information.

## Installation

### Quick install (recommended)

```bash
npx opencode-agent-skills-md install
```

This registers the plugin in your global OpenCode config and verifies the installation. Restart OpenCode to activate.

### CLI commands

After installing, the following commands are available:

- `oas install` — register the plugin in the global OpenCode config
- `oas uninstall` — remove the plugin from the global OpenCode config
- `oas status` — check whether the plugin is currently installed
- `oas doctor` — validate the OpenCode configuration health

### From npm (alternative)

```bash
npm install -g opencode-agent-skills-md
```

Then add the plugin to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-agent-skills-md"]
}
```

To pin a specific version:

```json
{
  "plugin": ["opencode-agent-skills-md@0.7.0"]
}
```

### Manual configuration (fallback)

If you prefer not to use the CLI, add the plugin entry manually to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-agent-skills-md"]
}
```

Restart OpenCode after updating the config.

### Local development

```bash
git clone https://github.com/MetalbolicX/opencode-agent-skills-md
cd opencode-agent-skills-md
bun install
bun run typecheck
bun test
```

The plugin entrypoint is `src/plugin.ts`. Symlink it into your local OpenCode plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
ln -sf "$(pwd)/src/plugin.ts" ~/.config/opencode/plugins/skills.ts
```

## Usage

### Skill Discovery Order

The plugin discovers skills from these locations, in priority order (first match wins, preventing duplicates):

1. `.opencode/skills/` (Project - OpenCode)
2. `.claude/skills/` (Project - Claude)
3. `~/.config/opencode/skills/` (User - OpenCode)
4. `~/.claude/skills/` (User - Claude)

### Tools

Once loaded, use the tools directly from OpenCode:

| Tool | Description |
|------|-------------|
| `use_skill` | Load a skill's `SKILL.md` into context. |
| `read_skill_file` | Read a file from a skill directory (e.g., `references/rules.md`). |
| `run_skill_script` | Execute a script from a skill directory. The script must be executable (`chmod +x`). |
| `get_available_skills` | List available skills, optionally filtered by an ad-hoc query string. |

### Superpowers Integration

If you have the [Superpowers](https://github.com/obra/superpowers) skill installed, you can automatically inject its bootstrap prompt on session start:

```bash
export OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true
opencode
```

## How it Works

1. **Session Initialization**: On the first message, a complete list of discovered skills is injected into the context via `<available-skills>`.
2. **Semantic Evaluation**: For subsequent messages, user text is semantically ranked against skill names, descriptions, and triggers. The top 5 most relevant skills trigger a hidden `<skill-evaluation-required>` block prompting the agent to invoke `use_skill` if appropriate.
3. **Synthetic Injection**: Tool outputs are injected using `synthetic: true` and `noReply: true`, meaning they do not count as user messages and remain quietly in the context window.
4. **Script Safety**: File reads (`read_skill_file`) strictly prevent path traversal outside the skill's root directory. Scripts (`run_skill_script`) skip common heavy directories like `node_modules` and `.git` and only execute files with the executable bit set.

## Examples

Load a skill into context:
```
use_skill("brainstorming")
```

Read a supporting file from a skill:
```
read_skill_file("brainstorming", "references/transformation-rules.md")
```

Run a script from a skill directory:
```
run_skill_script("my-skill", "scripts/build.sh", ["--dry-run"])
```

List matching skills:
```
get_available_skills({ query: "refactor" })
```

## Maintainer release flow

1. `corepack use bun@1`
2. `bun install`
3. `bun run typecheck`
4. `bun test`
5. `npm pack --dry-run` (from the package directory to inspect contents)
6. `npm publish --access public` (from the package directory, not the workspace root)
7. `git tag v1.3.0 && git push origin v1.3.0` (only after publish succeeds)

## Contributing

Contributions are welcome. The codebase uses TypeScript and Bun.

Please run the following before opening a pull request:
```bash
bun run typecheck
bun test
```

## License

MIT. See the [LICENSE](LICENSE) file for details.
