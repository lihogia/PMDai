---
title: Link Claude sessions to items by what you say (titles, not just IDs)
type: backlog
status: review
created: 2026-11-17
---

# Link Claude sessions to items by what you say (titles, not just IDs)

Sessions are linked to an item only when they name its ID, spec file or story key. In baoquynh, the sessions working
on "room page improvements item 2" weren't linked to BAO-SEO-36, so its effort and live status were missing.

Match item titles in what you and Claude write (prompts, Claude's replies, commit messages), and treat a match like a
mention: it links the session, and code edits after it count for that item.
