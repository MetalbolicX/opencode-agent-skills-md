# opencode-agent-skills

<p align="center">
  <a href="https://github.com/joshuadavidthomas/opencode-agent-skills/actions/workflows/release.yml"><img alt="release" src="https://img.shields.io/github/actions/workflow/status/joshuadavidthomas/opencode-agent-skills/release.yml?style=flat-square&logo=githubactions&label=release" /></a>
  <a href="https://www.npmjs.com/package/opencode-agent-skills"><img alt="npm" src="https://img.shields.io/npm/v/opencode-agent-skills?style=flat-square&logo=npm" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/joshuadavidthomas/opencode-agent-skills?style=flat-square" /></a>
</p>

<p align="center">OpenCode plugin for discovering reusable skills, loading skill instructions into context, reading skill files, and running skill scripts.</p>

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [How it Works](#how-it-works)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Description

`opencode-agent-skills` adds four tools to OpenCode for working with Agent Skills:

- `use_skill` loads a skill's `SKILL.md` into the conversation.
- `read_skill_file` reads supporting files from a skill directory and injects them into context (with path traversal protection).
- `run_skill_script` runs executable scripts found within a skill directory.
- `get_available_skills` lists discovered skills, supporting keyword filtering.

It also manages skill context lifecycle, surviving session compaction and automatically suggesting relevant skills based on user input.

## Features

- **Standardized Skill Discovery**: Finds skills from project and user locations, supporting both OpenCode and Claude skill directory layouts.
- **Context Injection**: Loads `SKILL.md` content directly into the context window as synthetic, non-reply messages.
- **Smart Keyword Matching**: Automatically monitors messages and uses lightweight keyword matching to invisibly prompt the agent to use relevant skills.
- **Compaction Resilient**: Re-injects the list of loaded skills after session compaction events to ensure they remain available in long-running sessions.
- **Script Execution**: Recursively finds and executes scripts (files with the executable bit set) within skill directories.
- **Superpowers Mode**: Optional integration to automatically bootstrap the `using-superpowers` workflow.

## Installation

### OpenCode plugin

Add the plugin to your OpenCode config at `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-agent-skills"]
}
```

To pin a specific version:

```json
{
  "plugin": ["opencode-agent-skills@0.7.0"]
}
```

Restart OpenCode after updating the config.

### Local development

```bash
git clone https://github.com/joshuadavidthomas/opencode-agent-skills ~/.config/opencode/opencode-agent-skills
cd ~/.config/opencode/opencode-agent-skills
pnpm install
pnpm run build
mkdir -p ~/.config/opencode/plugin
ln -sf "$(pwd)/dist/opencode/index.js" ~/.config/opencode/plugin/skills.ts
```

### Programmatic subpath exports

The package publishes two ESM subpath exports so harness authors can embed the portable engine without pulling the OpenCode SDK:

| Subpath | Resolves to | Intended for |
|---------|-------------|--------------|
| `opencode-agent-skills` | `./dist/opencode/index.js` | OpenCode host adapter (default `SkillsPlugin` factory + `createOpencodeSkillHost`) |
| `opencode-agent-skills/core` | `./dist/core/index.js` | Portable engine: `discoverAllSkills`, `parseSkillFile`, `resolveSkill`, `SkillHostClient`, `SkillHostSession`, etc. |

The core subpath has zero runtime dependency on `@opencode-ai/plugin` and is the right entry point for custom harnesses, CLIs, and test fixtures. Example:

```ts
import {
  discoverAllSkills,
  parseSkillFile,
  resolveSkill,
  type Skill,
  type SkillHostClient,
  type SkillHostSession,
} from "opencode-agent-skills/core";
```

To reuse the core from a new harness, implement the two interfaces (`SkillHostClient`, `SkillHostSession`) declared in `src/core/types.ts` and pass an instance to the tool factories of your choice.

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

Contributions are welcome. The codebase uses TypeScript, Zod for schema validation, and Rolldown for bundling.

Please run the following before opening a pull request:
```bash
pnpm run typecheck
pnpm test
```

## License

MIT. See the [LICENSE](LICENSE) file for details.
