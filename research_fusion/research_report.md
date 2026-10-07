# Fusion Pattern Research Report — for big-little OpenCode v2 plugin

Date: 2026-10-04
Question: How does Devin Fusion work, and how to implement the same pattern as an opencode v2 plugin in this repo?

Sources:
- https://cognition.com/blog/devin-fusion
- https://cognition.com/blog/local-fusion
- https://docs.devin.ai/desktop/fusion
- https://docs.devin.ai/cli/fusion
- https://opencode.ai/v2/docs/
- https://opencode.ai/v2/docs/build/plugins
- Local: src/index.ts, package.json, README.md, findings files in research_fusion/

## 1. Fusion mental model

Fusion is a harness pattern, not a model. One session runs two agents with separate contexts:

- Lead: frontier model (e.g. Fable 5.1). Owns plan, ambiguity, correctness-critical edits, final review. This is the only agent the user talks to.
- Sidekick: cheap model (e.g. SWE-2). Does bounded mechanical work: exploration, broad reads, implementation, test runs, lint fixes.

Handoff unit is a brief (task plus constraints plus success criteria), not a full transcript. Sidekick returns a result. Lead reviews and iterates, and takes control back when the sidekick is out of depth.

Second mechanism is mid-session re-routing. Lightweight classifiers detect when a task is harder than the first prompt implied. The actual model switch happens at compaction time, because compaction already pays a cache miss, so the switch costs nothing extra.

Context design: two persistent separately-cached contexts, one per agent. Only briefs, results, and feedback cross the boundary. Each side builds a cacheable prefix. This avoids the naive advisor pattern where one model resends the full history on every call.

Cost result claimed by Cognition: frontier quality at 36-60% lower cost depending on workload (FrontierCode, DeepSWE, Terminal-Bench numbers in findings_fusion-core.md). Metric is price per task, not price per token. A stronger lead can make the session cheaper because it delegates earlier and writes better briefs. Judgment-heavy tasks must stay on the lead; delegating judgment hurts quality.

Local versus cloud: both lead and sidekick remain remote API models. Local means the harness loop runs on the user machine (CLI terminal or Desktop editor, shared Devin Local harness, OS sandbox, per-command allow/ask/deny). Cloud means the loop runs in a fresh VM per session booted from a snapshot recipe. `/handoff` moves a session between them. For opencode the relevant shape is the local form.

## 2. Fusion UX (Devin Desktop + CLI)

Fusion is exposed as a model family (lead plus sidekick pairing), not as an agent mode or permission mode. It composes with plan/ask and accept-edits/bypass modes.

- CLI: `/fusion` or `/model fusion` opens a picker. Picker asks for lead, effort (reasoning before response), sidekick, fast mode (faster variant of same models, higher cost). `/session-stats` shows tokens and cost per model plus estimated savings.
- Desktop (Devin Local sessions only, v3.10.0+): composer model selector or `/model`, then pick Fusion family. `/fusion` command does not exist in Desktop.
- Recommended pairing in docs: Fable 5.1 plus SWE-2. Picker shows both per-model rates. Billing draws each side at its own rate (self-serve quota or enterprise ACUs).
- No automatic fallback is documented. The escape hatch is manual switch via `/model` or the selector.
- Gating: paid plans only, CLI 3000.10.20+, not on legacy credit plans.

Takeaway for opencode: expose one named entry point (command plus model picker equivalent), four knobs (lead, effort, sidekick, fast), and one stats view. Keep the user talking to the lead only.

## 3. OpenCode v2 plugin surface (what this repo already does)

Entrypoint: `Plugin.define({ id, setup(ctx) })` in src/index.ts, re-exported from top-level index.js for local discovery. Config arrives as `ctx.options` from the `{ package, options }` object form in opencode.jsonc.

big-little today routes two ways:

1. Static agent pins: `ctx.agent.transform` with `editor.update("bulk-reader"|"code-writer", ...)` sets description, mode subagent, system prompt, optional `model: Model.Ref.parse("provider/model")`, and a deny-by-default permission list. Routing equals which agent the caller invokes.
2. Tool guard: `ctx.tool.hook("execute.before")` inspects `read` (path without offset/limit) and `shell` (cat/head/tail/less/more targets) via line counting, and throws a delegate-to-bulk-reader message over threshold (default 350 lines). It can only mutate input or throw. It cannot switch models itself.

Other v2 levers relevant to Fusion, cheapest first:
- `ctx.generate.text({ model, prompt })`: sessionless one-shot on an explicit cheap model. Good for classifiers and brief summarization.
- `ctx.session.hook("context")`: reshape system/messages/tools/options per request. Model field is readonly here, so no per-dispatch model swap.
- `ctx.session.switchModel/switchAgent`: affects subsequent requests only. Callable from commands, tool executors, permission hooks, event subscribers.
- `ctx.command.transform`: add named commands (e.g. `/fusion`) whose executor rewrites the prompt and calls `ctx.session.prompt`.
- `ctx.permission.rules` + `hook("evaluate")`, `ctx.model.transform` (catalog filter, global default), `ctx.storage` (counters, routing state), `ctx.event.subscribe`, `execute.after` and http/retry hooks for observability.

Hard limits (verified against @opencode/plugin 2.0.16 types plus docs):
- No per-request model retarget in session context hooks.
- Tool before-hook is advisory (denial text the model must obey), not enforced dispatch.
- Agent pins are static unless re-transformed plus reload, or a switchModel call changes the session.
- Transforms are synchronous and replayable. Async catalog reads must complete before the callback.

## 4. Minimal Fusion implementation for this repo (reuse big-little)

Do not build a new harness. Extend the two mechanisms that already exist:

1. Keep static pins, add Fusion pair options: `leadModel`, `sidekickModel`, `effort` (mapped to provider reasoning options in the context hook), `fastMode` boolean. Default sidekick inherits caller model when unset, same as today.
2. Replace the line-count guard with a brief-based delegate guard: when the lead attempts a broad/mechanical unit (large read, multi-file search, test run), throw a short brief template (goal, constraints, success criteria, file scope) naming the sidekick subagent. Keep the threshold rule. Add a classifier via `ctx.generate.text` on the cheap model only where the guard is ambiguous, and cache the verdict in `ctx.storage`.
3. Add one command `/fusion` that opens the pairing (or sets it from args) and calls `switchModel` for subsequent turns. Add one stats counter (tool calls and delegate blocks per model) readable via the command, mirroring `/session-stats`.
4. Per-pair tuning from the Fusion post, applied as prompt deltas: brief detail (prescriptive for weak sidekicks, loose for strong ones), pushback (strong sidekicks may challenge the plan, weak ones must not editorialize), exploration boundary (planning-critical exploration stays on lead when the sidekick is weak).

Explicitly skip for v1: automatic compaction-time switching, cloud VM loop, sandbox parity, ACU billing. Those need server-side support opencode plugins do not expose.

## 5. Open gaps before build

- Confirm `switchModel` mid-session semantics against running opencode service version in this environment (`opencode api` + service log), because docs describe subsequent-requests effect only.
- Decide effort mapping per provider (reasoningEffort key differs; options start empty per call and overlays apply after protocol lowering).
- Measure price per task on 3-5 local sessions before tuning brief detail, because stronger sidekicks can lower total cost despite higher per-token price.
