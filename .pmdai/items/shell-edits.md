---
title: Count shell edits as implementing
type: backlog
status: backlog
created: 2026-11-17
---

# Count shell edits as implementing

Live status counts only Claude's Edit/Write tool calls as code edits. Much real work goes through the shell
(sed, scripts, `git apply`), so items show *investigating* while they're being built.

Find out whether transcripts record which files a shell command changed, and count those too.
