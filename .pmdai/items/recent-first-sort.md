---
title: Board and Items show just-changed and just-added items first
type: backlog
status: review
created: 2026-11-17
---

# Board and Items show just-changed and just-added items first

In Board (each column) and Items, items whose status just changed, or that were just added, come first.
All other items are sorted by when they were added or last updated, newest first.

## Notes

- Today both views sort by `updated` only, and `updated` is the file's modification time. Items from a tracker file
  (BACKLOG.md, status.md...) all share that file's time, so editing one line "updates" every item in it.
- PMDai keeps no history, so it can't tell when an item's status changed or when it first appeared. It needs to
  remember the last status it saw per item, with `statusChangedAt` and `firstSeenAt`. That could sit next to the
  IDs in `.pmdai/ids.json`, or in a separate state file.
- Decide what "just" means: e.g. the last 24 hours, or since you last opened the project.
- Mark them visibly (e.g. a "new" or "moved" badge), so it's clear why they're on top.
