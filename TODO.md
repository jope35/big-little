# big-little follow-ups

Remaining work after `feat-big-little` (plan: `docs/superpowers/plans/2026-09-16-big-little.md`).

## Done

- [x] Tasks 1–6: scaffold, threshold, bash extractor, agents, routing, wiring (29 tests green)
- [x] Task 7 automated: README, `scripts/verify-fixture.sh` passes normal + `SANDBOX=1`
- [x] Hook-fire proof (2026-09-17, `opencode/muse-spark-1.3-contributor-free`, fixture `/tmp/bl-hookfire`, `minLines: 10`): full read blocked, offset/limit read OK, `cat` blocked
- [x] Branch pushed to `origin/feat-big-little`

## Open

- [x] Open PR: https://github.com/jope35/big-little/pull/1 (base `main`)
- [ ] TUI check: `@bulk-reader` and `@code-writer` autocomplete in a fixture session
- [ ] Token benchmark (release gate, plan Task 7 Step 6): freeze corpus + threshold, run direct vs delegated vs code-writer, record counts with release notes
- [ ] Release: `npm run build`, publish `big-little` to npm, record OpenCode version (`1.18.31`) and `@opencode-ai/plugin` version with release notes
