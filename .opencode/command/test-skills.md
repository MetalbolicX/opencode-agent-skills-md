---
description: Run a full test of all skills plugin tools
---

Test all 4 skills plugin tools in sequence:

1. First, use `find_skills` to list all available skills
2. Then use `skill` to load the `test-skill` skill
3. Use `read_skill_file` to load `helper-docs.md` from `test-skill`
4. Use `read_skill_file` to load `example-config.json` from `test-skill`
5. Use `run_skill_script` to run the `greet` script from `test-skill`
6. Use `run_skill_script` to run the `echo-args` script from `test-skill` with arguments: `hello world --test`

Report the results of each step, noting any errors or unexpected behavior.
