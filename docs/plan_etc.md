# big-little: OpenCode V2-only port — implementation plan

> For the implementing agent: V2-only cutover (no V1 backwards compat). Follow tasks in order. Pure helpers stay untouched; only the plugin wiring, agent shapes, tests, README, and fixture script change. Validate each task before moving on.

**Goal:** Port `big-little` from OpenCode V1 plugin API (`@opencode-ai/plugin`) to native OpenCode V2 plugin API (`@opencode/plugin`), V2-only, dropping V1 support.

**Locked decisions (from user):**
- Approach: V2-only cutover (no dual `server()` export).
- Agent fields: drop `temperature: 0.2` entirely (do NOT map to `request.body`).
- Test env: OpenCode V2 installed (confirmed `v2.0.16`).
- Scope: full repo (`src/`, `package.json`, `test/`, `README.md`, `scripts/verify-fixture.sh`, benchmark/docs notes).

**Tech stack:** TypeScript (ES2022, NodeNext), `@opencode/plugin@^2.0.16` (must match OpenCode `2.0.16`), `node:test` + `tsc` (existing `npm test` pipeline unchanged).

**Sources of truth (do not guess; re-fetch if unsure):**
- Migration: `https://opencode.ai/v2/docs/migrate-v1`
- Plugin migration: `https://opencode.ai/v2/docs/build/plugins/migrate-v1`
- Plugin API: `https://opencode.ai/v2/docs/build/plugins` (Agent context, Tool hooks, Publish sections)
- Agents: `https://opencode.ai/v2/docs/agents`
- Permissions: `https://opencode.ai/v2/docs/permissions`
- Tools: `https://opencode.ai/v2/docs/tools`
- Plugin config: `https://opencode.ai/v2/docs/plugins`

---

## 1. Current V1 inventory (what exists)

- `src/index.ts:1` — `import type { Plugin, PluginModule } from "@opencode-ai/plugin"`.
- Pure logic (KEEP AS-IS, no behavior change): `resolveThreshold` (`src/index.ts:26`), `countLines` (`:36`), `extractBashTargets` (`:47`), `buildReadBlockMessage` (`:182`), `buildBashBlockMessage` (`:190`), `checkReadRequest` (`:198`), `checkBashRequest` (`:209`), `resolveModels` (`:107`), option/env precedence (`minLines` option > `BIGLITTLE_MIN_LINES` > deprecated `SHUNT_MIN_LINES` > `350`; models option > env > unset).
- V1 wiring (DELETE/REPLACE): `buildAgentConfig` (`:121`), `applyAgentConfig` (`:174`), `handleToolBefore` (`:220`), `BigLittlePlugin` (`:242`, returns `{ config, "tool.execute.before" }`), default export `{ id: "big-little", server: BigLittlePlugin }` (`:266`).
- V1 agent shape: `{ description, mode: "subagent", temperature: 0.2, model?, permission: { "*": "deny", read/grep/glob/list/webfetch/websearch, edit/task, bash: {...} }, prompt }`. bulk-reader bash map (`:139-148`): `"*": deny` + `"ls*"`, `"git log*"`, `"git status*"`, `"git diff*"`, `"grep*"`, `"rg*"`, `"wc*"` allow. code-writer (`:157-168`): `bash: "deny"`, no network, `task: "deny"`.
- V1 hook semantics: `config` merges into `cfg.agent`; `"tool.execute.before"` receives `(input.tool, output.args)`, throws `Error("File is ...")` to block; wrapper fail-open rethrows only `File is ...` messages (`:252-261`).
- `package.json:19-23` — `devDependencies: { "@opencode-ai/plugin": "^1.18.27" }`; `exports` includes `"./server"` (V1-ism).
- `test/plugin.test.ts` — 29 tests: pure helpers (`resolveThreshold`, `countLines`, `extractBashTargets`, routing) KEEP; `agent permissions` (`:110-175`) + `BigLittlePlugin wiring` (`:238-292`) REPLACE.
- `scripts/verify-fixture.sh` — V1 fixture: `opencode.json` with `{ "plugin": [[ROOT, {minLines: 10}]] }`, asserts via `opencode debug config` (`cfg.agent`) and `opencode debug agent bulk-reader` (`agent.permission` with `permission/pattern/action`). Entirely V1-shaped; rewrite.
- `README.md` — all config snippets use `"plugin"` tuple form; badge `OpenCode-1.18+`; verify section uses `debug config` / `debug agent`. Rewrite all.

## 2. Target V2 design

### 2.1 Entrypoint (`src/index.ts`)

```ts
import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "big-little",
  async setup(ctx) {
    const opts = (ctx.options ?? {}) as BigLittleOptions;
    const minLines = resolveThreshold(opts);
    await ctx.agent.transform((editor) => {
      editor.update("bulk-reader", (agent) => {
        Object.assign(agent, buildBulkReaderInfo(opts));
      });
      editor.update("code-writer", (agent) => {
        Object.assign(agent, buildCodeWriterInfo(opts));
      });
    });
    await ctx.tool.hook("execute.before", (event) => {
      // event: { tool: string (mutable), sessionID, agent, messageID, id, input: unknown }
      const tool = String((event as any).tool ?? "").toLowerCase();
      const input = (event as any).input as Record<string, any> ?? {};
      if (tool === "read") {
        const msg = checkReadRequest(
          { filePath: input.filePath, offset: input.offset, limit: input.limit },
          minLines
        );
        if (msg) throw new Error(msg);
        return;
      }
      if (tool === "shell") {
        const msg = checkBashRequest(input.command, minLines);
        if (msg) throw new Error(msg);
        return;
      }
    });
  },
});
```

Notes:
- `ctx.options` replaces the V1 second-argument `options`. Same `BigLittleOptions` type and env fallback stay.
- Keep a shared internal `handleV2ToolBefore(tool, input, minLines)` mirroring old `handleToolBefore` but over `(event.tool, event.input)` so unit tests can call it without a fake ctx. Preserve the fail-open wrapper semantics from `:252-261` only if it still makes sense; at minimum only `File is ...` errors escape.
- Delete `BigLittlePlugin`, `applyAgentConfig`, V1 `buildAgentConfig`, `handleToolBefore` V1 signature, `PluginModule` import/export.

### 2.2 Agent registration — `editor.update` upsert

- `AgentEditor` (verified in `@opencode/plugin@2.0.16` `dist/promise/agent.d.ts`) has ONLY `list/get/default/update/remove` — no `add`. Creation is done via `editor.update(id, mutator)` on a missing id (core `agent.test.ts` shows `update` materializing a new agent with `Agent.Info.default(id)`; schema `agent.d.ts` confirms `Info.default(id)` exists). Transforms must be synchronous, cheap, replayable; load option/model data BEFORE the callback and capture it.
- New builders (replace `buildAgentConfig`):
  - `buildBulkReaderInfo(opts)` → `{ description: BULK_READER_DESCRIPTION, mode: "subagent", system: BULK_READER_PROMPT_V2, ...(model?{model}), permissions: [...] }`
  - `buildCodeWriterInfo(opts)` → same pattern with code-writer prompt/permissions.
- Field mapping: `prompt` → `system`; `permission` → `permissions[]`; `temperature` → DROPPED (no `request.body`); `model` string `provider/model#variant` passes through unchanged (schema `model.parse(input: string)`); `mode: "subagent"` unchanged; `description` unchanged.
- Prompt text change: `BULK_READER_PROMPT` line "Bash: Use exclusively for read-only commands" → say "Shell" (V2 tool is `shell`, not `bash`), e.g. `- Shell: Use exclusively for read-only commands (e.g. 'ls', directory listing, 'git log').`

### 2.3 Permission arrays (order matters: last match wins)

bulk-reader `permissions`:
```json
[
  { "action": "*", "resource": "*", "effect": "deny" },
  { "action": "read", "resource": "*", "effect": "allow" },
  { "action": "glob", "resource": "*", "effect": "allow" },
  { "action": "grep", "resource": "*", "effect": "allow" },
  { "action": "webfetch", "resource": "*", "effect": "allow" },
  { "action": "websearch", "resource": "*", "effect": "allow" },
  { "action": "edit", "resource": "*", "effect": "deny" },
  { "action": "subagent", "resource": "*", "effect": "deny" },
  { "action": "shell", "resource": "*", "effect": "deny" },
  { "action": "shell", "resource": "ls *", "effect": "allow" },
  { "action": "shell", "resource": "git log *", "effect": "allow" },
  { "action": "shell", "resource": "git status *", "effect": "allow" },
  { "action": "shell", "resource": "git diff *", "effect": "allow" },
  { "action": "shell", "resource": "grep *", "effect": "allow" },
  { "action": "shell", "resource": "rg *", "effect": "allow" },
  { "action": "shell", "resource": "wc *", "effect": "allow" }
]
```
code-writer `permissions`:
```json
[
  { "action": "*", "resource": "*", "effect": "deny" },
  { "action": "read", "resource": "*", "effect": "allow" },
  { "action": "edit", "resource": "*", "effect": "allow" },
  { "action": "glob", "resource": "*", "effect": "allow" },
  { "action": "grep", "resource": "*", "effect": "allow" },
  { "action": "shell", "resource": "*", "effect": "deny" },
  { "action": "webfetch", "resource": "*", "effect": "deny" },
  { "action": "websearch", "resource": "*", "effect": "deny" },
  { "action": "subagent", "resource": "*", "effect": "deny" }
]
```
Mapping rationale: `bash`→`shell`, `task`→`subagent`, `write`/`patch` covered by `edit`, `list` tool REMOVED in V2 (absent from tools doc, permissions actions table, and live `explore` agent perms) so `list: allow` is dropped from both agents. Shell allows converted from V1 `"ls*"` form to V2 `"prefix *"` form (docs: trailing `" *"` also matches the bare command, and is tighter than `"ls*"` which would match `lsfoo`).

### 2.4 Config file shape (README + fixture)

V1 → V2:
```jsonc
// V1: { "plugin": ["big-little"] } / { "plugin": [["big-little", { "minLines": 500 }]] }
// V2:
{ "$schema": "https://opencode.ai/config.json", "plugins": ["big-little"] }
{ "$schema": "https://opencode.ai/config.json", "plugins": [{ "package": "big-little", "options": { "minLines": 500 } }] }
```
Local-path fixture form: `{ "plugins": [{ "package": "<ROOT>", "options": { "minLines": 10 } }] }`.

### 2.5 `package.json`

- Remove `@opencode-ai/plugin` devDep. Add `dependencies: { "@opencode/plugin": "^2.0.16" }` (publish guide manifest puts the plugin API in `dependencies`, not `devDependencies`; pin to match OpenCode `2.0.16`).
- Remove `"./server"` export (V1-ism). Keep `main: dist/index.js`, `types`, `.` export.
- Keep `type: module`, build/test scripts unchanged.

## 3. Gotchas (validated; do not regress)

1. **No `editor.add` for agents.** Only `update` creates. If `update("bulk-reader", ...)` does not materialize the agent in the fixture, STOP — this is the top risk. Fallback (not in scope unless probe fails): file-based agents/skills. Probe this before all other fixture work.
2. **Debug CLI changed.** V2 `opencode debug --help` subcommands are `agents`, `config` (sources), `paths`. There is NO `debug config` resolved-dump nor `debug agent <id>`. Rewrite `verify-fixture.sh` around `opencode debug agents` JSON (fields: `id`, `mode`, `permissions[{action,resource,effect}]`, `system`, `description`, `model?`). Confirm agent `id` values `bulk-reader`/`code-writer`, `mode === "subagent"`, no `temperature`/`prompt`/`permission` keys.
3. **Shell hook name.** V1 `bash` → V2 `shell`. Guard must branch on `"shell"`, not `"bash"`. Keep matching case-insensitive. Optionally also match `"bash"` defensively (one line), but `"shell"` is the contract.
4. **`event.input` keys unverified for shell.** `read` → `{ filePath, offset, limit }` is doc-proven (migration guard example). `shell` → assumed `{ command }` (V1 `args.command`). First fixture run must log `Object.keys(event.input)` for a `read` and a `shell` call and lock the shape before finalizing the hook.
5. **Transforms are replayable/sync.** No I/O, no `countLines`, no randomness inside the transform callback. Resolve threshold/models BEFORE registering. Keep the callback a pure `Object.assign`.
6. **Permission order + base policy.** Last match wins. Agent perms append after global/base (`*/allow` base). Follow the live `explore` pattern: start agent perms with `*/deny`, then specific allows. `deny` is final for permission hooks, so explicit denies hold.
7. **`grep` resource is the pattern, not the path.** `resource: "*"` allow is correct (matches `explore`).
8. **Shell scanner + `external_directory`.** Shell resources are scanner-produced command strings; directory inference is best-effort. Keep the allowlist narrow (the 7 commands above). Piped commands (`cat big | head`) must still pass — preserved by `extractBashTargets` returning `[]` on `|`.
9. **No `list`, no `temperature`, no `prompt`.** Any of these in V2 agent output is a bug. Tests must assert absence (`!("temperature" in info)`, `!("prompt" in info)`, no `list` action in permissions).
10. **Model absent-when-unset.** Only include `model` key when option/env set (V1 test `:133,161` enforced this; keep the same assertion for V2 builders).
11. **Test the installed package, not just the linked copy** (publish guide verify step). After local fixture green, `npm pack` + install tarball in a scratch dir and re-run the fixture against the packed plugin.
12. **TUI smoke still required.** Subagent `@mention` flow is unchanged in docs, but confirm `@bulk-reader` / `@code-writer` autocomplete in a V2 session.

## 4. Tasks

### Task 1 — `package.json` + dependency swap
Files: `package.json:19-23`, `package.json:8-11`.
- Remove `@opencode-ai/plugin` devDep; add `dependencies: { "@opencode/plugin": "^2.0.16" }`.
- Remove `"./server"` export.
- Run: `npm install --no-audit --no-fund && npm run build` (expect TS errors in `src/index.ts` — that's Task 2's input).
- Acceptance: `npm ls @opencode/plugin` shows `2.0.16`; no `@opencode-ai/plugin` remains.

### Task 2 — Rewrite `src/index.ts` wiring (keep pure helpers)
Files: `src/index.ts` (modify `:1`, `:64-105` prompt touch-up, replace `:121-180`, `:220-266`; keep `:4-119`, `:182-218` as-is).
- Change import to `import { Plugin } from "@opencode/plugin"`.
- Update `BULK_READER_PROMPT` Bash→shell wording (one line).
- Add `buildBulkReaderInfo(opts)`, `buildCodeWriterInfo(opts)` returning V2 shapes from §2.3 (no temperature, `system`, `permissions[]`, conditional `model`).
- Add internal `handleV2ToolBefore(tool, input, minLines)` used by the hook (same block/skip semantics as old `handleToolBefore`, but `read`→`input.{filePath,offset,limit}`, `shell`→`input.command`).
- Replace `BigLittlePlugin`/`applyAgentConfig`/`buildAgentConfig`/V1 `handleToolBefore`/default export with the `Plugin.define` setup from §2.1.
- Keep fail-open behavior: only `Error("File is ...")` escapes the hook.
- Run: `npm run build` green.
- Acceptance: `dist/index.js` default-exports `{ id: "big-little", setup }`; no `server`, `config`, `permission`, `prompt`, `temperature`, `bash:`, `task:` strings in `src/index.ts` (grep to confirm).

### Task 3 — Rewrite `test/plugin.test.ts` V1 blocks
Files: `test/plugin.test.ts:6-18` (imports), `:110-175`, `:238-292` (replace); keep `:20-108`, `:177-236` untouched.
- Update imports: drop `buildAgentConfig, applyAgentConfig, handleToolBefore, BigLittlePlugin, BigLittleModuleDefault`; import `buildBulkReaderInfo, buildCodeWriterInfo, handleV2ToolBefore` (names per Task 2) + default export.
- New `describe("v2 agent info")`: bulk-reader has `mode subagent`, `system` (contains read-only guidance), `description` mentions minLines/350, permissions exactly §2.3 (assert each allow/deny, assert NO `temperature`/`prompt`/`list`/`bash`/`task` keys); code-writer mirrors; model-absent-when-unset + model-set-via-option/env cases (same cases as `:154-166`).
- New `describe("v2 tool hook")`: fake `{ tool, input }` events — big full read throws, targeted read passes, big `cat` via `tool: "shell"` throws, piped/small/non-string pass, unknown tool passes. Include a `shell`-vs-`bash` case documenting that `shell` is the contract.
- New wiring test: default export has `id === "big-little"` and `typeof setup === "function"`; run `setup` against a stub ctx capturing `agent.transform` callback + `tool.hook` callback, execute the captured transform against a stub editor recording `update` calls, assert both agent ids registered with expected info; execute captured hook with big-read event, expect throw.
- Run: `npm test` (all green, including kept pure-helper tests).
- Acceptance: full suite passes; `grep -n "bash\|task\|temperature\|BigLittlePlugin\|applyAgentConfig" test/plugin.test.ts` returns only historical/shell-contract comments, no V1 API usage.

### Task 4 — Rewrite `scripts/verify-fixture.sh` for V2
Files: `scripts/verify-fixture.sh` (rewrite checks `:18-20`, `:30-61`; keep sandbox trap/build/fixture files, update `:63-73` key from `plugin` to `plugins`).
- Fixture config: `{ "plugins": [{ "package": "$ROOT", "options": { "minLines": 10 } }] }`.
- Check 1 (upsert probe, DO FIRST): `opencode debug agents` JSON contains `bulk-reader` + `code-writer`, both `mode === "subagent"`, bulk-reader `system` non-empty, permissions contain `shell/shell * → deny`, `shell/ls * → allow`, `read/* → allow`, `edit/* → deny`, `subagent/* → deny`; code-writer `edit/* → allow`, `shell/* → deny`, `webfetch/websearch → deny`; assert absence of `temperature`/`prompt`/`permission` (singular) keys.
- Check 2 (input-shape lock): temporary probe plugin/log or `-x` echo capturing `event.input` keys for one `read` and one `shell` invocation; record observed keys in this plan file's margin (or script comment) and align Task 2 mapping. Remove the probe after locking.
- Check 3 (sandbox): same isolation logic but key off `plugins` (not `plugin`); keep openchamber/MCP leak checks adapted to V2 output shape.
- Run: `scripts/verify-fixture.sh` and `SANDBOX=1 scripts/verify-fixture.sh`, both green.
- Acceptance: `fixture proof passed` in both modes on OpenCode `2.0.16`.

### Task 5 — README + docs for V2
Files: `README.md` (badges `:3-6`, requires `:20`, install `:22-35`, config `:37-58`, examples `:60-133`, flows `:135-175`, limits `:177-182`).
- Badge `OpenCode-1.18+` → `OpenCode-2.x` (target `2.0.16`); requires line → "Requires OpenCode 2.x (tested on 2.0.16). V1 no longer supported."
- All snippets: `"plugin"` tuple form → `"plugins"` string/object form (§2.4); all 6 examples converted; env-var table unchanged (precedence unchanged).
- Verify section: `opencode debug agents` (check ids under list) instead of `debug config`/`debug agent`; note `debug config` now shows sources only.
- Flows: `tool.execute.before hook` → `ctx.tool.hook("execute.before")`; `cat|head|...` guard now on the `shell` tool; code-writer "has no bash" → "has no shell".
- Run: no build needed; proofread diff for zero remaining `"plugin":` (singular key), `1.18`, `debug agent bulk-reader`, or `temperature`.
- Acceptance: a fresh reader can install with copy-pasted V2 snippets; all JSON snippets valid JSONC against the V2 shape.

### Task 6 — Release hygiene + regression sweep
Files: `benchmark/` (note only), `TODO.md` (note only), tarball check.
- `npm run build && npm test` green.
- Both fixture modes green (Task 4).
- TUI smoke in a scratch dir (never the repo): `@bulk-reader` + `@code-writer` autocomplete; one delegated summary; one `code-writer` write via `edit`.
- `npm pack --dry-run` shows only `dist/` + `README.md`; then install the packed tarball in a scratch dir and re-run the Task 4 Check 1 against the installed (not linked) package.
- Record in release notes: OpenCode `2.0.16`, `@opencode/plugin 2.0.16`, fixture results.
- Acceptance: all four gates green (unit, fixture, TUI smoke, packed-install).

## 5. Explicit non-goals

- No dual V1+V2 export. No `server()` function. No `@opencode-ai/plugin` remnant.
- No temperature preservation (dropped per user decision, consistent with V2 docs warning that agent `request` overlays are preserved but not yet sent).
- No new features, no threshold-logic changes, no benchmark re-runs beyond notes.

## 6. Validation log (for traceability)

- `opencode --version` → `v2.0.16`; npm registry `latest` for `@opencode/plugin` → `2.0.16` (registry metadata `dist.tarball .../plugin-2.0.16.tgz`).
- `AgentEditor` (installed `dist/promise/agent.d.ts`): `list/get/default/update/remove` only — no `add`. `Agent.Info` (installed `@opencode/schema` `agent.d.ts`): `id/name/model?/request/system?/description?/mode/hidden/color?/steps?/permissions[]` — no `temperature`/`prompt`. `Info.default(id)` exists (upsert support).
- `ToolDomain` (`dist/promise/tool.d.ts`): `execute.before: { tool: string; sessionID; agent; messageID; id; input: unknown }` — confirms `event.tool` + `event.input` mapping; throw-to-block per migration guard example.
- Live `opencode debug agents`: `explore` (subagent) perms show the V2 pattern (`*/allow` base → `*/deny` → specific allows; `read/glob/grep/webfetch/websearch` allow; `subagent` deny; no `list`, no `bash`, no `task`) — the model for our two agents' permission arrays.
- Remaining runtime probes (Task 4 does these): agent-upsert materialization, `shell` input key (`command`), shell pattern form (`"prefix *"`), TUI `@mention`.
