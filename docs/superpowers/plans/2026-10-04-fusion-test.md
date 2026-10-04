# Fusion Test Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add failing-first tests that prove the Fusion thin-layer works before its implementation lands.

**Architecture:** Extend the existing `node:test` plus `tsc` suite in `test/plugin.test.ts` with pure helper tests first, then stub-ctx wiring tests, then the existing fixture script plus TUI smoke as the live gate.

**Tech Stack:** TypeScript ES2022 NodeNext, `@opencode/plugin@^2.0.16`, `node:test` plus `tsc`, `scripts/verify-fixture.sh`.

**Spec:** `docs/superpowers/specs/2026-10-04-fusion-design.md`

## Global Constraints

- OpenCode v2 plugin API only, entrypoint stays `Plugin.define({ id: "big-little", setup(ctx) })`.
- Transforms stay synchronous, cheap, replayable; option and model data resolves before callbacks.
- `session context` model is readonly; no per-dispatch model swap in v1.
- `tool execute.before` can only mutate input or throw; routing is advisory brief text.
- `switchModel` affects later turns only.
- Keep `bulk-reader` and `code-writer` ids, descriptions, permissions, behavior unchanged.
- No `fastMode`. No stats in v1. No new dependencies.
- Test command is `npm test` (`tsc -p tsconfig.test.json && node --test test/plugin.test.ts`).

## Review Focus

- Relative path without session dir fails open instead of blocking a large file.
- Piped shell (`cat big | head`) passes while bare `cat big` over threshold blocks.
- Bad `provider/model` ref in options or `/fusion` args leaves the current model unchanged.
- `switchModel` failure leaves pairing unchanged and surfaces error text.
- Effort key on a provider that ignores `reasoningEffort` changes nothing else in options.

---

### Task 1: Fusion option and brief helpers

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: existing `resolveThreshold`, `countLines`, `resolveInDir`, `Model.Ref.parse`.
- Produces: `resolveFusionOptions(opts) -> { leadModel?: string; sidekickModel?: string; effort?: string }`, `buildSidekickInfo(opts) -> V2AgentInfo`, `buildFusionBriefMessage(lines, minLines, scope) -> string`, `parseFusionArgs(text) -> { leadModel?; sidekickModel?; effort? }`, `resolveEffortOption(opts) -> string | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
it("resolves fusion options with env fallback and rejects bad refs", () => {
  const opts = resolveFusionOptions({ leadModel: "anthropic/claude-sonnet-4-5", sidekickModel: "opencode/nemotron-3.5-lightning-free", effort: "high" });
  assert.equal(opts.leadModel, "anthropic/claude-sonnet-4-5");
  assert.equal(opts.sidekickModel, "opencode/nemotron-3.5-lightning-free");
  assert.equal(opts.effort, "high");
  assert.throws(() => resolveFusionOptions({ leadModel: "not-a-ref" }));
});

it("brief names the generic sidekick with goal plus limits plus success check", () => {
  const msg = buildFusionBriefMessage(401, 350, "src/big.ts");
  assert.ok(msg.includes("sidekick"));
  assert.ok(msg.includes("401"));
  assert.ok(msg.includes("src/big.ts"));
  assert.ok(!msg.includes("xxxxx"));
});

it("two tiers tune brief detail plus pushback", () => {
  const weak = buildFusionBriefMessage(401, 350, "src/big.ts", { tier: "weak" });
  const strong = buildFusionBriefMessage(401, 350, "src/big.ts", { tier: "strong" });
  assert.ok(weak.length > strong.length);
  assert.ok(weak.includes("Do not challenge"));
  assert.ok(strong.includes("challenge"));
});

it("sidekick is subagent with read plus edit and no shell or network", () => {
  const info: any = buildSidekickInfo({ sidekickModel: "anthropic/claude-haiku-4-20250514" });
  assert.equal(info.mode, "subagent");
  assert.equal(info.permissions.find((p: any) => p.action === "shell" && p.resource === "*")?.effect, "deny");
  assert.equal(info.permissions.find((p: any) => p.action === "edit" && p.resource === "*")?.effect, "allow");
  assert.deepEqual(info.model, { providerID: "anthropic", id: "claude-haiku-4-20250514" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with helper functions not defined.

- [ ] **Step 3: Implement `resolveFusionOptions`, `buildSidekickInfo`, `buildFusionBriefMessage`, `parseFusionArgs`, `resolveEffortOption` in `src/index.ts`**

Use existing option-plus-env precedence, `Model.Ref.parse` validation, deny-first sidekick permissions, brief text with file scope plus threshold count plus success check.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, existing 34 tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "test: fusion option and brief helpers"
```

### Task 2: Sidekick wiring plus brief guard

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildSidekickInfo`, `buildFusionBriefMessage`.
- Produces: setup registers `sidekick` via `agent.transform`, `execute.before` throws brief naming `sidekick` for over-threshold full reads and big `cat`.

- [ ] **Step 1: Write the failing test**

```ts
it("setup registers sidekick and leaves old agents untouched", async () => {
  await mod.setup(stubCtx);
  assert.deepEqual(registeredIds.sort(), ["bulk-reader", "code-writer", "sidekick"]);
  assert.equal(sidekickInfo.mode, "subagent");
});

it("big full read throws brief naming sidekick, narrow read passes", async () => {
  await assert.rejects(hookCb({ tool: "read", input: { path: bigFile } }), /sidekick/);
  await hookCb({ tool: "read", input: { path: bigFile, limit: 5 } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with missing `sidekick` registration and old block text.

- [ ] **Step 3: Implement sidekick `editor.update` plus guard message swap in `src/index.ts`**

Resolve threshold plus fusion options before callbacks, keep pure `Object.assign` in transform, keep fail-open wrapper that only rethrows `File is ` blocks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "test: sidekick wiring plus brief guard"
```

### Task 3: Fusion command plus effort hook

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseFusionArgs`, `resolveEffortOption`.
- Produces: `/fusion` command executor plus `session context` hook that sets `reasoningEffort` only.

- [ ] **Step 1: Write the failing test**

```ts
it("fusion command shows pairing and sets models for later turns", async () => {
  await fusionCommand.execute({ sessionID: "s1", prompt: { text: "/fusion lead anthropic/claude-sonnet-4-5" }, delivery: "steer" });
  assert.equal(switchModelCalls[0].model.providerID, "anthropic");
});

it("bad fusion ref leaves model unchanged", async () => {
  await assert.rejects(fusionCommand.execute({ sessionID: "s1", prompt: { text: "/fusion lead nope" }, delivery: "steer" }));
  assert.equal(switchModelCalls.length, 0);
});

it("switchModel failure leaves pairing unchanged", async () => {
  switchModelCalls.push(new Error("down"));
  await assert.rejects(fusionCommand.execute({ sessionID: "s1", prompt: { text: "/fusion sidekick opencode/nemotron-3.5-lightning-free" }, delivery: "steer" }));
  assert.equal(currentPairing.sidekickModel, "opencode/nemotron-3.5-lightning-free");
});

it("effort hook sets reasoningEffort only", () => {
  contextHook({ options: {} });
  assert.equal(capturedOptions.reasoningEffort, "high");
  assert.equal(Object.keys(capturedOptions).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with command and hook missing.

- [ ] **Step 3: Implement `/fusion` via `ctx.command.transform` plus `ctx.session.hook("context")` in `src/index.ts`**

Validate refs with `Model.Ref.parse`, call `switchModel` for later turns, map effort to `reasoningEffort` and ignore elsewhere.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "test: fusion command plus effort hook"
```

### Task 4: Fixture plus live verification gate

**Files:**
- Modify: `scripts/verify-fixture.sh`
- Test: `scripts/verify-fixture.sh` plus manual TUI smoke in scratch dir only.

**Interfaces:**
- Consumes: Tasks 1-3 behavior.
- Produces: green fixture in normal plus sandbox modes, packed-tarball proof, TUI smoke notes.

- [ ] **Step 1: Write the failing fixture check**

Add checks: `opencode api agent.list` contains `sidekick` with `mode subagent`, full read of an 11-line file with `minLines: 10` rejects with brief naming `sidekick`, narrow read passes, big `cat` via `shell` rejects, `/fusion` show reports pairing.

- [ ] **Step 2: Run fixture to verify it fails**

Run: `scripts/verify-fixture.sh`
Expected: FAIL on missing `sidekick` before implementation lands.

- [ ] **Step 3: Update `scripts/verify-fixture.sh` checks plus config snippet for `leadModel`, `sidekickModel`, `effort`**

Keep sandbox trap plus packed-tarball install check, never run production OpenCode inside the repo.

- [ ] **Step 4: Run all gates to verify they pass**

Run: `npm run build && npm test`
Expected: PASS.

Run: `scripts/verify-fixture.sh` and `SANDBOX=1 scripts/verify-fixture.sh`
Expected: `fixture proof passed` in both.

Run: `npm pack --dry-run`, install tarball in scratch dir, re-run fixture.
Expected: PASS against installed package.

TUI smoke in scratch dir: `@sidekick` autocomplete, one delegated summary, one edit, `/fusion` show plus set.
Expected: recorded notes, no repo state touched.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-fixture.sh docs/superpowers/plans/2026-10-04-fusion-test.md
git commit -m "test: fusion fixture plus live gate"
```
