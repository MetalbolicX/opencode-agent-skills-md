# opencode-agent-skills-md

<p align="center">
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

### From npm

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
  "plugin": ["opencode-agent-skills-md@1.4.0"]
}
```

Restart OpenCode after updating the config.

### Manual configuration

If you prefer not to install globally, add the plugin entry manually to `~/.config/opencode/opencode.json`:

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

The plugin entrypoint is `src/plugin.ts`. To use the development build with OpenCode, run the included install script, which writes a tiny re-export shim into `.opencode/plugins/skills.js`:

```bash
bun run install-local
```

This is equivalent to:

```bash
mkdir -p .opencode/plugins
echo 'export { SkillsPlugin } from "./src/plugin.ts";' > .opencode/plugins/skills.js
```

You can verify the shim is in place with:

```bash
bun run status
```

## Usage

### Skill Discovery Order

The plugin discovers skills from these locations, in priority order (first match wins, preventing duplicates):

1. `.opencode/skills/` (Project - OpenCode)
2. `.claude/skills/` (Project - Claude)
3. `~/.config/opencode/skills/` (User - OpenCode)
4. `~/.claude/skills/` (User - Claude)
5. `~/.claude/plugins/cache/` (Claude plugin cache)
6. `~/.claude/plugins/marketplaces/` (Claude marketplace, via `installed_plugins.json`)

The first four are scanned in order; roots 5 and 6 are appended after the OpenCode/Claude skill roots, contributing additional skills but still respecting the first-match-wins rule.

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
7. `git tag v1.4.0 && git push origin v1.4.0` (only after publish succeeds)

## Contributing

Contributions are welcome. The codebase uses TypeScript and Bun.

Please run the following before opening a pull request:
```bash
bun run typecheck
bun test
```

## License

MIT. See the [LICENSE](LICENSE) file for details.