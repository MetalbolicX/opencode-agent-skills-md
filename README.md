# opencode-agent-skills-md

<p align="center">
  <a href="https://github.com/MetalbolicX/opencode-agent-skills-md/actions/workflows/release.yml"><img alt="release" src="https://img.shields.io/github/actions/workflow/status/MetalbolicX/opencode-agent-skills-md/release.yml?style=flat-square&logo=githubactions&label=release" /></a>
  <a href="https://www.npmjs.com/package/opencode-agent-skills-md"><img alt="npm" src="https://img.shields.io/npm/v/opencode-agent-skills-md?style=flat-square&logo=npm" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/MetalbolicX/opencode-agent-skills-md?style=flat-square" /></a>
</p>

<p align="center">Reusable Agent Skills engine plus an OpenCode plugin adapter, distributed as two workspace packages.</p>

## Table of Contents

- [Description](#description)
- [Which Package?](#which-package)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [How it Works](#how-it-works)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Description

This repo publishes two packages:

| Package | Purpose |
|---------|---------|
| [`opencode-agent-skills-md`](https://www.npmjs.com/package/opencode-agent-skills-md) | OpenCode plugin — the four skill tools (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`) and the OpenCode host adapter. |
| [`opencode-agent-skills-md-core`](packages/core) | Portable, host-agnostic skills engine: discovery, parsing, search, and the `SkillHostClient` / `SkillHostSession` boundary contracts. Zero dependency on `@opencode-ai/plugin`. |

The core engine is the reusable engine; the OpenCode plugin is one concrete adapter built on top of it.

## Which Package?

Pick the package that matches your harness:

- **You use OpenCode** → install [`opencode-agent-skills-md`](https://www.npmjs.com/package/opencode-agent-skills-md). It already implements the `SkillHostClient` boundary against the OpenCode SDK and ships the four tools ready to load.
- **You build a custom harness, CLI, or test fixture** → install [`opencode-agent-skills-md-core`](packages/core). It is a standalone ESM package whose runtime dependencies exclude `@opencode-ai/plugin`. You provide your own `SkillHostClient` implementation and pass it to the tool factories of your choice.

Both packages live in this repo as a pnpm workspace. From the repo root, `pnpm install` wires them together via the workspace link so the OpenCode plugin can resolve `opencode-agent-skills-md-core` by name during development.

## Features

- **Standardized Skill Discovery**: Finds skills from project and user locations, supporting both OpenCode and Claude skill directory layouts.
- **Context Injection**: Loads `SKILL.md` content directly into the context window as synthetic, non-reply messages.
- **Smart Keyword Matching**: Automatically monitors messages and uses lightweight keyword matching to invisibly prompt the agent to use relevant skills.
- **Compaction Resilient**: Re-injects the list of loaded skills after session compaction events to ensure they remain available in long-running sessions.
- **Script Execution**: Recursively finds and executes scripts (files with the executable bit set) within skill directories.
- **Superpowers Mode**: Optional integration to automatically bootstrap the `using-superpowers` workflow.
- **Reusable Engine**: The core package is host-agnostic — write a `SkillHostClient` for your harness and reuse the entire skills engine without pulling the OpenCode SDK.

## Installation

### OpenCode plugin

Add the plugin to your OpenCode config at `~/.config/opencode/opencode.json`:

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

Restart OpenCode after updating the config.

### Custom harness (standalone engine)

Install the core engine and implement `SkillHostClient` against your own host:

```bash
pnpm add opencode-agent-skills-md-core
```

```ts
import {
  discoverAllSkills,
  parseSkillFile,
  resolveSkill,
  type Skill,
  type SkillHostClient,
  type SkillHostSession,
} from "opencode-agent-skills-md-core";
```

The core package has zero runtime dependency on `@opencode-ai/plugin`, so it is the right entry point for custom harnesses, CLIs, and test fixtures. Implement the `SkillHostClient` interface declared in `packages/core/src/types.ts` and pass an instance to the tool factories of your choice.

### Local development

```bash
git clone https://github.com/MetalbolicX/opencode-agent-skills-md
cd opencode-agent-skills-md
pnpm install
pnpm run build    # builds both packages via `pnpm -r run build`
```

The OpenCode plugin bundle is emitted at `packages/opencode-agent-skills-md/dist/opencode/index.js`. Symlink it into your local OpenCode plugin directory:

```bash
mkdir -p ~/.config/opencode/plugin
ln -sf "$(pwd)/packages/opencode-agent-skills-md/dist/opencode/index.js" ~/.config/opencode/plugin/skills.ts
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
2. **Invisible Evaluation**: For subsequent messages, user text is tokenized and matched against skill names/descriptions. Matches trigger a hidden `<skill-evaluation-required>` block prompting the agent to invoke `use_skill` if appropriate.
3. **Synthetic Injection**: Tool outputs are injected using `synthetic: true` and `noReply: true`, meaning they do not count as user messages and remain quietly in the context window.
4. **Script Safety**: File reads (`read_skill_file`) strictly prevent path traversal outside the skill's root directory. Scripts (`run_skill_script`) skip common heavy directories like `node_modules` and `.git` and only execute files with the executable bit set.

## Examples

Load a skill into context:
```text
use_skill("brainstorming")
```

Read a supporting file from a skill:
```text
read_skill_file("brainstorming", "references/transformation-rules.md")
```

Run a script from a skill directory:
```text
run_skill_script("my-skill", "scripts/build.sh", ["--dry-run"])
```

List matching skills:
```text
get_available_skills({ query: "refactor" })
```

## Contributing

Contributions are welcome. The codebase uses TypeScript and Rolldown for bundling. Two workspace packages live in this repo:

- `packages/core/` — the portable skills engine.
- `packages/opencode-agent-skills-md/` — the OpenCode plugin.

Workspace commands at the repo root (`pnpm run build`, `pnpm test`, `pnpm run typecheck`) delegate to both packages via `pnpm -r`.

Please run the following before opening a pull request:
```bash
pnpm run typecheck
pnpm test
```

## License

MIT. See the [LICENSE](LICENSE) file for details.