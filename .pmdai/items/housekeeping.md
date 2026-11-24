---
title: Housekeeping - PMDai .gitignore and the other repos' ids.json
type: task
status: backlog
created: 2026-11-17
---

# Housekeeping - PMDai .gitignore and the other repos' ids.json

- PMDai has no `.gitignore`: `dist/` (and `node_modules/`) show up after a build.
- `.pmdai/ids.json` is uncommitted in claude-howto, emcasy, coreplatform and baoquynh. baoquynh's `.gitignore` ignores
  all of `.pmdai/`; narrow it to the billing files so its IDs can be committed.
