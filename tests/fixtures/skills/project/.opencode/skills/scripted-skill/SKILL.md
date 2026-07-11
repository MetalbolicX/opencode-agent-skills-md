---
name: scripted-skill
description: A scripted skill used by the test suite to exercise use_skill, read_skill_file, and run_skill_script with a known-good structure.
---

# scripted-skill

This fixture skill is referenced by the deferred single-pass discovery tests
and the bounded-execution tests in `src/tools.test.ts`.

## Files

- `SKILL.md` - this file
- `bin/echo.sh` - a script that echoes the arguments it receives
- `docs/reference.md` - a supporting document for `read_skill_file`