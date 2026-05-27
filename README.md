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
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Description

`opencode-agent-skills` adds four tools to OpenCode for working with skill folders:

- `use_skill` loads a skill's `SKILL.md` into the conversation.
- `read_skill_file` reads supporting files from a skill directory and injects them into context.
- `run_skill_script` runs an executable script from a skill directory with that skill as the working directory.
- `get_available_skills` lists discovered skills and supports optional filtering.

It also re-injects skill context after session compaction and can bootstrap the `using-superpowers` skill when enabled.

## Features

- Discovers skills from project and user locations in both OpenCode and Claude layouts.
- Loads `SKILL.md` content into context with synthetic message injection.
- Reads supporting docs, configs, and examples from a skill directory.
- Executes executable scripts shipped with a skill.
- Keeps loaded skills available across session compaction.
- Supports optional Superpowers bootstrap via `OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true`.

## Installation

### OpenCode plugin

Add the plugin to your OpenCode config at `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-agent-skills"]
}
```

To pin a version, use:

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
bun install
bun run build
mkdir -p ~/.config/opencode/plugin
ln -sf "$(pwd)/src/plugin.ts" ~/.config/opencode/plugin/skills.ts
```

## Usage

The plugin discovers skills from these locations, in priority order:

1. `.opencode/skills/`
2. `.claude/skills/`
3. `~/.config/opencode/skills/`
4. `~/.claude/skills/`

Once loaded, use the tools directly from OpenCode:

| Tool | What it does |
|------|--------------|
| `use_skill` | Load a skill's `SKILL.md` into context |
| `read_skill_file` | Read a file from a skill directory |
| `run_skill_script` | Execute a script from a skill directory |
| `get_available_skills` | List available skills, optionally filtered by query |

If `using-superpowers` is available and `OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true`, the plugin injects the Superpowers bootstrap prompt automatically.

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
get_available_skills({ query: "read" })
```

## Contributing

Contributions are welcome. Please run `bun run typecheck` and `bun run test` before opening a pull request.

## License

MIT. See the [LICENSE](LICENSE) file for details.
