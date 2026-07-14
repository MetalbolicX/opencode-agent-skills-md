---
description: Verify skills list was re-injected after compaction
---

Run this after manually triggering compaction to verify the skills plugin re-injected the available skills list.

1. Use `find_skills` to confirm skills are still discoverable
2. Use `skill` to load `test-skill` to confirm the tool still works
3. Report whether the `<available-skills>` block is visible in context
