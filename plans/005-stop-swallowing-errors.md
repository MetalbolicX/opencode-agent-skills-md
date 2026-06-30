# Plan 005: Surface swallowed discovery and parse errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fb45791..HEAD -- packages/core/src/discovery.ts packages/core/src/parse.ts packages/opencode-agent-skills-md/src/host.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `fb45791`, 2026-06-29

## Why this matters

Four locations in the core and host packages silently swallow filesystem and
parse errors with bare `catch {}` blocks. When a discovery root is
inaccessible (permission denied), a SKILL.md file is corrupted, or a session
context lookup fails, the failure produces no diagnostic output. Users see
"no skills found" with no path to debug. Adding `debugLog` calls in these
catch blocks makes failures discoverable when
`OPENCODE_AGENT_SKILLS_DEBUG=1` is set, without changing the current
graceful-degradation behavior.

## Current state

### 1. `packages/core/src/discovery.ts:87` — outer catch in `findSkillsRecursive`

```ts
  } catch { }
```

This wraps the entire `fs.access` + `walkDir` call. If `baseDir` exists but
is unreadable, the error is invisible.

### 2. `packages/core/src/discovery.ts:219` — inner catch in `listSkillFiles`

```ts
        } catch { }
```

This wraps `fs.stat` per entry. If a file in the skill directory can't be
stat'd, the entry is silently skipped.

### 3. `packages/core/src/parse.ts:91` — catch on `fs.readFile`

```ts
const content = await fs.readFile(skillPath, 'utf-8').catch(() => null);
```

If a SKILL.md can't be read, returns `null` with no diagnostic.

Note: `parse.ts:107` (`try { parseYamlFrontmatter(...) } catch { return null; }`)
is excluded — `parseYamlFrontmatter` already logs errors via `debugLog` at
`parse.ts:38`.

### 4. `packages/opencode-agent-skills-md/src/host.ts:97` — catch in `getSessionContext`

```ts
      } catch {
        // Fall through to undefined - mirrors the legacy behaviour
      }
```

If the session lookup fails, the error is swallowed. This is important for
privacy (session data should not leak in error messages), but a debug log
is safe.

Excluded by design:
- `walk.ts:100-103` per-entry isolation is documented as intentional.
- `parse.ts:25-26` YAML fallback to `{}` is documented as intentional.
- `discovery.ts:165-168` duplicate skill handling is documented as intentional.

Conventions:
- `debugLog` is imported in `discovery.ts` (not yet, but `parse.ts` imports it)
- The import is `import { debugLog } from "./debug"` from `packages/core/src/`

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm run typecheck`     | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass            |

## Scope

**In scope** (the only files you should modify):
- `packages/core/src/discovery.ts` — add `debugLog` import and calls in catch blocks
- `packages/core/src/parse.ts` — add `debugLog` to the `readFile` catch at line 91
- `packages/opencode-agent-skills-md/src/host.ts` — add `debugLog` to the `getSessionContext` catch at line 97

**Out of scope** (do NOT touch):
- `walk.ts` — per-entry isolation is by-design
- `parse.ts` YAML error handling — already logs via `debugLog`
- `packages/core/src/scripts.ts` — catches there are intentional
- Any test files — the existing tests must pass unchanged

## Git workflow

- Branch: `advisor/005-stop-swallowing-errors`
- Commit per file (or single commit for all three)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `debugLog` imports where missing

Check which files already import `debugLog`:

- `packages/core/src/discovery.ts` — does NOT import `debugLog`. Add:
  ```ts
  import { debugLog } from "./debug";
  ```

- `packages/core/src/parse.ts` — ALREADY imports `debugLog` at line 12. No change needed.

- `packages/opencode-agent-skills-md/src/host.ts` — does NOT import `debugLog`. Add:
  ```ts
  import { debugLog } from "opencode-agent-skills-md-core";
  ```

### Step 2: Add `debugLog` to `findSkillsRecursive` catch in `discovery.ts:87`

Old:
```ts
  } catch { }
```

New:
```ts
  } catch (error) {
    debugLog("findSkillsRecursive: cannot access baseDir", baseDir, error);
  }
```

**Verify**: `grep -A2 'debugLog.*findSkillsRecursive' packages/core/src/discovery.ts` → matches

### Step 3: Add `debugLog` to `listSkillFiles` stat error in `discovery.ts:219`

Old:
```ts
        } catch { }
```

New:
```ts
        } catch (error) {
          debugLog("listSkillFiles: cannot stat", fullPath, error);
        }
```

**Verify**: `grep -A2 'debugLog.*listSkillFiles' packages/core/src/discovery.ts` → matches

### Step 4: Add `debugLog` to `parseSkillFile` file read in `parse.ts:91`

Old:
```ts
const content = await fs.readFile(skillPath, 'utf-8').catch(() => null);
```

New:
```ts
const content = await fs.readFile(skillPath, 'utf-8').catch((error) => {
  debugLog("parseSkillFile: cannot read", skillPath, error);
  return null;
});
```

**Verify**: `grep -A3 'parseSkillFile.*cannot read' packages/core/src/parse.ts` → matches

### Step 5: Add `debugLog` to `getSessionContext` catch in `host.ts:97`

Old:
```ts
      } catch {
        // Fall through to undefined - mirrors the legacy behaviour
      }
```

New:
```ts
      } catch (error) {
        debugLog("getSessionContext: session lookup failed", sessionID, error);
        // Fall through to undefined - mirrors the legacy behaviour
      }
```

**Verify**: `grep 'debugLog.*getSessionContext' packages/opencode-agent-skills-md/src/host.ts` → matches

### Step 6: Typecheck

**Verify**: `pnpm run typecheck` → exit 0, no errors

### Step 7: Run tests

**Verify**: `pnpm test` → exit 0, all tests pass

## Test plan

No new tests needed — the `debugLog` function is gated behind
`OPENCODE_AGENT_SKILLS_DEBUG` and has no side effects when not set.
Existing tests that exercise the error paths will continue to pass
(same behavior) but will now log when the env var is set.

To manually verify, run with debug logging:
```bash
OPENCODE_AGENT_SKILLS_DEBUG=true pnpm test 2>&1 | grep '\[opencode-agent-skills-md\]'
```

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/core/src/discovery.ts` imports `debugLog` and calls it in both catch blocks with context
- [ ] `packages/core/src/parse.ts` logs via `debugLog` when `readFile` fails for a SKILL.md
- [ ] `packages/opencode-agent-skills-md/src/host.ts` imports `debugLog` and calls it in the `getSessionContext` catch
- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The import path for `debugLog` differs between the core and plugin packages (it does: core uses `"./debug"`, plugin uses `"opencode-agent-skills-md-core"`).
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.
- Adding `error` to the log output leaks any sensitive information (in `host.ts`, the `error` may contain session data — log only the error type, not the full error object).

## Maintenance notes

- If a more structured logging system replaces `debugLog` in the future,
  these catch blocks will emit through the new system automatically.
- The `host.ts` catch in `getSessionContext` should avoid logging the full
  error object if it might contain session payload data. If unsure, log
  only `(error as Error).name` and `(error as Error).message`.
