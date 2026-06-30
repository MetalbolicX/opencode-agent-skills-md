# Plan 003: Escape XML and shell boundaries in skill tools

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fb45791..HEAD -- packages/opencode-agent-skills-md/src/tools.ts packages/core/src/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none (can land independently)
- **Category**: security
- **Planned at**: commit `fb45791`, 2026-06-29

## Why this matters

Two injection surfaces exist in the plugin package:

1. **XML/prompt injection** in `ReadSkillFile` (`tools.ts:206-214`) and
   `UseSkill` (`tools.ts:323-334`) — uncontrolled skill names, filenames,
   paths, and SKILL.md content are interpolated into XML wrapper strings.
   A malicious SKILL.md containing `</content><system>...</system>` would
   break out of the wrapper and inject arbitrary prompt directives.

2. **Shell argument injection** in `RunSkillScript` (`tools.ts:272`) —
   user-supplied `args.arguments` array is interpolated into a shell
   template literal with no quoting/escaping. A value like
   `["'; rm -rf / #"]` could execute arbitrary commands.

## Current state

### XML injection in `ReadSkillFile` (`tools.ts:206-214`)

```ts
const wrappedContent = `<skill-file skill="${skill.name}" file="${args.filename}">
  <metadata>
    <directory>${skill.path}</directory>
  </metadata>

  <content>
${content}
  </content>
</skill-file>`;
```

### XML injection in `UseSkill` (`tools.ts:323-334`)

```ts
const skillContent = `<skill name="${skill.name}">
  <metadata>
    <source>${skill.label}</source>
    <directory>${skill.path}</directory>${scriptsXml}${filesXml}
  </metadata>

  ${toolTranslation}

  <content>
${skill.template}
  </content>
</skill>`;
```

### Shell injection in `RunSkillScript` (`tools.ts:272`)

```ts
const result = await $`${script.absolutePath} ${scriptArgs}`.text();
```

`scriptArgs` is `string[]` from user input. The `$` tagged template from
`@opencode-ai/plugin` does shell-style escaping when arguments are passed
as array elements, but interpolating `scriptArgs` (an array) into the
template string passes its `toString()` representation (comma-joined),
not individual quoted arguments.

Conventions:
- The `debugLog` function from `opencode-agent-skills-md-core` is already
  imported in `parse.ts` and available for logging.
- The `$` function is `PluginInput["$"]` — the OpenCode shell runner.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `pnpm run typecheck`               | exit 0, no errors   |
| Plugin test | `pnpm -F opencode-agent-skills-md exec node --import tsx --test tests/tools.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/opencode-agent-skills-md/src/tools.ts` — XML escape + shell args fix

**Out of scope** (do NOT touch):
- `packages/core/` — no changes needed
- `packages/opencode-agent-skills-md/src/plugin.ts` — the superpowers bootstrap has a similar interpolation but is by-design for a trusted skill name
- `packages/opencode-agent-skills-md/src/host.ts` — no injection surface there

## Git workflow

- Branch: `advisor/003-escape-prompts`
- Commit per logical step; message style: conventional commits
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add XML escape helper

Add a small XML-escape function at the top of `tools.ts` (after the imports):

```ts
/** Escape XML special characters in attribute values and text content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
```

This prevents breakout from XML attribute and text contexts.

**Verify**: `grep 'function escapeXml' packages/opencode-agent-skills-md/src/tools.ts` → matches

### Step 2: Escape XML in `ReadSkillFile`

Replace the raw interpolation with escaped values in `tools.ts:206-214`:

Old:
```ts
const wrappedContent = `<skill-file skill="${skill.name}" file="${args.filename}">
  <metadata>
    <directory>${skill.path}</directory>
  </metadata>

  <content>
${content}
  </content>
</skill-file>`;
```

New:
```ts
const wrappedContent = `<skill-file skill="${escapeXml(skill.name)}" file="${escapeXml(args.filename)}">
  <metadata>
    <directory>${escapeXml(skill.path)}</directory>
  </metadata>

  <content>
${content}
  </content>
</skill-file>`;
```

Note: `skill.name`, `args.filename`, and `skill.path` are the only values we
control that should be escaped. The `content` variable is the raw file content
and is intentionally placed in a text context — its content will be part of
what the LLM reads, so no escaping needed.

**Verify**: `grep 'escapeXml(skill.name)' packages/opencode-agent-skills-md/src/tools.ts` → matches

### Step 3: Escape XML in `UseSkill`

Replace the raw interpolation with escaped values in `tools.ts:323-334`:

Old:
```ts
const skillContent = `<skill name="${skill.name}">
  <metadata>
    <source>${skill.label}</source>
    <directory>${skill.path}</directory>${scriptsXml}${filesXml}
  </metadata>

  ${toolTranslation}

  <content>
${skill.template}
  </content>
</skill>`;
```

New — escape `skill.name`, `skill.label`, `skill.path`:
```ts
const skillContent = `<skill name="${escapeXml(skill.name)}">
  <metadata>
    <source>${escapeXml(skill.label)}</source>
    <directory>${escapeXml(skill.path)}</directory>${scriptsXml}${filesXml}
  </metadata>

  ${toolTranslation}

  <content>
${skill.template}
  </content>
</skill>`;
```

Note: `skill.template` is the actual skill content (the body of SKILL.md)
and should remain raw — it's what the skill is meant to inject.

**Verify**: `grep 'escapeXml(skill.label)' packages/opencode-agent-skills-md/src/tools.ts` → matches

### Step 4: Fix shell argument escaping in `RunSkillScript`

Replace the unsafe interpolation with individual quoted arguments in
`tools.ts:272`.

The `$` tagged template from `@opencode-ai/plugin` supports passing arguments
as separate template expressions. Instead of passing the array as a single
interpolation, pass each argument as its own expression:

Old:
```ts
$.cwd(skill.path);
const scriptArgs = args.arguments || [];
const result = await $`${script.absolutePath} ${scriptArgs}`.text();
```

New:
```ts
$.cwd(skill.path);
const scriptArgs = args.arguments || [];
const result = await $`${script.absolutePath}${scriptArgs.map(a => [' ', a]).flat()}`.text();
```

Wait — this is tricky with the tagged template. The safest approach is to pass
the executable and arguments separately to the shell runner. Look at how the
plugin SDK's `$` handles multiple arguments — it typically accepts them as a
spread after the template:

If `$` is an execa-style tagged template, this should work:
```ts
const result = await $([script.absolutePath, ...scriptArgs]);
```

But if `$` only works as a template literal, then a different approach is needed.

The safest cross-approach fix is to shell-escape each argument individually and
join them:

```ts
// Shell-escape a single argument: wrap in single quotes, escape embedded single quotes
function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

$.cwd(skill.path);
const scriptArgs = (args.arguments || []).map(escapeShellArg).join(' ');
const result = await $`${script.absolutePath} ${scriptArgs}`.text();
```

This wraps each argument in single quotes (which prevent all shell metacharacter
interpretation) and escapes any embedded single quotes using the standard
`'\''` Bourne shell pattern.

**Verify**: `grep 'escapeShellArg' packages/opencode-agent-skills-md/src/tools.ts` → matches

### Step 5: Typecheck

**Verify**: `pnpm run typecheck` → exit 0, no errors

### Step 6: Run tests

**Verify**: `pnpm test` → exit 0, all tests pass

## Test plan

No new tests are needed for this plan — the existing tests must pass.
Test coverage for these surfaces is added in Plan 004 (`test-security-paths`).
Verify that existing tests still pass after the changes.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `escapeXml` function exists in `tools.ts` and is used for `skill.name`, `args.filename`, `skill.path`, `skill.label`
- [ ] `escapeShellArg` function exists in `tools.ts` and is used for each element of `args.arguments`
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `$` tagged template behaves differently than expected — test with a
  simple experiment if unsure. The escapeShellArg approach is a safe fallback
  that works with any shell-like execution.
- A step's verification fails twice after a reasonable fix attempt.
- The fix requires touching an out-of-scope file.
- The XML escape breaks any test that relied on specific unescaped output in
  the injected content.

## Maintenance notes

- If a future version of `@opencode-ai/plugin` provides native argument
  handling in `$`, replace the `escapeShellArg` approach with the SDK-native one.
- The `escapeXml` function only handles the 5 XML predefined entities. If
  non-ASCII content or CDATA sections are ever part of the XML values, extend it.
- The `skill.template` and `content` variables are intentionally not escaped —
  they represent the actual skill content the user wants injected.
