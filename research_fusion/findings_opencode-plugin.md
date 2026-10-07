# OpenCode v2 Plugin API — Fusion-style Model Routing Findings

Sources:
- https://opencode.ai/v2/docs/
- https://opencode.ai/v2/docs/build/plugins (full hooks/transform reference; truncated webfetch body archived under `~/.local/share/opencode/tool-output/`)
- https://opencode.ai/v2/llms.txt (docs index only — no plugin API detail)
- Local: `@opencode/plugin@^2.0.16` type declarations in `node_modules/@opencode/plugin/dist/promise/*.d.ts`, `@opencode/schema/dist/model.d.ts`
- Local repo: `src/index.ts`, `package.json`, `README.md`

## 1. Plugin entrypoint shape (`Plugin.define`)

```ts
import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "big-little",
  async setup(ctx) { /* ... */ },
  // or: return () => console.log("unloaded");  // cleanup on unload
});
```

- File plugins live under `.opencode/plugins/` and load automatically; published packages / paths load via `plugins` in `opencode.jsonc` (string or `{ package, options }` object form).
- `setup` runs at load; may return async cleanup. V1 compat: same default export can also carry `server()` — V2 ignores it, V1 ignores `setup`.
- Package manifest needs `"type": "module"`, `dependencies: { "@opencode/plugin": ... }`, optional `./rpc` export for shared RPC contracts.

## 2. Setup ctx capabilities (Promise plugin, from `plugin.d.ts`)

`ctx` = server client + plugin-only methods. Domains relevant to routing:

| Domain | Reads | Writes / routing levers |
|---|---|---|
| `ctx.agent` | `list()`, `get({agentID})` | `transform(editor)`, `reload()` |
| `ctx.model` | `list()`, `default()` | `transform(editor)`, `reload()` |
| `ctx.provider` | `list()`, `get({providerID})` | `transform(editor)`, `reload()` |
| `ctx.session` | `create/get/context(...)` | `switchAgent`, `switchModel`, `prompt/generate/command/synthetic`, `interrupt/wait/update/move/remove/compact`, `hook(name, cb, {providerID}?)` |
| `ctx.tool` | `list()` (post-transform snapshot) | `transform(editor)`, `reload()`, `hook("execute.before"/"execute.after")` |
| `ctx.generate` | — | `text({ model: Model.Ref, prompt })` — model-explicit, no session/tools/history |
| `ctx.command` | `list()` | `transform(editor add)` — executor can call `ctx.session.prompt` with rewritten text |
| `ctx.permission` | `list/get` | `reply(...)`, `rules({sessionID, permissions})`, `hook("evaluate")` |
| `ctx.storage` | `get/scan` | `set/remove` — durable JSON scoped to plugin (routing state, caches) |
| `ctx.options` | plugin options object | read-only; from `{package, options}` form in config |
| `ctx.location` | `directory`, `project{id,directory,canonical}`, `workspaceID` | read-only; instance location, not every session it touches |
| `ctx.event` | `subscribe({signal})` | observe public event stream |
| Also | `ctx.skill/reference/mcp/integration/vcs/worktree/websearch/shell` | transforms + hooks (see §6) |

## 3. Agent transform / update (what big-little uses)

```ts
await ctx.agent.transform((editor) => {
  editor.update("bulk-reader", (agent) => { Object.assign(agent, bulkInfo); });
  editor.update("code-writer", (agent) => { Object.assign(agent, codeInfo); });
});
```

- `AgentEditor`: `list() / get(id) / default(id?) / update(id, fn) / remove(id)`. Synchronous, replayable; `reload()` replays after external inputs change.
- `update` on missing id is ignored (big-little assumes `bulk-reader`/`code-writer` agent files exist in repo and upserts description/mode/system/model/permissions onto them).
- Agent model pin: `agent.model?: { providerID, id, variant? }` — static per-agent default. Absent = inherit caller model.

## 4. Tool hooks (what big-little uses)

```ts
await ctx.tool.hook("execute.before", async (event) => {
  // event: { tool: string; sessionID; agent; messageID; id; input: unknown }
  // mutate event.input, or throw to block
});
await ctx.tool.hook("execute.after", (event) => {
  // { ..., input, status: "completed"|"error", result?/error? } — can rewrite result
});
```

- big-little's `execute.before` throws `Error("File is N lines... delegate to bulk-reader...")` on full-file `read` (`path`, no offset/limit) and on `shell` matching `cat|head|tail|less|more <file>` over threshold; piped commands pass; failures fail open except deliberate `File is ` blocks.
- Tool registration (`ctx.tool.transform` add/update/remove, namespaced `ns_name`) is for *defining tools*, not routing — model snapshot per request is stable; later transforms affect future snapshots only.

## 5. Model selection via `Model.Ref`

Schema (`@opencode/schema/dist/model.d.ts`): `Model.Ref = { providerID: Provider.ID (brand), modelID: Model.ID (brand), variant?: string }`, plus `Model.Ref.parse("provider/model")` string form.

- big-little: `parseModelRef(ref)` from `Model.Ref.parse`, from `bulkReaderModel`/`codeWriterModel` options or `BIGLITTLE_*_MODEL` env; sets `agent.model` in the agent transform. Example values: `opencode/nemotron-3.5-lightning-free` (reads), `opencode/mimo-v2.5-free` (writes).
- Other selection points: `ctx.model.transform` → `editor.default.set(providerID, modelID)` (global default); `ctx.provider.transform` → add/update/remove providers & source models; `ctx.session.switchModel({sessionID, model: Model.Ref})` (subsequent requests of that session); `ctx.generate.text({model, prompt})` (one-shot, explicit model); `ctx.session.generate({sessionID, prompt})` (transient, session's model).
- Agent `permissions: V2Permission[] = { action, resource, effect: allow|deny|ask }[]` — big-little deny-by-default with narrow allows; bulk-reader read-only (+ `ls`/`git log|status|diff`/`grep|rg|wc` shell allows), code-writer read+edit, no shell/network/subagent either.

## 6. Config options

- Object form `{ "package": "big-little", "options": { minLines, bulkReaderModel, codeWriterModel } }` → `ctx.options` in setup. All optional; env fallback (`BIGLITTLE_MIN_LINES`, deprecated `SHUNT_MIN_LINES`, `BIGLITTLE_BULK_READER_MODEL`, `BIGLITTLE_CODE_WRITER_MODEL`); `minLines` default 350, positive-int rule.

## 7. Where Fusion-style routing hooks in

Fusion = route each unit of work to the cheapest capable model. v2 touchpoints, cheapest-first:

1. **Static pins (current big-little pattern):** `ctx.agent.transform` → `agent.model = Model.Ref` per worker. Zero runtime cost; routing = "which agent you invoke".
2. **Guard/redirect at tool boundary:** `ctx.tool.hook("execute.before")` — inspect `tool/input/sessionID/agent`, mutate input or throw with a "delegate to X subagent" message. big-little's mechanism. Cannot itself switch models; it steers via denial text.
3. **Per-request shaping:** `ctx.session.hook("context")` — mutate `system/messages/tools/options` (temperature, maxTokens, provider options like `reasoningEffort`) per agent-loop call; `options` starts empty per call, overrides beat model defaults. Scopable with `{ providerID }`. Separate hooks for `compaction` (can set `result` to skip the call), `generate`, `title` (can set `result` string).
4. **Session-level model switch:** `ctx.session.switchModel/switchAgent` — affects *subsequent* requests; callable from commands, tool executors, permission hooks, event subscribers.
5. **Auxiliary offload:** `ctx.generate.text({model, prompt})` — cheap-model classification/summarization with no session side effects (used in docs' permission-review example).
6. **Admission steering:** `ctx.session.hook("prompt")` — rewrite text, attach files/skills, set metadata/delivery before inbox admission. Runs once per admission, not per model call.
7. **Command wrappers:** `ctx.command.transform` add commands whose executor rewrites the prompt and calls `ctx.session.prompt` — named routing entry points.
8. **Policy layer:** `ctx.model.transform` (filter catalog, set default), `ctx.permission.hook("evaluate")` (allow/ask/deny + message; explicit configured `deny` is final, hook skipped), `ctx.permission.rules` (session-scoped rules, last match wins, inherited by children).
9. **Observability/adaptive:** `ctx.tool.hook("execute.after")`, `ctx.session.hook("http.request/response", {kind})`, `retry` hook, `ctx.event.subscribe`, `ctx.storage` for routing counters/state.

## 8. Limits of the v2 plugin API for model routing

- **No per-request model swap in session hooks.** `SessionContext/SessionRequest.model: Model.Ref` is `readonly` — a `context` hook can reshape system/messages/tools/options but cannot retarget the model for that dispatch. `switchModel` only affects subsequent requests.
- **Prompt hook runs pre-model-resolution.** Provider scoping unavailable at admission; model is resolved after. Cannot route by model there.
- **Tool `execute.before` cannot change models or redirect execution** — only mutate `input` or throw. Routing is advisory (denial message the agent must obey), not enforced dispatch. A model that ignores the block text defeats it.
- **Agent model pins are static** unless something calls `switchModel` or re-runs the agent transform + `reload()`. No conditional-per-prompt model on the agent object.
- **`options` in session hooks starts empty per call** (no visibility into resolved model defaults) and raw HTTP body overlays apply after protocol lowering — provider-option tuning is blind and protocol-dependent (`topK` exists on Gemini, not OpenAI Responses).
- **Retry hook can veto/retry but not reroute** (no model field in decision; built-in max attempts is a hard limit). Context-overflow recovery bypasses retry (compaction path instead).
- **Permission hook never fires on explicit configured `deny`** and only sees allow/ask — cannot use it as a universal gate.
- **Transforms are synchronous, replayable, order-dependent** — async model catalog fetches must happen before the callback; capture external state, then `reload()`. Later registrations override earlier ones for the same tool/agent name.
- **`ctx.generate.text` is sessionless** — good for cheap classification, but result must be manually threaded back (no automatic routing).
- **Compaction/title/generate are separate hooks** — a "route everything" plugin must register each kind; `kind: primary|compaction|title|generate` on http/retry hooks is the discriminator, not agent id.
