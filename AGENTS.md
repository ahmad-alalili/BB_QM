# Maintenance-first development

This checkout publishes BB_QM to GitHub Pages. A push to main updates the live
site. Do not push or deploy without a current, explicit user request. Preserve
unrelated changes and do not alter the separate Cloudflare service or counters.

## Structure and compatibility

- Read `docs/دليل-المطور.md` before changing behavior.
- Preserve public version 2.5 and the 250-question limit unless requested.
- Keep Arabic/English, scoring, previews, privacy preferences, local fonts,
  file:// operation, and Native bank/test formats compatible.
- `core.js` is the stable public facade; implementations belong in `src/core/`.
- `app.js` composes controllers; feature code and shared state belong in `src/ui/`.
- Keep core independent of DOM/UI and imports acyclic. Use descriptive names,
  small single-purpose files, behavioral tests, and update the developer map.
- `archive/` is historical reference, not a second executable application.

## Verification and publishing

- Run `npm run check` and `npm test` before release.
- For UI changes, check desktop and phone layouts and the affected full workflow.
- Do not regenerate release fixtures to hide regressions. Local validation is
  not a substitute for testing import and grading inside Blackboard.
- Inspect the Git diff and exclude credentials, local captures, and test outputs.
- Publish with a normal push, preserve history, then verify the Pages deployment
  and the live assets for that commit. Never use a force push as a shortcut.
