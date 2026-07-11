---
name: scripted-skill
description: Duplicate of the scripted-skill fixture placed in the home root so discoverAllSkills() emits a "Skill name conflict:" warning per pass. Used by the single-pass tool discovery tests.
---

# scripted-skill (home root duplicate)

This fixture shadows the project-root `scripted-skill`. It exists solely to
trigger `defaultOnDuplicate` once per discovery pass so the single-pass tool
discovery tests can count warnings without mocking.