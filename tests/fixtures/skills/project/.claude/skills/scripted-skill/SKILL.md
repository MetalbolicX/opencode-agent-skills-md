---
name: scripted-skill
description: Duplicate of scripted-skill in the project .claude root so discoverAllSkills() emits a "Skill name conflict:" warning per pass without relying on the HOME env var redirect.
---

# scripted-skill (.claude project duplicate)

This fixture shadows the project-root `.opencode/skills/scripted-skill`. It
exists in the project `.claude` root so that `discoverAllSkills()` finds the
same skill name in two of the four default discovery roots, triggering one
`defaultOnDuplicate` warning per pass.