---
title: Some HTML docs don't render correctly
type: bug
status: backlog
created: 2026-11-16
---

# Some HTML docs don't render correctly

Some HTML files don't display correctly, even when opened directly in the browser outside PMDai.
Example: ontrack `_bmad-output/planning-artifacts/architecture/architecture-ontrack-2026-11-08/architecture-walkthrough.html`
(~100 KB, one inline `<script>`, no external CSS or JS).

Note: PMDai shows HTML in an iframe with `sandbox=""`, so scripts never run there. Pages that build their content with JS will look broken inside PMDai even when the file itself is fine.
