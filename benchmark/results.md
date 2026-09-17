# Benchmark results

- Date: 2026-09-17 (runs ~23:44–23:50 UTC)
- Corpus VERSION: 1. Commit SHA: `85673b0` (corpus files in `benchmark/corpus/` staged, frozen; QA: `orders.ts` 209 lines, `inventory.ts` 180, `pricing.ts` 157; reference `reference.user.dto.ts` 45 lines)
- Threshold: `minLines: 100` for runs B and C. Run A loads no plugin.
- Primary model for all runs: INTENDED `opencode/muse-spark-1.3-contributor-free` for A, B, C. ACTUAL: A and B used it; C used `melious/glm-5.3` for primary + worker (see deviation note — free-tier backend blocks edit-capable subagents).
- `bulkReaderModel` for runs B and C: unset (inherit caller model) for run B. Run C worker inherited its (paid) primary.
- `codeWriterModel` for runs B and C: unset (inherit). Three free-tier `@code-writer` dispatches failed with 0 worker tokens (see note); successful run C used paid primary so the worker inherited `melious/glm-5.3`.
- OpenCode version from `opencode --version`: `1.18.31`
- `@opencode-ai/plugin` version: `1.18.31`

Method: each task ran as an isolated OpenChamber session in its run folder (`/tmp/bl-bench-a|b|c` from `scripts/benchmark-setup.sh`, gates 4× OK). Counts below are `tokens.input` / `tokens.output` from `session.list (withStatus)`. Worker rows are the `@bulk-reader` / `@code-writer` subagent child sessions. All answers verified correct (Q&A cited `finalTotalCents`, coupon→tier→overdue stack, `shippableStates`, `submitted`+`isOverdue`, `TAX_RATE 0.21`; both generated DTOs pass `tsc --noEmit --strict --lib es2020,dom`).

## Token counts

| Run | Task | Input | Output | Notes |
| --- | --- | --- | --- | --- |
| A | Questions with direct reads | 19494 | 815 | primary only, no plugin; reasoning 419, cache-read 26963 |
| A | Generation with direct reads | 18745 | 1659 | primary only; generated file in caller context; reasoning 3275, cache-read 189516 |
| B | Questions with `@bulk-reader` and `offset/limit` (caller) | 18594 | 1499 | primary; reasoning 805, cache-read 58165 |
| B | `@bulk-reader` worker | 10142 | 1674 | subagent, same free-tier model; worker pages files via `offset/limit` (hook blocks its full reads too); reasoning 1788, cache-read 18884 |
| C | Generation with `@code-writer` (caller, paid primary) | 3067 | 674 | primary `melious/glm-5.3`; reference read only, generated code stayed out of chat; reasoning 64, cache-read 69632, cost $0.0223 |
| C | `@code-writer` worker (paid) | 4535 | 1207 | subagent `melious/glm-5.3`; wrote file via `edit`; reasoning 1425, cache-read 19136, cost $0.0188 |

Failed `@code-writer` attempts on free-tier (recorded, not in totals): three primaries (`18428/999`, `15607/586`, `15883/553`) each with a `code-writer` child at `0/0` tokens failing with `Subagent failed: OpenCode's free tier can only be used from within OpenCode`. Pinning `codeWriterModel: melious/glm-5.3` under a free-tier primary still failed the same way — the block follows the free-tier caller with an edit-capable subagent, not the worker model. `@bulk-reader` (read-only, edit deny) works fine on the same free-tier caller (probe worker `3299/220` OK). Config verified via `opencode debug config` (`code-writer` model pin resolves correctly); this is a backend policy limit, not a plugin bug.

## Totals

- Run A total (in and out): in `38239`, out `2474`
- Runs B and C total (in and out): system total (callers + workers) in `36338`, out `5054`. Caller-only total (primary context — the context the plugin protects) in `21661`, out `2173`.
- Change in percent (in and out): system input `-5.0%`, system output `+104.3%`. Caller-only input `-43.4%`, caller-output `-12.2%`.
- Per-task split: Q&A caller input `-4.6%` but caller output `+83.9%` (delegation overhead); Q&A system total input `+47.4%`, output `+289.3%` (worker re-reads all three files in chunks + summary + primary re-reads). Generation system total input `7602` vs `18745` direct (`-59.4%`); generation caller input `3067` vs `18745` (`-83.6%`) — the saving the test targets.
- Result: keep the numbers even if delegation costs more, and note the cause. Mixed, as the design predicts: (1) Q&A delegation COSTS more end-to-end on this 3-file corpus because the worker must still page through every file (`offset/limit` chunks) and its summary + the caller's verification re-reads add overhead on top of what a direct read loads once. Bulk-reader's win is caller-context discipline (`-900` input tokens vs direct) plus filtering value that only pays off on larger corpora where the worker's grep/glob skips most files — not measured here. (2) Code-writer delegation SAVES a lot of caller input (`-83.6%`) because the generated file never enters chat; system input also saves (`-59.4%`) since the worker reads only spec + 45-line reference. Output tokens rise in both delegated tasks (summaries, coordination). (3) Release note: on the free-tier backend `@code-writer` cannot run at all (edit-capable subagent blocked, 3× `0`-token failures); the C numbers above use a paid primary (`melious/glm-5.3`, ~$0.041 combined) and are therefore not apples-to-apples with A/B on model. Re-run C on the free tier after the backend allows edit subagents, or standardize all runs on one paid model, before claiming a single headline percent.
