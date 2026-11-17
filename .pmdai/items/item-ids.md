---
title: Short IDs on every item, and get Claude to mention them
type: backlog
status: backlog
created: 2026-11-17
---

# Short IDs on every item, and get Claude to mention them

Every item gets a short, human-friendly ID built from the project and the item type, e.g.:

- `PMD-E2-3`: project abbreviation, epic 2, story 3
- `PMD-BUG-4`: bug 4
- `PMD-BL-7`: backlog item 7

Show it on Board, Items and the item dialog, and make it searchable.

## Open questions

- Project abbreviation: set in the Settings tab (`.pmdai/project.yml`), with a default derived from the name.
- IDs must be stable. BMad stories can derive theirs (epic + story number). `.pmdai/items` can store `id:` in frontmatter.
  Tracker items (checkboxes, table rows, headings in BACKLOG.md...) have nowhere to store one, unless PMDai writes it
  into the line, e.g. `- [ ] PMD-BL-7 Fix footer`.

## Getting Claude to mention the ID

Nothing can strictly force it, but in order of strength:

1. **CLAUDE.md rule** in each project: "When working on a tracked item, name its ID (e.g. PMD-BUG-4) in your first reply."
   Usually followed, not guaranteed.
2. **`UserPromptSubmit` hook** (Claude Code settings): runs on every prompt. If the prompt has no item ID, it can
   inject the list of open items so Claude names the matching one, or remind you to add one. It can even block prompts
   without an ID, though that gets annoying for small questions.
3. Either way, PMDai should match the ID in session transcripts (next to the spec-path / story-key matching it already
   does in `server/indexer/claude.js`), so a single mention links the session to the item.
