# PMDai

A local dashboard for the projects you build with **BMad** and **Claude Code**: status, effort and billing,
without asking Claude "what's the status?" and without opening md files.

PMDai only **reads** what your tools already write:

| Source | What PMDai gets from it |
|---|---|
| `_bmad-output/implementation-artifacts/sprint-status.yaml` (BMad v6) | Epics, stories, statuses, retro action items |
| `_bmad-output/planning-artifacts/epics.md` | Epic and story titles |
| `_bmad-output/implementation-artifacts/spec-*.md` | Stories, bugs (`type: bugfix`), backlog items, tasks, from frontmatter |
| `_bmad-output/**` other `.md`, and any `.html` | PRD, architecture, UX, briefs, retros, test artifacts; HTML mockups, walkthroughs, brainstorms (Docs tab) |
| `docs/stories/*.md` (BMad v4) | Stories with a `## Status` section |
| `.pmdai/items/*.md` | Your own bugs/tests/backlog items (frontmatter `type`, `status`, `estimate`) |
| `~/.claude/projects/**/*.jsonl` | Claude Code sessions: active time, tokens, AI cost, which item they worked on |

| Any other `.md` in the repo (and `.html` next to one) | Reports from skills and tools, e.g. `seo-audit/seo-audit-2026-11-13.md` + `.html` (Docs tab, grouped by folder) |
| Tracker files: `status.md`, `BACKLOG.md`, `todo.md`, `tasks.md`, `roadmap.md`, `findings.md`, `issues.md`, `bugs.md` (or frontmatter `pmdai: tracker`) | Work items: checkboxes, table rows under a *Done / To do / Still open / In progress* heading, and sub-headings under those |

Folders that hold a tracker or a report (like `seo-audit/`) become **workstreams**: each shows its docs, open/done items,
and the Claude time spent on it. A session counts toward a workstream when it touches files in that folder or the prompt
names it (e.g. `/seo-audit`). Dependency and build folders (`node_modules`, `vendor`, `assets`, `dist`, ...) are skipped;
add more in `docsExclude` in `pmdai.config.json`.

Folders under `projectsRoot` that only contain repos (e.g. `client-x/{website,ops}`) show one project per repo.

It **writes** only two files, inside each project repo (commit them or gitignore them):

- `.pmdai/project.yml`: customer, project type and billing settings (edited from the Settings tab)
- `.pmdai/time-entries.json`: time you log by hand (meetings, manual QA...)

## Run it

```bash
cd ~/_projects/PMDai
npm install
npm run dev        # API on :4319 + UI on http://localhost:5173 (hot reload)
# or
npm start          # builds the UI and serves everything on http://localhost:4319
npm test           # billing + parser tests
```

Requires Node 20+. Settings in `pmdai.config.json` (copy to `pmdai.local.json` to override locally):
`projectsRoot` (default `~/_projects`), `claudeDir` (default `~/.claude`), `exclude`, `extraProjects`, token `pricing`.

## How effort is measured

- **Active time**: a session's time is the sum of gaps between messages that are shorter than the
  project's idle threshold (default 10 min), plus 1 min per burst. Long breaks don't count.
- **Linking to items**: a session is linked to the item whose spec file (`spec-5-4-...md`) or story key
  (`5-4-bounce-...`) it mentions most. Sessions that mention none are "unlinked". Tip: start story work
  with the spec path in your prompt so the link is reliable.
- **AI cost**: tokens × `pricing` in `pmdai.config.json` (USD per million tokens, **placeholder values -
  check them**). On a subscription plan this is a notional cost.

## Billing modes (per project, Settings tab)

| Mode | Bills | Suggested for |
|---|---|---|
| Time & materials | tracked hours × rate (rounding, optional cap) | maintenance, discovery, unclear scope |
| Fixed per story | done stories × estimate × rate | feature work on an existing app |
| Milestone | fixed amount per BMad epic, when the epic is done | new build with an agreed PRD |
| Retainer | monthly fee + overage hours | ongoing support |
| Hybrid | fixed stories + hourly bugs / change requests | new build with change requests |

Common: bug warranty window (`delivered_on` + `bug_warranty_days`, or `warranty: true` on a bug),
AI cost absorb / pass-through / markup. The Billing tab shows an invoice draft for any period,
CSV export and print-to-PDF, plus an internal view (actual hours, AI cost, effective hourly rate).

## Layout

```
server/
  index.js            Express API + SSE live updates + static UI
  indexer/bmad.js     BMad v6/v4 + .pmdai/items parser
  indexer/tracker.js  any other reports + tracker files (status.md, BACKLOG.md...) -> docs, items, workstreams
  indexer/claude.js   Claude Code transcript parser (active time, tokens, attribution)
  indexer/index.js    project discovery, in-memory index, file watchers
  settings.js         .pmdai/project.yml + time entries
  billing.js          invoice engine for the 5 modes
web/src/              React UI (portfolio, board, items, docs, effort, time, billing, settings)
```

## Privacy

PMDai runs only on your machine (`127.0.0.1`). It reads your repos and Claude Code transcripts and sends nothing anywhere.

## Roadmap ideas

- Claude Code hooks (`SessionStart`/`Stop`) to tag sessions with the story explicitly
- Edit item status from the board (write back to md / sprint-status.yaml)
- SQLite history snapshots (burn-down over time), invoice numbering and PDF templates
- Share: `npx pmdai`

## License

MIT
