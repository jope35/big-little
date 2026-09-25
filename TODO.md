# big-little follow-ups

Remaining work after `feat-big-little` (plan: `docs/superpowers/plans/2026-09-16-big-little.md`).

## Done

- [x] Tasks 1–6: scaffold, threshold, bash extractor, agents, routing, wiring (29 tests green)
- [x] Task 7 automated: README, `scripts/verify-fixture.sh` passes normal + `SANDBOX=1`
- [x] Hook-fire proof (2026-09-17, `opencode/muse-spark-1.3-contributor-free`, fixture `/tmp/bl-hookfire`, `minLines: 10`): full read blocked, offset/limit read OK, `cat` blocked
- [x] Branch pushed to `origin/feat-big-little`

## Open

- [x] Open PR: https://github.com/jope35/big-little/pull/1 (base `main`)
- [x] TUI check: `@bulk-reader` and `@code-writer` autocomplete in a fixture session
- [x] Token benchmark (release gate, plan Task 7 Step 6): corpus (VERSION 1) + `minLines: 100`, runs A/B (free-tier) + C (paid primary, free-tier blocks edit-subagents); counts were recorded under `benchmark/` and have been removed pending a re-run on OpenCode 2.x (see validation log below)
- [ ] Release: `npm run build`, publish `big-little` to npm, record OpenCode version (`2.0.16`) and `@opencode/plugin` version with release notes

## V2 port validation log (2026-09-24, OpenCode 2.0.16, `@opencode/plugin 2.0.16`)

V2-only cutover per `docs/plan_etc.md` (Tasks 1-6). All gates green:

- Unit: `npm run build` + `npm test` → 34/34 pass.
- Fixture: `scripts/verify-fixture.sh` and `SANDBOX=1 scripts/verify-fixture.sh`
  (Docker clean room) → `fixture proof passed` in both, no model calls.
- Live session (free-tier model, scratch dirs only): full `read` of a 400-line
  file blocked with `File is 401 lines (threshold: 350)...`; targeted
  `offset/limit` reads and small `cat` pass; `@bulk-reader` delegated summary
  and `@code-writer` write-via-`edit` both ran (agent ids recorded in session
  table). Packed-tarball install (`npm pack` → install tgz in scratch dir)
  loads and registers both agents.
- Deviations from the plan found by validation (kept minimal, all tested):
  1. V2 `read` input key is `path`, not `filePath` (migration doc example is
     wrong; locked from live tool-call records). `filePath` still accepted
     defensively.
  2. Models send relative paths; the hook resolves them against the calling
     session's directory (cached `ctx.session.get`, fail open). Without this,
     relative reads bypass the guard.
  3. Local plugin directories need a top-level `index.js`/`index.ts`
     entrypoint (`main: dist/index.js` alone is silently skipped by discovery);
     added `index.js` re-export (npm consumers unaffected via `exports`).
  4. `debug agents` does not reflect plugin-registered agents and project
     plugins only load on location boot, so the fixture asserts via
     `session.create` + `agent.list?location[directory]=` instead of
     `debug config` / `debug agent`.
- Benchmark numbers under `benchmark/` were recorded on the old major version; re-run on V2 before
  relying on them for a release gate.
- Release row below still targets npm publish; versions to record at release:
  OpenCode `2.0.16`, `@opencode/plugin` `2.0.16` (locked in `package.json`).

## How to execute

### 1. TUI check (~5 min, needs healthy model backend)

Subagents surface in the TUI only via `@` mentions (Tab cycles primaries; `@` invokes subagents — [OpenCode agents docs](https://opencode.ai/docs/agents/)).

1. Recreate the fixture (the script traps delete it, `/tmp/bl-hookfire` may be gone):
   `mkdir -p /tmp/bl-tui && seq 1 400 > /tmp/bl-tui/big.txt && printf '{ "$schema": "https://opencode.ai/config.json", "plugins": [{ "package": "/home/joost/Developer/big-little", "options": { "minLines": 10 } }] }' > /tmp/bl-tui/opencode.json`
2. `cd /tmp/bl-tui && opencode` (start inside the fixture so the project plugin loads; never start production OpenCode inside it).
3. Type `@bulk` — expect `@bulk-reader` in the autocomplete menu. Type `@code` — expect `@code-writer`.
4. Send `@bulk-reader what does big.txt contain?` — expect a delegated summary, no block error.
5. Send `@code-writer` with a spec + reference file — expect it to write via `edit` without running shell.
6. Tick the box. If an agent is missing from autocomplete, boot the fixture location (`opencode api session.create -d '{"location":{"directory":"/tmp/bl-tui"}}'`) and check `opencode api agent.list --param 'location[directory]=/tmp/bl-tui'` — the no-model gate from `scripts/verify-fixture.sh` isolates load problems from TUI problems.

### 2. Token benchmark (~30 min, release gate, needs healthy model backend)

Goal is a recorded before/after, not a promised percent. If delegation costs more, keep the result and note why.

1. Freeze the corpus: one multi-file Q&A task + one spec-plus-reference generation task. Commit the files and note the threshold (`minLines`) — same value for all runs.
   Setup is frozen in `benchmark/`. The corpus is VERSION 1. The threshold is `minLines: 100`. The prompts are in `benchmark/README.md`. The script `scripts/benchmark-setup.sh` makes the run folders. Results go in `benchmark/results.md`.
2. Run A (baseline): answer both tasks with direct reads. Note input + output tokens from the session token display.
3. Run B (delegated reads): answer the Q&A task via `@bulk-reader` summary, then re-read only edit targets with `offset/limit`. Note tokens.
4. Run C (delegated write): generate from spec + reference via `@code-writer`; caller reads the reference only, generated code stays out of chat. Note tokens.
5. Record corpus, models, threshold, and before/after counts with the release notes. Tick the box.

### 3. Release (~15 min + npm account with 2FA)

`big-little` is unscoped, so it publishes public by default (no `--access` flag needed). `prepublishOnly` rebuilds `dist` automatically.

1. `git checkout main && git pull && git merge feat-big-little && npm test` — merge only on green.
2. `npm login` (needs an npm account with 2FA; OTP is prompted at publish).
3. Bump `version` in `package.json` if this is not `0.1.0` anymore.
4. `npm publish` — verify the tarball first with `npm pack --dry-run` (expect only `dist/` + `index.js` + `README.md`).
5. Confirm install path works: in a scratch dir, `opencode.json` with `{ "plugins": ["big-little"] }`, boot the location and check `opencode api agent.list` shows both agents.
6. Record with the release notes: OpenCode version, `@opencode/plugin` version, benchmark numbers from step 2. Tick the box. (Later: switch to npm trusted publishing via GitHub Actions OIDC to drop the long-lived token.)
