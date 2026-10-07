# Devin Fusion – Core Findings

## 1. What Fusion Is

**Devin Fusion** is Cognition's multi-model agent harness (announced 2026-06-29), not a model itself.
Instead of running one frontier model for an entire coding session, it runs **two fully-capable agents in parallel**:

- **Lead / main agent** – frontier model (e.g. Fable 5.1, Opus 5, GPT-6 Astra, GPT-5.6 Sol). Owns plan, ambiguity resolution, final review. User-facing.
- **Sidekick agent** – cheaper, cost-effective model (e.g. Cognition SWE-2, GPT-5.6 Luna). Executes delegated mechanical work.

Headline claim (updated 2026-08-07 data):
- Frontier / Fable-5-level score on **FrontierCode 1.1 Extended** at **up to 60% lower cost** (original post said 35%; later data says up to 60%, largest gains in implementation-heavy sessions). Example: Fusion 63.1 @ $1.35 vs Fable 5 xhigh 64.9 @ $10.53 / Opus 5 medium 63.6 @ $3.51.
- In Desktop/CLI launch (2026-09-11): **up to 39% more efficient** vs other harnesses on Artificial Analysis Coding Agent Index v1.5. E.g. Fusion (Fable 5.1 + SWE-2) 61.7 @ $7.90 vs Claude Code + Fable 5.1 62.2 @ $12.36 (−36%); Fusion (Astra + SWE-2) 58.9–61 @ $4.54 vs Codex + Astra 61.6 @ $7.47 (−39%).
- Benchmark table (Fable 5.1 + SWE-2 sidekick): DeepSWE 1.1 −46%, Terminal-Bench 4 −23%, SWE-Atlas QnA −34%, Vals Code Migration −41%, FrontierCode 1.1 Ext −38%. Astra + SWE-2: −11% to −40%.
- Internal sanity check: **88% of merged PRs driven entirely by automated Fusion router** in Cognition dogfood.

Sources:
- https://cognition.com/blog/devin-fusion
- https://cognition.com/blog/local-fusion ("Introducing Fusion in Devin Desktop & CLI")

## 2. Local vs Cloud Split – What Runs Where

Fusion is a harness pattern available in **both loops**. It does **not** mean local-weight inference; both lead and sidekick are API models (Anthropic, OpenAI, Google, Cognition, open-weights). "Local" refers to where the *harness loop* runs:

| Surface | Loop | Where it runs | Fusion form |
|---|---|---|---|
| Devin Cloud agent | Cloud | Fresh VM booted per-session from frozen snapshot (`.devin/blueprint.yaml`: `initialize`/`maintenance`/`knowledge`) | Preview announced June; Fusion as cloud session mode (`fusion` alongside `normal/fast/lite/ultra`) |
| Devin CLI | Local | User terminal, user repo/shell/credentials | `devin`, `/fusion` picks lead + effort + sidekick, `/session-stats` shows cost by model. Needs paid plan, CLI ≥3000.10.20 |
| Devin Desktop | Local (Devin Local agent) | Inside editor (ex-Windsurf), same harness as CLI. Desktop ≥3.10.0 | Same picker; model docs list SWE/Fable/GPT/Gemini/open-weights |

Key local properties (Devin Local = CLI harness):
- Token-efficient, prompt-cache-focused; ~30% fewer tokens than Cascade for same task.
- OS-level `--sandbox` (fail-closed filesystem isolation + network allow/deny), fine-grained Allow/Ask/Deny permissions for Read/Write/exec/fetch/MCP.
- Subagents (markdown under `agents/`), foreground/background, own conversation chain; skills/MCP/hooks/Claude-Code plugins work as-is; plan mode writes `~/.devin/plans/plan-*.md`; worktree support.
- No memories/workflows (migrate to skills); no local persistence across sessions except via files.

Bridge:
- `/handoff` moves CLI local session → Cloud VM session (carries repo+branch, conversation context, uncommitted changes; tools/deps come from snapshot, secrets from Devin secret store — shell env and `node_modules` do NOT carry). Reverse: `devin --cloud` + `/handoff` fetches PR branch locally. Also handoff plugin for Claude Code/Codex/Cursor → Devin Cloud.
- Cloud = one VM per session/child (fleet); durable state is the image recipe, not the transcript.

Sources: local-fusion post; https://docs.devin.ai/desktop/devin-local ; https://devin.ai/cli ; third-party harness breakdown https://rohitghumare.com/blog/inside-the-devin-harness/

## 3. Routing Logic

Two mechanisms (devin-fusion post § "sidekick" + "Dynamic Mid-Session Routing"):

**A. Sidekick delegation (intra-session, continuous):**
- Lead decides per-subtask what to self-do vs delegate. Tuned default: **lead takes minimal actions, reads only what's necessary; delegates and monitors**.
- Handoff unit is a **brief with constraints + success criteria**, not full transcript. Sidekick explores/implements/tests and reports back result. Lead reviews, iterates, can take control back if sidekick out of depth.
- Initial model choice per task type/complexity (lead model + sidekick model selected up front; in CLI user picks both explicitly — recommended Fable 5.1 lead + SWE-2 sidekick).

**B. Dynamic mid-session routing (lightweight classifiers + free switch at compaction):**
- Lightweight classifiers run during execution; signal when to escalate sidekick→lead or swap models entirely (e.g. task harder than initial prompt suggested).
- Switch is done **at context-compaction time**, which incurs a cache miss anyway → model switch is effectively "free" (no extra cache penalty). Can even upgrade sidekick without returning to lead.

Why not single-shot router or "advisor tool":
- Initial prompt insufficient ("Fix xyz bug" = 1-line fix vs re-architecture); need mid-task mobility + follow-ups.
- Naive "Smart Friend / Advisor" (one model queries another per-call, resending full context) pays full price every call. Fusion avoids this with dual persistent contexts (see §5).

Related router: **Adaptive** (separate from Fusion) routes *each prompt* to fast vs capable model, flat rate $0.50/M in / $2.00/M out / $0.10/M cache-read on self-serve, cache-aware (prefers staying on one model). `devin --model adaptive`, `/model adaptive`.

## 4. Latency / Privacy / Cost Goals

- **Cost (primary):** stop using most-expensive model for every turn. Turn breakdown on FrontierCode: Plan 32%, Setup 34%, Implementation 5%, Debug 17%, Validate 9%, Closeout — much is mechanical (long test runs, broad removals) delegable at no quality loss. Examples: ES6 modernize + slow Playwright suite delegated → −62% ($3.55→$1.37), score 98→100; OpenTracing removal → −32% same quality; hard-but-mechanical LangChain4j/Quarkus reuse → −25% and *beat* solo. Failure mode: judgment-is-deliverable tasks (cross-team React/Redux flag-gated feature) delegated → score 54→27 — lead must not delegate judgment.
- **Cost paradox:** "More expensive models can make Fusion cheaper." Evaluate **price per task, not per token**. Fable lead (2× $/token vs Opus 4.8) → 9% cheaper sessions + higher score (delegates earlier, better briefs, less micromanagement/rework). Stronger sidekick SWE-2 ($0.75/Mtok, +275% vs GPT-5.6 Luna $0.20/Mtok) → Astra Fusion 63.4 @ $2.34 vs 62.0 @ $2.39 (−2%): fewer turns/attempts + less lead review corrects offset.
- **Latency:** side benefit via token/turn efficiency and stronger sidekicks needing fewer rounds; SWE-1.7 Lightning on Cerebras and `SWE-1-mini`/`swe-grep`/`swe-check` cover passive/fast paths. No hard latency numbers claimed for Fusion itself; efficiency framed as cost + turns.
- **Privacy/isolation:** local loop = your machine, your creds, OS sandbox + deny rules (`Read(**/*.pem)` hides paths whole session); cloud loop = fresh VM per session, secrets injected, absent from image. No claim that Fusion keeps data on-device — both models are remote APIs.

## 5. Context Handling

- **Two persistent, separately-cached contexts**, one per agent, each with own tools. Only **briefs / results / feedback** cross the boundary — sidekick doesn't need lead's full history; lead doesn't need every tool trace. Each builds cacheable prefix.
- Explicitly engineered around **~5-minute cache-input expiry** (post invites trading notes: walden@cognition.ai).
- **Compaction as switch point** (see §3B). CLI exposes `/compact`, `/context`, `/recap`; local-fusion notes turn distribution motivates keeping planning context in lead, execution traces in sidekick.
- User always talks to lead (frontier polish); sidekick invisible.

## 6. Model Selection & Task Decomposition Details

- **Recommended pairings:** Fable 5.1 (lead) + SWE-2 (sidekick); Astra (high) + SWE-2. Sidekick options studied: GPT-5.6 Luna (high) vs SWE-2 (medium). Lead options: Fable 5/5.1, Opus 5/4.8, GPT-5.6 Sol, Astra, Kimi K3, Grok 4.5/4.6, Muse Spark, GLM, DeepSeek, Qwen, Gemini Flash. CLI `/model` switches mid-session; `/fast` jumps to fastest.
- **Decomposition:** lead owns plan / ambiguity / correctness-critical edits / review; sidekick does codebase exploration (bounded), file reads, implementation, test runs, lint fixes, reports back. Works because most coding tasks separate into well-defined phases.
- **Per-pair harness tuning** (not one-size-fits-all; same prompt can help one pair, hurt another):
  1. *Brief detail:* weaker sidekick → more prescriptive briefs (more lead tokens upfront, fewer review rounds); SWE-2 → leave implementation detail to sidekick.
  2. *Pushback:* encourage strong sidekick to challenge plan (catches lead mistakes); forbid weak sidekick opinionatedness (hurts score+cost).
  3. *Exploration boundary:* planning-critical exploration stays with lead when sidekick weak (weak model can't judge what's relevant); strong sidekick may do initial exploration. Active research area.
- **Scaling observation:** Fable delegates/briefs/plans better than Opus → larger Fusion savings; pattern expected to improve as base models get smarter. Fable-specific tuning incomplete at publish (access suspended 2026-06-12 per US directive; Fable numbers pre-suspension).
- **Task-type fit:** mechanical/broad/slow-verify → delegate; judgment/subtle-intent → keep on lead.

## Key Facts Recap

- Fusion = lead + sidekick parallel agents, brief-based delegation + classifier-driven mid-session switches at compaction.
- Available cloud (VM snapshot loop) and local (CLI/Desktop on-machine loop); `/handoff` bridges them.
- No on-device model; "local" = harness location, models remain API.
- Dual cached contexts; minimal cross-talk; cache-miss-aware switching.
- Goal: frontier quality at 36–60% lower cost; price-per-task metric; per-pair tuning required.
