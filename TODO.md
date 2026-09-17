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

## How to execute

### 1. TUI check (~5 min, needs healthy model backend)

Subagents surface in the TUI only via `@` mentions (Tab cycles primaries; `@` invokes subagents — [OpenCode agents docs](https://opencode.ai/docs/agents/)).

1. Recreate the fixture (the script traps delete it, `/tmp/bl-hookfire` may be gone):
   `mkdir -p /tmp/bl-tui && seq 1 400 > /tmp/bl-tui/big.txt && printf '{ "plugin": [["/home/joost/Developer/big-little", { "minLines": 10 }]] }' > /tmp/bl-tui/opencode.json`
2. `cd /tmp/bl-tui && opencode` (start inside the fixture so the project plugin loads; never start production OpenCode inside it).
3. Type `@bulk` — expect `@bulk-reader` in the autocomplete menu. Type `@code` — expect `@code-writer`.
4. Send `@bulk-reader what does big.txt contain?` — expect a delegated summary, no block error.
5. Send `@code-writer` with a spec + reference file — expect it to write via `edit` without running bash.
6. Tick the box. If an agent is missing from autocomplete, re-run `opencode debug config` in the fixture and check `agent` — the no-model gate from `scripts/verify-fixture.sh` isolates load problems from TUI problems.

### 2. Token benchmark (~30 min, release gate, needs healthy model backend)

Goal is a recorded before/after, not a promised percent. If delegation costs more, keep the result and note why.

1. Freeze the corpus: one multi-file Q&A task + one spec-plus-reference generation task. Commit the files and note the threshold (`minLines`) — same value for all runs.
2. Run A (baseline): answer both tasks with direct reads. Note input + output tokens from the session token display.
3. Run B (delegated reads): answer the Q&A task via `@bulk-reader` summary, then re-read only edit targets with `offset/limit`. Note tokens.
4. Run C (delegated write): generate from spec + reference via `@code-writer`; caller reads the reference only, generated code stays out of chat. Note tokens.
5. Record corpus, models, threshold, and before/after counts with the release notes. Tick the box.

### 3. Release (~15 min + npm account with 2FA)

`big-little` is unscoped, so it publishes public by default (no `--access` flag needed). `prepublishOnly` rebuilds `dist` automatically.

1. `git checkout main && git pull && git merge feat-big-little && npm test` — merge only on green.
2. `npm login` (needs an npm account with 2FA; OTP is prompted at publish).
3. Bump `version` in `package.json` if this is not `0.1.0` anymore.
4. `npm publish` — verify the tarball first with `npm pack --dry-run` (expect only `dist/` + `README.md`).
5. Confirm install path works: in a scratch dir, `opencode.json` with `{ "plugin": ["big-little"] }`, restart OpenCode, `opencode debug config` shows both agents.
6. Record with the release notes: OpenCode version, `@opencode-ai/plugin` version, benchmark numbers from step 2. Tick the box. (Later: switch to npm trusted publishing via GitHub Actions OIDC to drop the long-lived token.)
