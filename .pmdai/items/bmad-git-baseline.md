---
title: Use git history for BMad items in "just changed"
type: backlog
status: backlog
created: 2026-11-17
---

# Use git history for BMad items in "just changed"

The first run compares tracker files with their version from `justChangedHours` ago in git, so recent moves show right
away. BMad items (spec frontmatter, `sprint-status.yaml`) don't get this yet: compare `sprint-status.yaml` and spec
statuses with their earlier versions too, so emcasy or ontrack show today's story moves.
