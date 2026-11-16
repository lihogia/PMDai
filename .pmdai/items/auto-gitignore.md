---
title: Add PMDai files to a project's .gitignore when integrating it
type: backlog
status: backlog
created: 2026-11-16
---

# Add PMDai files to a project's .gitignore when integrating it

When PMDai picks up a project folder, if that project has a `.gitignore`, add the PMDai entries to it automatically
(e.g. `.pmdai/time-entries.json`, `.pmdai/project.yml`). Don't add any that are already there, and don't create a `.gitignore` if the project has none.
