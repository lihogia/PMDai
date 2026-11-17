---
title: Item status follows the work (investigating, in progress)
type: backlog
status: done
completed: 2026-11-17
created: 2026-11-17
---

# Item status follows the work (investigating, in progress)

When an item is mentioned in a Claude session and gets investigated or implemented, PMDai should show that status.
Today most items only ever show **Backlog** or **Done**: tracker checkboxes are `[ ]` / `[x]`, and `.pmdai/items`
only have what's written in frontmatter. Only BMad's `sprint-status.yaml` gives the in-between statuses
(ready, in-progress, review).

## Options

- **Derive it (read-only, no file changes):** an open item linked to a Claude session in the last N days shows as
  in progress. Sessions that only read files count as *investigating*; sessions that edit files (Edit / Write tool
  calls) count as *implementing*. Needs a new "Investigating" column or sub-status.
- **Write it back:** a Claude Code hook, or PMDai itself, updates the item's `status:` frontmatter. More permanent,
  but changes files in the project repo. Doesn't work for checkbox items, which have no status field.

Depends on the item IDs item (`item-ids.md`): reliable status needs reliable item mentions.
