# big-little Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship npm package `big-little` that injects `bulk-reader` and `code-writer` subagents and hard-blocks large full-file reads.

**Architecture:** Single TS module exports `BigLittlePlugin` plus a default `PluginModule`. `config` hook registers both agents. `tool.execute.before` hook blocks large `read` and `cat|head|tail|less|more` with a throw. All routing uses `node:fs`. Fail open except deliberate throws.

**Tech Stack:** TypeScript, Node 22, `node:test` plus `node:assert`, `@opencode-ai/plugin` types only, no runtime deps.

**Spec:** `docs/superpowers/specs/2026-09-16-big-little-design.md`

## Global Constraints

- Package name is `big-little`.
- Consumers install via `opencode.json` with `{ "plugin": ["big-little"] }` (V1, singular field). Options use the tuple form: `{ "plugin": [["big-little", { "minLines": 500 }]] }`.
- Targets OpenCode V1, version 1.18 or later. OpenCode 2 beta (`opencode2`, `plugins` field, new plugin API) is out of scope for v1.
- Single runtime module exports `BigLittlePlugin` shaped as an OpenCode `Plugin` function, plus a default export of a `PluginModule` (`{ id, server: BigLittlePlugin }`) — this is the loader-preferred shape.
- `config` hook merges with existing `cfg.agent` entries and never removes user agents.
- Agent prompts live in TS as single source of truth. No `agent/*.md` files ship at runtime. `research/portal/` stays reference-only.
- Routing uses TypeScript with `node:fs`. No shell-out. No `jq` or `wc` dep.
- Hook failures fail open (allow) except deliberate `throw` blocks in section 5 of spec.
- Agents use `mode: "subagent"`, `temperature: 0.2`, `task: deny`.
- `model` is set only when package config or env fallback provides it. When unset the subagent inherits caller model.
- Only `read` and `bash` tools are inspected. Tool name match is case-insensitive. All other tools pass through untouched.
- Line count uses UTF-8 read plus `split("\n").length`. Unreadable or missing file means allow.
- Block messages never include file contents.
- No bypass flag in v1. Targeted reads are the bypass.
- `event` hook is not used.
- No `plugin.json`. No `hooks/*.sh` ship.
- No slash commands. No skills. No auto-delegation beyond block message.
- No `task` or `skill` interception in v1. No silent arg rewrites in v1 (also: `tool.execute.before` arg mutation does not propagate — opencode issue 39674 — but this plan never rewrites args, it only throws).
- No hardcoded model defaults. No telemetry. No cost reporting.
- `PORTAL_MIN_LINES` and `PORTAL_*_MODEL` are not honored.
- Default threshold is 350.

## Verified Facts (validation 2026-09-16)

These were checked against ground truth. Do not re-derive them. If the fixture gate (Task 7) contradicts them, update this section.

- Installed OpenCode is 1.18.31 (V1). Installed `@opencode-ai/plugin` is 1.18.27.
- `Plugin` type (from `@opencode-ai/plugin/dist/index.d.ts`): `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`. `PluginOptions = Record<string, unknown>`. `PluginInput` has NO `options` field — options arrive only as the second function argument.
- Options reach the plugin from `opencode.json` as the tuple form. Config schema (`https://opencode.ai/config.json`, `$defs.Config`): `plugin: Array<string | [string, PluginOptions]>`. Field name is `plugin`, singular.
- Loader (`packages/opencode/src/plugin/index.ts`, `applyPlugin`): first tries `readV1Plugin(mod, spec, "server", "detect")` — a default export that is an object with `server` (or `id`/`tui`). If found, only `plugin.server(input, options)` runs. Otherwise the legacy path iterates every named export and throws `TypeError("Plugin export is not a function")` on any non-function export. Therefore the module MUST default-export a `PluginModule` and named exports are only safe because the detect path ignores them on 1.18+.
- Package entrypoint resolution (`packages/opencode/src/plugin/shared.ts`, `resolvePackageEntrypoint`): for npm plugins it first checks `package.json` `exports["./server"]`, then falls back to `main`. If `exports` is present but has no `./server` subpath, the plugin fails with "does not expose a server entrypoint". So `exports` MUST include `./server` (and `main` stays as fallback).
- Hook signatures (installed types): `config?: (input: Config) => Promise<void>` — mutate `input` directly. `"tool.execute.before"?: (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => Promise<void>` — throw to block.
- Agent config schema (`$defs.AgentConfig`): fields `model` (string, `provider/model`), `temperature`, `prompt`, `description`, `mode` (`subagent`|`primary`|`all`), `permission`, `hidden`, `steps`, `color`. All fields the agents use are valid.
- Permission schema: `PermissionConfig` object keys are `read, edit, glob, grep, list, bash, task, external_directory, todowrite, question, webfetch, websearch, lsp, doom_loop, skill`. Each value is either an action (`allow`/`deny`/`ask`) or a `PermissionObjectConfig`: a map of arbitrary pattern keys to actions. So `bash: { "*": "deny", "ls*": "allow" }` is schema-valid.
- Node 22.23.2 runs TypeScript directly under `node --test` (type stripping, verified empirically). Tests import `../src/index.ts` and need no build step. All `import` statements in `src` must be `import type` so they strip cleanly at test time.
- Validation commands (verified on 1.18.31, no model, no session): `opencode debug config` prints resolved config as JSON. `opencode debug agent <name>` prints the agent with permissions expanded into ordered `{permission, action, pattern}` rules. A project `opencode.json` with a local-path tuple plugin loads that plugin only when OpenCode starts inside that project dir.
- Isolation (verified on 1.18.31): `OPENCODE_DISABLE_PROJECT_CONFIG=true` skips project config discovery (global config still loads). `XDG_CONFIG_HOME` redirects the global config dir. `OPENCODE_CONFIG_CONTENT` env injects config inline (the production machine uses it for an openchamber plugin, so sandbox runs must unset it). `--pure` runs with no external plugins.

## File Map

Fewest files that work. One runtime file. One test file. No split by layer.

- Create `package.json`. Package root. Name `big-little`. Holds dev dep on `@opencode-ai/plugin` for types only. Exposes `exports` with `./server` subpath.
- Create `tsconfig.json`. Strict TS. Builds `src` only to `dist`.
- Create `tsconfig.test.json`. Type-checks `src` plus `test` with no emit. Allows `.ts` import extensions.
- Create `src/index.ts`. Only shipped code. Holds threshold parse, line count, bash target extract, both agent definitions, `config` hook, `tool.execute.before` hook, `BigLittlePlugin` export, default `PluginModule` export.
- Create `test/plugin.test.ts`. Only test file. All unit tests with `node:test`. Covers threshold matrix, line count, read matrix, bash matrix, permission snapshots.
- Create `scripts/verify-fixture.sh`. Scripted load proof. Loads the built package into a throwaway fixture project and asserts against `opencode debug config` plus `opencode debug agent`. No model calls.
- Modify `README.md`. Install steps. Configuration table. Limits. Benchmark pointer.

Engineer reads `research/portal/plugin.ts` as reference only. Do not copy env names from it. Env names changed. Do not copy its bash permission. It is too broad.

---

### Task 1: Scaffold Package and Lock Plugin Shape

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`
- Create: `src/index.ts`
- Test: verify with `npm install` plus type-check

**Interfaces:**
- Consumes: nothing.
- Produces: export names `BigLittlePlugin` and `default` (PluginModule) from `src/index.ts`. Type `Plugin` from `@opencode-ai/plugin`. Interface `BigLittleOptions`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "big-little",
  "version": "0.1.0",
  "description": "OpenCode plugin that routes large reads to cheap worker subagents",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./server": "./dist/index.js"
  },
  "files": ["dist", "README.md"],
  "license": "MIT",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.test.json && node --test test/plugin.test.ts",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.18.27",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

The `exports["./server"]` subpath is required. The OpenCode loader checks it before `main` for npm plugins.

- [ ] **Step 2: Create `tsconfig.json` and `tsconfig.test.json`**

`tsconfig.json` (build, src only):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

`tsconfig.test.json` (type-check, no emit, allows `.ts` import extensions):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

The inherited `outDir` is ignored because `noEmit` is set.

- [ ] **Step 3: Install**

Run:

```bash
npm install
```

Expected: lockfile created. No errors.

- [ ] **Step 4: Create `src/index.ts` stub so the type-check passes**

```ts
import type { Plugin, PluginModule } from "@opencode-ai/plugin";

export interface BigLittleOptions {
  minLines?: unknown;
  bulkReaderModel?: string;
  codeWriterModel?: string;
}

export const BigLittlePlugin: Plugin = async () => {
  return {};
};

export default { id: "big-little", server: BigLittlePlugin } satisfies PluginModule;
```

The default export is mandatory. The loader checks `mod.default` for a `PluginModule` first. Without it, the legacy path scans all exports and throws on non-function exports. All imports in this file must stay `import type` so Node's type stripping drops them at test time.

Run:

```bash
npx tsc -p tsconfig.test.json
```

Expected: PASS with no errors. If the `Plugin` import path is wrong, check `node_modules/@opencode-ai/plugin/dist/index.d.ts` and fix the import.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json tsconfig.test.json src/index.ts package-lock.json
git commit -m "feat: scaffold big-little npm package"
```

---

### Task 2: Threshold Parse and Line Count

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: `BigLittleOptions` from Task 1.
- Produces:
  - `export function resolveThreshold(options?: BigLittleOptions): number`
  - `export function countLines(filePath: string): number | null`
  - `export const DEFAULT_MIN_LINES = 350`

Rules for `resolveThreshold`. Order matters. Use first hit. Package option `minLines` wins when present. Else `process.env.BIGLITTLE_MIN_LINES`. Else deprecated `process.env.SHUNT_MIN_LINES`. Else 350. Parse with `parseInt(raw, 10)`. Result must be finite and `> 0`. Else 350. Never honor `PORTAL_MIN_LINES`.

Rules for `countLines`. Read file as UTF-8. Split on `"\n"`. Return length. Return `null` when read fails. Never throw.

- [ ] **Step 1: Write the failing test**

Create `test/plugin.test.ts` with this content. The static import line at the top grows as later tasks add exports. Keep exactly one import from `../src/index.ts`.

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveThreshold,
  countLines,
  DEFAULT_MIN_LINES,
} from "../src/index.ts";

describe("resolveThreshold", () => {
  it("defaults to 350 when no option and no env", () => {
    delete process.env.BIGLITTLE_MIN_LINES;
    delete process.env.SHUNT_MIN_LINES;
    assert.equal(resolveThreshold({}), 350);
    assert.equal(DEFAULT_MIN_LINES, 350);
  });

  it("uses package option when valid", () => {
    assert.equal(resolveThreshold({ minLines: 100 }), 100);
  });

  it("maps zero, negative, garbage to 350", () => {
    delete process.env.BIGLITTLE_MIN_LINES;
    delete process.env.SHUNT_MIN_LINES;
    assert.equal(resolveThreshold({ minLines: 0 }), 350);
    assert.equal(resolveThreshold({ minLines: -5 }), 350);
    assert.equal(resolveThreshold({ minLines: "garbage" }), 350);
    assert.equal(resolveThreshold({ minLines: NaN }), 350);
  });

  it("uses BIGLITTLE_MIN_LINES env when option absent", () => {
    delete process.env.SHUNT_MIN_LINES;
    process.env.BIGLITTLE_MIN_LINES = "200";
    assert.equal(resolveThreshold({}), 200);
    delete process.env.BIGLITTLE_MIN_LINES;
  });

  it("honors deprecated SHUNT_MIN_LINES as fallback", () => {
    delete process.env.BIGLITTLE_MIN_LINES;
    process.env.SHUNT_MIN_LINES = "250";
    assert.equal(resolveThreshold({}), 250);
    delete process.env.SHUNT_MIN_LINES;
  });

  it("prefers option over env", () => {
    process.env.BIGLITTLE_MIN_LINES = "200";
    assert.equal(resolveThreshold({ minLines: 120 }), 120);
    delete process.env.BIGLITTLE_MIN_LINES;
  });
});

describe("countLines", () => {
  it("counts small file lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-"));
    const p = join(dir, "small.txt");
    writeFileSync(p, "a\nb\nc");
    assert.equal(countLines(p), 3);
    rmSync(dir, { recursive: true });
  });

  it("returns null for missing file", () => {
    assert.equal(countLines("/no/such/file-xyz.txt"), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: type-check fails with `resolveThreshold is not exported` (or the test run fails with the same message).

- [ ] **Step 3: Write minimal implementation**

Replace `src/index.ts` content with:

```ts
import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";

export interface BigLittleOptions {
  minLines?: unknown;
  bulkReaderModel?: string;
  codeWriterModel?: string;
}

export const DEFAULT_MIN_LINES = 350;

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (Number.isFinite(raw) && raw > 0 && Number.isInteger(raw)) return raw;
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    return null;
  }
  if (typeof raw === "string") {
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
    return null;
  }
  return null;
}

export function resolveThreshold(options: BigLittleOptions = {}): number {
  const fromOption = parsePositiveInt(options.minLines);
  if (fromOption !== null) return fromOption;
  const fromEnv = parsePositiveInt(process.env.BIGLITTLE_MIN_LINES);
  if (fromEnv !== null) return fromEnv;
  const fromDeprecated = parsePositiveInt(process.env.SHUNT_MIN_LINES);
  if (fromDeprecated !== null) return fromDeprecated;
  return DEFAULT_MIN_LINES;
}

export function countLines(filePath: string): number | null {
  try {
    return readFileSync(filePath, "utf8").split("\n").length;
  } catch {
    return null;
  }
}

export const BigLittlePlugin: Plugin = async () => {
  return {};
};

export default { id: "big-little", server: BigLittlePlugin } satisfies PluginModule;
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test
```

Expected: PASS, 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "feat: add threshold parse and line count"
```

---

### Task 3: Bash Read-Target Extractor

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function extractBashTargets(command: string): string[]`

Rules in order. If command contains `|`, return `[]`. Piped commands count as targeted reads. Match `cat`, `head`, `tail`, `less`, `more` as whole words. Take first file operand per match. Skip flags that start with `-`. Skip tokens that start with `$` or `<`. Skip tokens with `*`. Strip one layer of surrounding single or double quotes. Scan whole string so `;`, `&&`, `||` segments all count.

- [ ] **Step 1: Write the failing test**

Append to `test/plugin.test.ts`. First extend the static import at the top to include `extractBashTargets`:

```ts
import {
  resolveThreshold,
  countLines,
  DEFAULT_MIN_LINES,
  extractBashTargets,
} from "../src/index.ts";
```

Then append:

```ts
describe("extractBashTargets", () => {
  it("extracts single cat target", () => {
    assert.deepEqual(extractBashTargets("cat bigfile.txt"), ["bigfile.txt"]);
  });

  it("returns empty for piped commands", () => {
    assert.deepEqual(extractBashTargets("cat bigfile.txt | head -20"), []);
  });

  it("skips flags and picks file", () => {
    assert.deepEqual(extractBashTargets("head -n 20 bigfile.txt"), ["bigfile.txt"]);
  });

  it("skips vars, redirects, globs", () => {
    assert.deepEqual(extractBashTargets("cat $FILE"), []);
    assert.deepEqual(extractBashTargets("cat < bigfile.txt"), []);
    assert.deepEqual(extractBashTargets("cat *.txt"), []);
  });

  it("strips quotes", () => {
    assert.deepEqual(extractBashTargets('cat "my file.txt"'), ["my file.txt"]);
  });

  it("scans compound commands as a whole", () => {
    assert.deepEqual(extractBashTargets("echo hi; cat bigfile.txt"), ["bigfile.txt"]);
    assert.deepEqual(extractBashTargets("echo hi && head small.txt"), ["small.txt"]);
  });

  it("ignores non-read commands", () => {
    assert.deepEqual(extractBashTargets("ls -la"), []);
    assert.deepEqual(extractBashTargets("grep foo bigfile.txt"), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL with `extractBashTargets is not exported`.

- [ ] **Step 3: Write minimal implementation**

Insert into `src/index.ts` before the `BigLittlePlugin` stub:

```ts
const BASH_READ_RE = /\b(cat|head|tail|less|more)\s+([^|;&\n]+)/g;

export function extractBashTargets(command: string): string[] {
  if (command.includes("|")) return [];
  const targets: string[] = [];
  for (const match of command.matchAll(BASH_READ_RE)) {
    const rest = (match[2] ?? "").trim();
    for (const token of rest.split(/\s+/)) {
      if (!token || token.startsWith("-")) continue;
      if (token.startsWith("$") || token.startsWith("<") || token.includes("*")) continue;
      targets.push(token.replace(/^['"]|['"]$/g, ""));
      break;
    }
  }
  return targets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "feat: add bash read-target extractor"
```

---

### Task 4: Agent Definitions and Config Hook

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export const BULK_READER_DESCRIPTION: string`
  - `export const BULK_READER_PROMPT: string`
  - `export const CODE_WRITER_DESCRIPTION: string`
  - `export const CODE_WRITER_PROMPT: string`
  - `export function resolveModels(options?: BigLittleOptions): { bulkReaderModel?: string; codeWriterModel?: string }`
  - `export function buildAgentConfig(options?: BigLittleOptions): Record<string, unknown>`
  - `export async function applyAgentConfig(cfg: any, options?: BigLittleOptions): Promise<void>`

Permission shapes (exact). Both agents share `"*": "deny"`, `task: "deny"`, `mode: "subagent"`, `temperature: 0.2`.

bulk-reader allows `grep`, `glob`, `list`, `read`, `webfetch`, `websearch`. Denies `edit`, `task`. Bash is a map: `"*": "deny"`, `"ls*": "allow"`, `"git log*": "allow"`, `"git status*": "allow"`, `"git diff*": "allow"`, `"grep*": "allow"`, `"rg*": "allow"`, `"wc*": "allow"`. No other bash key. Schema-verified: `PermissionObjectConfig` accepts arbitrary pattern keys mapped to actions.

code-writer allows `read`, `edit`, `glob`, `grep`, `list`. Denies `bash`, `webfetch`, `websearch`, `task`.

Model rule: set `model` key only when value exists. Else omit key so caller model inherits.

Description and prompt text (copy exact, from `research/portal/agent/*.md`):

bulk-reader description:

```text
Fast read-only codebase explorer for large files and multi-file questions. Use when you need to read files over ~350 lines, answer questions spanning multiple files, or map code patterns without loading full files into context. Specify thoroughness: quick, medium, or very thorough.
```

bulk-reader prompt:

```text
You are a codebase exploration specialist focused on fast, accurate, read-only navigation.

Core Tool Strategy:
- Glob: Locate files by pattern or extension.
- Grep: Search code text and regex patterns across targeted directories.
- Read: Inspect specific file contents once narrowed down.
- Bash: Use exclusively for read-only commands (e.g. 'ls', directory listing, 'git log').

Guidelines:
- Follow a top-down workflow: filter paths with Glob/Grep before reading full files.
- Adapt your search depth based on the thoroughness level specified by the caller: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.
- Always return file paths as absolute paths.
- Summarize key findings concisely using file paths, relevant line numbers, and short snippets. Do not output full files unless requested.
- Avoid using emojis.
- STRICT READ-ONLY MODE: Never run commands that create, modify, move, or delete files or alter system state.

Output contract (token discipline):
- Output structured bullets only. No greetings, no prose, no preambles.
- Lead every bullet with the exact name, type, or line number.
- Use nested bullets for details. Skip anything the caller did not ask for.

Do not edit code and do not reason about bugs or architecture beyond what was asked — report facts so the caller can act.
```

code-writer description:

```text
Generates production-ready boilerplate from a spec plus a required reference file. Use when you need tests, config scaffolding, type stubs, DTOs, or other predictable code that must match existing patterns. Always provide a spec, a reference file, and a target path.
```

code-writer prompt:

```text
You are a code generation specialist. Generate production-ready files based on provided specs and reference files.

Guidelines:
- Match existing patterns, conventions, typing, naming, and style exactly.
- Resolve ambiguities using established reference context.
- Output strictly raw code. Exclude markdown code blocks, explanations, or introductory text unless requested.
- Produce fully implemented code without placeholders or stubs.

Operating contract:
- A reference file is required. Without a file to match patterns against, you would generate context-free code that fits nothing in the project — always read the reference before writing.
- Write the finished file with the edit tool; the caller never needs to see the generated code in chat.
- If the spec is ambiguous, make reasonable choices that match the reference code's patterns.
- Do not refactor beyond the spec and do not reason about bugs or architecture — generate what was specified.
```

- [ ] **Step 1: Write the failing test**

First extend the static import at the top of `test/plugin.test.ts` to include `buildAgentConfig` and `applyAgentConfig`:

```ts
import {
  resolveThreshold,
  countLines,
  DEFAULT_MIN_LINES,
  extractBashTargets,
  buildAgentConfig,
  applyAgentConfig,
} from "../src/index.ts";
```

Then append:

```ts
describe("agent permissions", () => {
  it("bulk-reader is deny-all with read tools and narrow bash map", () => {
    const agents: any = buildAgentConfig({});
    const br = agents["bulk-reader"];
    assert.equal(br.mode, "subagent");
    assert.equal(br.temperature, 0.2);
    assert.equal(br.permission["*"], "deny");
    assert.equal(br.permission.read, "allow");
    assert.equal(br.permission.grep, "allow");
    assert.equal(br.permission.glob, "allow");
    assert.equal(br.permission.list, "allow");
    assert.equal(br.permission.webfetch, "allow");
    assert.equal(br.permission.websearch, "allow");
    assert.equal(br.permission.edit, "deny");
    assert.equal(br.permission.task, "deny");
    assert.equal(br.permission.bash["*"], "deny");
    assert.equal(br.permission.bash["ls*"], "allow");
    assert.equal(br.permission.bash["git log*"], "allow");
    assert.equal(br.permission.bash["git status*"], "allow");
    assert.equal(br.permission.bash["git diff*"], "allow");
    assert.equal(br.permission.bash["grep*"], "allow");
    assert.equal(br.permission.bash["rg*"], "allow");
    assert.equal(br.permission.bash["wc*"], "allow");
    assert.ok(!("model" in br), "model key must be absent when unset");
  });

  it("code-writer can edit but has no bash or network", () => {
    const agents: any = buildAgentConfig({});
    const cw = agents["code-writer"];
    assert.equal(cw.mode, "subagent");
    assert.equal(cw.temperature, 0.2);
    assert.equal(cw.permission["*"], "deny");
    assert.equal(cw.permission.read, "allow");
    assert.equal(cw.permission.edit, "allow");
    assert.equal(cw.permission.glob, "allow");
    assert.equal(cw.permission.grep, "allow");
    assert.equal(cw.permission.list, "allow");
    assert.equal(cw.permission.bash, "deny");
    assert.equal(cw.permission.webfetch, "deny");
    assert.equal(cw.permission.websearch, "deny");
    assert.equal(cw.permission.task, "deny");
  });

  it("sets model only when provided via option or env", () => {
    delete process.env.BIGLITTLE_BULK_READER_MODEL;
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
    let agents: any = buildAgentConfig({
      bulkReaderModel: "anthropic/claude-haiku-4-20250514",
    });
    assert.equal(agents["bulk-reader"].model, "anthropic/claude-haiku-4-20250514");
    assert.ok(!("model" in agents["code-writer"]));
    process.env.BIGLITTLE_CODE_WRITER_MODEL = "anthropic/claude-haiku-4-20250514";
    agents = buildAgentConfig({});
    assert.equal(agents["code-writer"].model, "anthropic/claude-haiku-4-20250514");
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
  });

  it("config hook merges and never removes user agents", async () => {
    const cfg: any = { agent: { "my-agent": { mode: "primary" } } };
    await applyAgentConfig(cfg, {});
    assert.ok(cfg.agent["my-agent"], "user agent must survive");
    assert.ok(cfg.agent["bulk-reader"], "bulk-reader must exist");
    assert.ok(cfg.agent["code-writer"], "code-writer must exist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL with `buildAgentConfig is not exported`.

- [ ] **Step 3: Write minimal implementation**

Insert into `src/index.ts` before the `BigLittlePlugin` stub:

```ts
export const BULK_READER_DESCRIPTION =
  "Fast read-only codebase explorer for large files and multi-file questions. Use when you need to read files over ~350 lines, answer questions spanning multiple files, or map code patterns without loading full files into context. Specify thoroughness: quick, medium, or very thorough.";

export const BULK_READER_PROMPT = `You are a codebase exploration specialist focused on fast, accurate, read-only navigation.

Core Tool Strategy:
- Glob: Locate files by pattern or extension.
- Grep: Search code text and regex patterns across targeted directories.
- Read: Inspect specific file contents once narrowed down.
- Bash: Use exclusively for read-only commands (e.g. 'ls', directory listing, 'git log').

Guidelines:
- Follow a top-down workflow: filter paths with Glob/Grep before reading full files.
- Adapt your search depth based on the thoroughness level specified by the caller: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.
- Always return file paths as absolute paths.
- Summarize key findings concisely using file paths, relevant line numbers, and short snippets. Do not output full files unless requested.
- Avoid using emojis.
- STRICT READ-ONLY MODE: Never run commands that create, modify, move, or delete files or alter system state.

Output contract (token discipline):
- Output structured bullets only. No greetings, no prose, no preambles.
- Lead every bullet with the exact name, type, or line number.
- Use nested bullets for details. Skip anything the caller did not ask for.

Do not edit code and do not reason about bugs or architecture beyond what was asked — report facts so the caller can act.`;

export const CODE_WRITER_DESCRIPTION =
  "Generates production-ready boilerplate from a spec plus a required reference file. Use when you need tests, config scaffolding, type stubs, DTOs, or other predictable code that must match existing patterns. Always provide a spec, a reference file, and a target path.";

export const CODE_WRITER_PROMPT = `You are a code generation specialist. Generate production-ready files based on provided specs and reference files.

Guidelines:
- Match existing patterns, conventions, typing, naming, and style exactly.
- Resolve ambiguities using established reference context.
- Output strictly raw code. Exclude markdown code blocks, explanations, or introductory text unless requested.
- Produce fully implemented code without placeholders or stubs.

Operating contract:
- A reference file is required. Without a file to match patterns against, you would generate context-free code that fits nothing in the project — always read the reference before writing.
- Write the finished file with the edit tool; the caller never needs to see the generated code in chat.
- If the spec is ambiguous, make reasonable choices that match the reference code's patterns.
- Do not refactor beyond the spec and do not reason about bugs or architecture — generate what was specified.`;

export function resolveModels(options: BigLittleOptions = {}): {
  bulkReaderModel?: string;
  codeWriterModel?: string;
} {
  const bulkReaderModel =
    options.bulkReaderModel ?? process.env.BIGLITTLE_BULK_READER_MODEL ?? undefined;
  const codeWriterModel =
    options.codeWriterModel ?? process.env.BIGLITTLE_CODE_WRITER_MODEL ?? undefined;
  const out: { bulkReaderModel?: string; codeWriterModel?: string } = {};
  if (bulkReaderModel) out.bulkReaderModel = bulkReaderModel;
  if (codeWriterModel) out.codeWriterModel = codeWriterModel;
  return out;
}

export function buildAgentConfig(options: BigLittleOptions = {}): Record<string, unknown> {
  const { bulkReaderModel, codeWriterModel } = resolveModels(options);
  return {
    "bulk-reader": {
      description: BULK_READER_DESCRIPTION,
      mode: "subagent",
      temperature: 0.2,
      ...(bulkReaderModel ? { model: bulkReaderModel } : {}),
      permission: {
        "*": "deny",
        grep: "allow",
        glob: "allow",
        list: "allow",
        read: "allow",
        webfetch: "allow",
        websearch: "allow",
        edit: "deny",
        task: "deny",
        bash: {
          "*": "deny",
          "ls*": "allow",
          "git log*": "allow",
          "git status*": "allow",
          "git diff*": "allow",
          "grep*": "allow",
          "rg*": "allow",
          "wc*": "allow",
        },
      },
      prompt: BULK_READER_PROMPT,
    },
    "code-writer": {
      description: CODE_WRITER_DESCRIPTION,
      mode: "subagent",
      temperature: 0.2,
      ...(codeWriterModel ? { model: codeWriterModel } : {}),
      permission: {
        "*": "deny",
        read: "allow",
        edit: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        bash: "deny",
        webfetch: "deny",
        websearch: "deny",
        task: "deny",
      },
      prompt: CODE_WRITER_PROMPT,
    },
  };
}

export async function applyAgentConfig(cfg: any, options: BigLittleOptions = {}): Promise<void> {
  const agents = buildAgentConfig(options);
  cfg.agent = {
    ...(cfg.agent ?? {}),
    ...agents,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "feat: add bulk-reader and code-writer agent config"
```

---

### Task 5: Routing Hook for Read and Bash

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: `countLines` (Task 2), `extractBashTargets` (Task 3).
- Produces:
  - `export function checkReadRequest(args: { filePath?: string; offset?: number | null; limit?: number | null }, minLines: number): string | null`
  - `export function checkBashRequest(command: unknown, minLines: number): string | null`
  - `export function handleToolBefore(input: { tool?: unknown }, output: { args?: Record<string, unknown> }, minLines: number): void`

`checkReadRequest` returns block message or `null` for allow. Order: if `offset != null` or `limit != null`, allow. If `filePath` missing or empty, allow. Count lines. If `null` or `<= minLines`, allow. Else return read block message.

Read block message (exact, from spec):

```text
File is {lines} lines (threshold: {minLines}). Delegate to the bulk-reader subagent instead of reading it directly. If you need exact content for editing, re-read with offset/limit for just the section you need.
```

`checkBashRequest` returns block message or `null`. If command is not a string, allow. Use `extractBashTargets`. For each target: count lines, skip `null` or small. On first large target return bash block message.

Bash block message (exact, from spec):

```text
File is {lines} lines (threshold: {minLines}). Do not cat large files into context — delegate to the bulk-reader subagent instead, or use a targeted read (grep, offset/limit) for the section you need.
```

`handleToolBefore` lowercases tool name. Routes `read` and `bash` only. Throws `Error` with message when check returns string. Never throws otherwise. Never includes file contents in message. Only counts and next actions.

- [ ] **Step 1: Write the failing test**

First extend the static import at the top of `test/plugin.test.ts` to include `checkReadRequest`, `checkBashRequest`, and `handleToolBefore`:

```ts
import {
  resolveThreshold,
  countLines,
  DEFAULT_MIN_LINES,
  extractBashTargets,
  buildAgentConfig,
  applyAgentConfig,
  checkReadRequest,
  checkBashRequest,
  handleToolBefore,
} from "../src/index.ts";
```

Then append:

```ts
describe("routing", () => {
  it("allows small read and blocks big read", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-route-"));
    const small = join(dir, "small.txt");
    const big = join(dir, "big.txt");
    writeFileSync(small, "a\nb");
    writeFileSync(big, Array(400).fill("x").join("\n"));
    assert.equal(checkReadRequest({ filePath: small }, 350), null);
    const msg = checkReadRequest({ filePath: big }, 350);
    assert.ok(msg);
    assert.ok(msg!.includes("bulk-reader"));
    assert.ok(msg!.includes("offset/limit"));
    assert.ok(!msg!.includes("xxxxx"), "message must not include file contents");
    rmSync(dir, { recursive: true });
  });

  it("allows targeted read even on big file", () => {
    assert.equal(checkReadRequest({ filePath: "big.txt", offset: 1, limit: 10 }, 350), null);
    assert.equal(checkReadRequest({ filePath: "big.txt", offset: 1 }, 350), null);
    assert.equal(checkReadRequest({ filePath: "big.txt", limit: 10 }, 350), null);
  });

  it("allows missing path", () => {
    assert.equal(checkReadRequest({}, 350), null);
    assert.equal(checkReadRequest({ filePath: "" }, 350), null);
    assert.equal(checkReadRequest({ filePath: "/no/such.txt" }, 350), null);
  });

  it("blocks big cat and allows piped, small, non-string", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-bash-"));
    const big = join(dir, "big.txt");
    const small = join(dir, "small.txt");
    writeFileSync(big, Array(400).fill("y").join("\n"));
    writeFileSync(small, "hi");
    const blockMsg = checkBashRequest(`cat ${big}`, 350);
    assert.ok(blockMsg);
    assert.ok(blockMsg!.includes("bulk-reader"));
    assert.equal(checkBashRequest(`cat ${small}`, 350), null);
    assert.equal(checkBashRequest(`cat ${big} | head -20`, 350), null);
    assert.equal(checkBashRequest("cat $FILE", 350), null);
    assert.equal(checkBashRequest(12345, 350), null);
    assert.equal(checkBashRequest("ls -la", 350), null);
    rmSync(dir, { recursive: true });
  });

  it("handleToolBefore throws only on block and ignores other tools", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-hook-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("z").join("\n"));
    assert.throws(() => handleToolBefore({ tool: "READ" }, { args: { filePath: big } }, 350));
    assert.doesNotThrow(() =>
      handleToolBefore({ tool: "read" }, { args: { filePath: big, limit: 5 } }, 350)
    );
    assert.doesNotThrow(() =>
      handleToolBefore({ tool: "edit" }, { args: { filePath: big } }, 350)
    );
    assert.doesNotThrow(() => handleToolBefore({}, {}, 350));
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL with `checkReadRequest is not exported`.

- [ ] **Step 3: Write minimal implementation**

Insert into `src/index.ts` before the `BigLittlePlugin` stub:

```ts
export function buildReadBlockMessage(lines: number, minLines: number): string {
  return (
    `File is ${lines} lines (threshold: ${minLines}). ` +
    `Delegate to the bulk-reader subagent instead of reading it directly. ` +
    `If you need exact content for editing, re-read with offset/limit for just the section you need.`
  );
}

export function buildBashBlockMessage(lines: number, minLines: number): string {
  return (
    `File is ${lines} lines (threshold: ${minLines}). ` +
    `Do not cat large files into context — delegate to the bulk-reader subagent instead, ` +
    `or use a targeted read (grep, offset/limit) for the section you need.`
  );
}

export function checkReadRequest(
  args: { filePath?: string; offset?: number | null; limit?: number | null },
  minLines: number
): string | null {
  if (args.offset != null || args.limit != null) return null;
  if (!args.filePath) return null;
  const lines = countLines(args.filePath);
  if (lines === null || lines <= minLines) return null;
  return buildReadBlockMessage(lines, minLines);
}

export function checkBashRequest(command: unknown, minLines: number): string | null {
  if (typeof command !== "string") return null;
  for (const target of extractBashTargets(command)) {
    const lines = countLines(target);
    if (lines !== null && lines > minLines) {
      return buildBashBlockMessage(lines, minLines);
    }
  }
  return null;
}

export function handleToolBefore(
  input: { tool?: unknown },
  output: { args?: Record<string, unknown> },
  minLines: number
): void {
  const tool = String(input?.tool ?? "").toLowerCase();
  const args = (output?.args ?? {}) as Record<string, any>;
  if (tool === "read") {
    const msg = checkReadRequest(
      { filePath: args.filePath, offset: args.offset, limit: args.limit },
      minLines
    );
    if (msg !== null) throw new Error(msg);
    return;
  }
  if (tool === "bash") {
    const msg = checkBashRequest(args.command, minLines);
    if (msg !== null) throw new Error(msg);
    return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "feat: add read and bash routing checks"
```

---

### Task 6: Wire BigLittlePlugin Export

**Files:**
- Modify: `src/index.ts`
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: `resolveThreshold`, `applyAgentConfig`, `handleToolBefore` from Tasks 2, 4, 5.
- Produces: `export const BigLittlePlugin: Plugin` with `config` and `tool.execute.before` keys, and the default `PluginModule` export `{ id: "big-little", server: BigLittlePlugin }`.

Rules: read threshold once at plugin init. Restart picks up changes. Options come from the second function argument (`options?: PluginOptions`). `PluginInput` has no options field (verified). `config` hook calls `applyAgentConfig`. `tool.execute.before` calls `handleToolBefore` with stored threshold. Wrap handler body in try/catch. On unexpected error, allow (return void). Only deliberate block throws leave the function. Never add `event` hook.

- [ ] **Step 1: Write the failing test**

First extend the static import at the top of `test/plugin.test.ts` to include `BigLittlePlugin`. Tests also need the default export, so add a separate default import line:

```ts
import {
  resolveThreshold,
  countLines,
  DEFAULT_MIN_LINES,
  extractBashTargets,
  buildAgentConfig,
  applyAgentConfig,
  checkReadRequest,
  checkBashRequest,
  handleToolBefore,
  BigLittlePlugin,
} from "../src/index.ts";
import BigLittleModuleDefault from "../src/index.ts";
```

Then append:

```ts
describe("BigLittlePlugin wiring", () => {
  it("default-exports a PluginModule wrapping BigLittlePlugin", () => {
    const mod: any = BigLittleModuleDefault;
    assert.equal(mod.id, "big-little");
    assert.strictEqual(mod.server, BigLittlePlugin);
  });

  it("exposes config and tool.execute.before hooks", async () => {
    const plugin: any = await BigLittlePlugin({} as any);
    assert.ok(typeof plugin.config === "function");
    assert.ok(typeof plugin["tool.execute.before"] === "function");
    assert.ok(!("event" in plugin), "event hook must not exist in v1");
  });

  it("config hook preserves user agents", async () => {
    const plugin: any = await BigLittlePlugin({} as any);
    const cfg: any = { agent: { mine: { mode: "primary" } } };
    await plugin.config(cfg);
    assert.ok(cfg.agent.mine);
    assert.ok(cfg.agent["bulk-reader"]);
    assert.ok(cfg.agent["code-writer"]);
  });

  it("tool hook blocks big read and passes targeted read", async () => {
    const plugin: any = await BigLittlePlugin({} as any, { minLines: 350 });
    const dir = mkdtempSync(join(tmpdir(), "bl-wire-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("w").join("\n"));
    await assert.rejects(
      plugin["tool.execute.before"](
        { tool: "read", sessionID: "s", callID: "c" },
        { args: { filePath: big } }
      )
    );
    await plugin["tool.execute.before"](
      { tool: "read", sessionID: "s", callID: "c" },
      { args: { filePath: big, limit: 5 } }
    );
    rmSync(dir, { recursive: true });
  });

  it("options come from the second argument", async () => {
    const plugin: any = await BigLittlePlugin({} as any, { minLines: 10 });
    const dir = mkdtempSync(join(tmpdir(), "bl-opts-"));
    const medium = join(dir, "medium.txt");
    writeFileSync(medium, "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk"); // 11 lines
    await assert.rejects(
      plugin["tool.execute.before"](
        { tool: "read", sessionID: "s", callID: "c" },
        { args: { filePath: medium } }
      )
    );
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because the stub returns `{}` with no hooks.

- [ ] **Step 3: Write minimal implementation**

Replace the `BigLittlePlugin` stub in `src/index.ts` with:

```ts
export const BigLittlePlugin: Plugin = async (_input: any, options?: any) => {
  const opts: BigLittleOptions =
    options && typeof options === "object" ? (options as BigLittleOptions) : {};
  const minLines = resolveThreshold(opts);

  return {
    config: async (cfg: any) => {
      await applyAgentConfig(cfg, opts);
    },
    "tool.execute.before": async (input: any, output: any) => {
      try {
        handleToolBefore(
          { tool: input?.tool },
          { args: (output?.args ?? {}) as Record<string, unknown> },
          minLines
        );
      } catch (err) {
        // Fail open on unexpected errors; only deliberate block throws leave.
        if (err instanceof Error && err.message.startsWith("File is ")) throw err;
      }
    },
  };
};

export default { id: "big-little", server: BigLittlePlugin } satisfies PluginModule;
```

The second parameter is the options object from the `plugin` tuple in `opencode.json`. It is typed loosely (`any`) because the installed `Plugin` type marks it optional `PluginOptions`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test
```

Expected: PASS. Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/plugin.test.ts
git commit -m "feat: wire BigLittlePlugin export with config and routing hooks"
```

---

### Task 7: README, Fixture Proof, Benchmark Checklist

**Files:**
- Modify: `README.md`
- Create: `scripts/verify-fixture.sh`
- Test: rerun full suite, then run the fixture script. Manual gates below.

**Interfaces:**
- Consumes: final `src/index.ts`, built `dist/`.
- Produces: install docs, a scripted no-model fixture gate (CI-able), and the model benchmark checklist.

Isolation model (verified empirically on OpenCode 1.18.31):

- Dev loop runs in a throwaway fixture directory. Project config is scoped to where OpenCode starts, so the plugin loads only inside the fixture. Production OpenCode is untouched. Keep the fixture in `/tmp`, never commit an `opencode.json` at the big-little repo root, and never start production OpenCode inside the fixture.
- The plugin loads from a local path (directory with `package.json`), which skips the npm compatibility gate — intended for dev. Release installs via npm tuple `["big-little", {...}]`, which the gate applies to.
- Optional full isolation: run the script with `SANDBOX=1`. It sets `XDG_CONFIG_HOME` to a throwaway dir and unsets `OPENCODE_CONFIG_CONTENT`, so the global config, global plugins, and MCP servers never load. Use this in CI.
- `opencode debug config` prints the resolved config as JSON. `opencode debug agent <name>` prints the agent with permissions expanded into ordered rules. Both need no model and no session. `tool.execute.before` cannot fire through these commands — that is the model gate (Step 6).

README must include: install snippet with `opencode.json`, options table with exact env names, threshold rule, limits, deprecated `SHUNT_MIN_LINES` note, `PORTAL_*` not honored note, and a verify-install section.

- [ ] **Step 1: Rewrite `README.md`**

````markdown
# big-little

OpenCode plugin. Big model keeps orchestration. Little worker subagents do bulk reads and boilerplate.

Requires OpenCode 1.x (1.18 or later). OpenCode 2 beta is not supported.

## Install

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["big-little"]
}
```

Restart OpenCode after install. Restart picks up config changes.

## Verify your install

Run `opencode debug config`. Check that `bulk-reader` and `code-writer` appear under `agent`. Run `opencode debug agent bulk-reader` to see the expanded permission rules. Both commands use no model.

## Configuration

Every option is optional. Env vars apply only when the matching option is absent.

With options (tuple form):

```json
{
  "plugin": [
    ["big-little", { "minLines": 500 }]
  ]
}
```

| Option | Env fallback | Default | Rule |
| --- | --- | --- | --- |
| `minLines` | `BIGLITTLE_MIN_LINES`, then deprecated `SHUNT_MIN_LINES` | `350` | Positive integer. Zero, negative, or garbage means `350`. |
| `bulkReaderModel` | `BIGLITTLE_BULK_READER_MODEL` | unset (inherit caller model) | Example `anthropic/claude-haiku-4-20250514`. |
| `codeWriterModel` | `BIGLITTLE_CODE_WRITER_MODEL` | unset (inherit caller model) | Same semantics. |

`PORTAL_MIN_LINES` and `PORTAL_*_MODEL` are not honored.

## What it does

- Registers `bulk-reader` (read-only explorer) and `code-writer` (boilerplate writer via `edit`).
- Blocks full-file `read` over threshold. Message names `bulk-reader` and offers `offset/limit` retry.
- Blocks `cat|head|tail|less|more` over threshold. Piped commands pass.
- Targeted reads (`offset` or `limit` set) always pass.

## Limits

- Set a cheap worker model or you get discipline without cost saving.
- Re-read target sections with `offset/limit` before edit. Worker line numbers can drift.
- Keep debugging and architecture on the main model.
- `code-writer` cannot run bash or network. Caller runs tests and lint.
````

- [ ] **Step 2: Run full suite and build**

Run:

```bash
npm test && npm run build
```

Expected: PASS, all tests green, `dist/index.js` and `dist/index.d.ts` exist.

- [ ] **Step 3: Create `scripts/verify-fixture.sh`**

```bash
#!/usr/bin/env bash
# Load proof for big-little. No model calls.
# Usage: scripts/verify-fixture.sh           (normal run, global config merges)
#        SANDBOX=1 scripts/verify-fixture.sh (full env isolation, for CI)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$(mktemp -d /tmp/biglittle-fixture.XXXXXX)"
XDGD="$(mktemp -d /tmp/biglittle-xdg.XXXXXX)"
trap 'rm -rf "$FIX" "$XDGD"' EXIT

npm --prefix "$ROOT" run build

# Fixture project: big file, small file, plugin via local path with low threshold.
mkdir -p "$FIX"
seq 1 400 > "$FIX/big.txt"
seq 1 3 > "$FIX/small.txt"
cat > "$FIX/opencode.json" <<EOF
{ "plugin": [["$ROOT", { "minLines": 10 }]] }
EOF

if [ "${SANDBOX:-0}" = "1" ]; then
  ISOLATION=(env -u OPENCODE_CONFIG_CONTENT "XDG_CONFIG_HOME=$XDGD")
else
  ISOLATION=(env)
fi

cd "$FIX"

# 1. Plugin loads, options tuple arrives, both agents land in resolved config.
"${ISOLATION[@]}" opencode debug config > resolved.json 2> err.log
node -e '
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("resolved.json", "utf8"));
const br = cfg.agent?.["bulk-reader"];
const cw = cfg.agent?.["code-writer"];
if (!br) throw new Error("bulk-reader missing from resolved config");
if (!cw) throw new Error("code-writer missing from resolved config");
if (br.mode !== "subagent") throw new Error("bulk-reader is not subagent");
if (br.permission?.bash?.["*"] !== "deny") throw new Error("bash default is not deny");
if (br.permission?.bash?.["ls*"] !== "allow") throw new Error("ls* is not allowed");
if (cw.permission?.bash !== "deny") throw new Error("code-writer bash is not deny");
if (cw.permission?.edit !== "allow") throw new Error("code-writer edit is not allow");
console.log("PASS: agents injected with expected permission shape");
'

# 2. Expanded agent rules match the spec allowlist.
"${ISOLATION[@]}" opencode debug agent bulk-reader > agent-br.json 2>> err.log
node -e '
const fs = require("fs");
const agent = JSON.parse(fs.readFileSync("agent-br.json", "utf8"));
const rules = agent.permission ?? [];
const has = (permission, pattern, action) =>
  rules.some((r) => r.permission === permission && r.pattern === pattern && r.action === action);
if (!has("bash", "ls*", "allow")) throw new Error("expanded rules lack ls* allow");
if (!has("bash", "git log*", "allow")) throw new Error("expanded rules lack git log* allow");
if (!has("bash", "*", "deny")) throw new Error("expanded rules lack bash default deny");
if (!has("edit", "*", "deny")) throw new Error("expanded rules lack edit deny");
if (!has("task", "*", "deny")) throw new Error("expanded rules lack task deny");
console.log("PASS: bulk-reader expanded rules match spec allowlist");
'

# 3. Sandbox mode: global config must not leak in.
if [ "${SANDBOX:-0}" = "1" ]; then
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync("resolved.json", "utf8"));
    const plugins = JSON.stringify(cfg.plugin ?? []);
    if (plugins.includes("openchamber")) throw new Error("global plugin leaked into sandbox");
    if (cfg.mcp && Object.keys(cfg.mcp).length > 0) throw new Error("global MCP leaked into sandbox");
    console.log("PASS: sandbox isolation holds");
  '
fi

echo "fixture proof passed"
```

- [ ] **Step 4: Run the fixture proof, both modes**

Run:

```bash
chmod +x scripts/verify-fixture.sh
scripts/verify-fixture.sh
SANDBOX=1 scripts/verify-fixture.sh
```

Expected: three PASS lines in normal mode plus the sandbox PASS, ending with `fixture proof passed`. If the plugin fails to load, check `err.log` in the fixture, then check the default `PluginModule` export and the `exports["./server"]` subpath first — both are load-contract requirements. Record OpenCode version and `@opencode-ai/plugin` version with the release notes. If behavior contradicts the Verified Facts section, update that section and the affected tasks.

- [ ] **Step 5: Hook-fire proof (manual, one model call, per session)**

This is the only gate that exercises `tool.execute.before` for real. In the fixture dir from Step 3 (recreate it if the script cleaned it up), start OpenCode with a model configured:

1. Run `opencode run "Read the file big.txt in full"` (or type the equivalent in the TUI).
2. Expect the block message: `File is 400 lines (threshold: 10)...` naming `bulk-reader`.
3. Run `opencode run "Read lines 1 to 5 of big.txt"`. Expect success.
4. Check `@bulk-reader` and `@code-writer` autocomplete in the TUI.
5. Via bash ask the model to `cat big.txt`. Expect the bash block message. Ask for `cat big.txt | head -5`. Expect success.

- [ ] **Step 6: Token benchmark (manual, models set, done gate)**

1. Fix corpus: one multi-file Q and A task, one spec-plus-reference generation task. Freeze files and threshold.
2. Run A: direct reads. Note input plus output tokens.
3. Run B: delegated `bulk-reader` summary plus `offset/limit` re-read of edit targets. Note tokens.
4. Run C: `code-writer` from spec plus reference file. Caller reads reference only, never full output in chat. Note tokens.
5. Record corpus, models, threshold, and before and after counts with the release notes. No fixed percent promised. If delegation costs more, note why and keep the result with the release.

- [ ] **Step 7: Commit**

```bash
git add README.md scripts/verify-fixture.sh
git commit -m "feat: add scripted fixture proof and config docs"
```

---

## Self-Review

1. Spec coverage. Section 3 package layout maps to Tasks 1 and 6. Section 4 agents map to Task 4. Section 5 read routing maps to Task 5. Section 5 bash routing maps to Tasks 3 and 5. Section 6 config and env map to Tasks 2 and 4. Error invariants map to Task 5 and the fail-open wrapper in Task 6. Layer 1 tests map to Tasks 2 to 6. Layer 2 maps to the scripted fixture proof (Task 7 Steps 3 to 5: no-model load proof plus one model-driven hook-fire check). Layer 3 maps to Task 7 Step 6. Spec said "implementation confirms the exact options-passing shape against the installed @opencode-ai/plugin types and documents it" — done: tuple form, verified in the Verified Facts section and documented in README (Task 7). No gap.
2. Placeholder scan. No TBD. No TODO. No similar-to-task. Each code step shows full code. Each test step shows full test. Each run step shows exact command and expected result.
3. Type consistency. Names stay the same across tasks: `resolveThreshold`, `countLines`, `extractBashTargets`, `checkReadRequest`, `checkBashRequest`, `handleToolBefore`, `buildAgentConfig`, `applyAgentConfig`, `resolveModels`, `BigLittlePlugin`, `BigLittleOptions`, `DEFAULT_MIN_LINES`, `buildReadBlockMessage`, `buildBashBlockMessage`. Block message text matches spec exact strings in Task 5. Bash allowlist keys match spec in Task 4. The default `PluginModule` export is identical in Tasks 1, 2, and 6.
4. Validation. Assumptions checked against installed types (`@opencode-ai/plugin` 1.18.27), the official config schema (`opencode.ai/config.json`), the OpenCode loader source (`packages/opencode/src/plugin/index.ts`, `shared.ts`), and an empirical Node 22.23 type-stripping test. Corrections applied: default `PluginModule` export required, tuple options form, `exports["./server"]` subpath required, `ctx.options` fallback removed (not in V1 types), Node-native TS test flow.
