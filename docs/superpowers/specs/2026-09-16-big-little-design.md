# big-little OpenCode Plugin — Design Spec

Date: 2026-09-16
Status: approved in sections, pending written-spec review
Source research: `research/research_report.md`, `research/findings_*.md`, prototype `research/portal/plugin.ts`

## 1. Overview

`big-little` is an OpenCode npm plugin implementing the Spotify Portal big-little pattern:
I/O-heavy grunt work (bulk reads, boilerplate generation) runs on cheap worker subagents,
while the frontier model keeps orchestration, reasoning, and edits.

The plugin ships two subagents — `bulk-reader` (read-only explorer) and `code-writer`
(boilerplate generator that writes via `edit`) — plus a `tool.execute.before` routing hook
that hard-blocks large full-file reads and redirects them to `bulk-reader`.


## 2. Goals / non-goals

Goals:
- Self-contained npm package installed via the `plugin` field in `opencode.json`.
- Single TS runtime entry exporting `BigLittlePlugin`; `config` hook injects both agents.
- Hard-block routing on large `read` and `cat|head|tail|less|more` via `tool.execute.before`.
- Model and threshold configured via package options, with `BIGLITTLE_*` env fallback.
- `bulk-reader` bash access enforced read-only at the permission layer, not just the prompt.
- `code-writer` stays fully locked down (no bash, no network, no delegation).
- Done gate includes unit tests, fixture install proof, and a manual token benchmark.

Non-goals (v1):
- No Claude-Code compat surface: no `plugin.json`, no `hooks/*.sh` shipped.
- No slash commands, skills, or auto-delegation heuristics beyond the block message.
- No `task`-tool rewriting (`subagent_type` forcing), no session lifecycle handling,
  no compaction state, no bypass/disable flag.
- No hardcoded model defaults; no telemetry or cost reporting.

## 3. Architecture and package layout

- Package name: `big-little`.
- Consumers install via `opencode.json`: `{ "plugin": ["big-little"] }`.
- Plugin options (`minLines`, `bulkReaderModel`, `codeWriterModel`) are passed via
  the plugin entry's options object in `opencode.json`; implementation confirms the
  exact options-passing shape against the installed `@opencode-ai/plugin` types and
  documents it in the package README. `BIGLITTLE_*` env vars remain as fallback.
- Single runtime module is the only shipped code path, exporting `BigLittlePlugin`
  shaped as an OpenCode `Plugin` function (`async (ctx) => ({ config, "tool.execute.before" })`).
- `config` hook mutates `cfg.agent` to register `bulk-reader` and `code-writer`; it merges
  with existing `cfg.agent` entries and never removes user agents.
- Agent prompts live in TS as the single source of truth. No `agent/*.md` files are needed
  at runtime. The research prototype under `research/portal/` remains reference-only
  and is not shipped.
- OpenCode-native only: routing logic lives in TypeScript using `node:fs`. No shell-out
  adapter, no `jq`/`wc` dependency.
- Failure model: hook failures fail open (allow) except for deliberate `throw` blocks
  described in section 5.

## 4. Agents

Common: `mode: "subagent"`, `temperature: 0.2`, `task: deny` (no recursive delegation).
`model` is set only when package config (or env fallback) provides it; when unset the
subagent inherits the caller model (works everywhere, no cost saving).

### 4.1 bulk-reader

Purpose: fast read-only exploration over large files and multi-file questions.

- Description carries triggers: large files over threshold, multi-file questions,
  pattern mapping without loading full files; plus thoroughness hint
  (`quick | medium | very thorough`).
- Prompt: top-down Glob/Grep-first workflow, absolute paths in output, concise findings
  with file paths, line numbers, short snippets; strict read-only discipline; bullets-only
  output contract (no greetings/prose/preambles, lead every bullet with exact name/type/
  line number, nested bullets for detail, skip anything unasked); no editing and no
  bug/architecture reasoning beyond what was asked.
- Permission:
  - `"*": "deny"`
  - `grep: allow`, `glob: allow`, `list: allow`, `read: allow`
  - `webfetch: allow`, `websearch: allow`
  - `edit: deny`, `task: deny`
  - `bash`: allowlist restricted to read-only commands with `"*": "deny"` as default
    within bash. Concrete allowlist: `ls*`, `git log*`, `git status*`, `git diff*`,
    `grep*`, `rg*`, `wc*`. No other bash patterns are allowed, so the agent has no
    file creation, modification, move, deletion, or arbitrary execution path.

### 4.2 code-writer

Purpose: generate predictable boilerplate (tests, config scaffolding, type stubs, DTOs)
from a spec plus a required reference file, writing the result to disk via `edit`
so the caller never pays for the generated tokens in chat.

- Description carries triggers: boilerplate/tests/stubs/scaffolding that must match
  existing patterns; requires spec + reference file + target path.
- Prompt: match patterns/conventions/typing/naming/style exactly; resolve ambiguity
  from reference context; raw-code output discipline; fully implemented, no placeholders;
  reference file is required (read it before writing); write finished file with `edit`;
  ambiguous specs resolved toward reference patterns; no refactoring beyond spec and
  no bug/architecture reasoning.
- Permission:
  - `"*": "deny"`
  - `read: allow`, `edit: allow`, `glob: allow`, `grep: allow`, `list: allow`
  - `bash: deny`, `webfetch: deny`, `websearch: deny`, `task: deny`
- Consequence (accepted): `code-writer` cannot run tests, lint, or build. Verification
  of generated code stays on the caller. No read-only bash exception in v1.

## 5. Routing (tool.execute.before)

Hook: `tool.execute.before(input{tool, sessionID, callID}, output{args})`.
Tool name is compared case-insensitively. Only `read` and `bash` are inspected;
all other tools pass through untouched.

### 5.1 read routing

Inputs: `output.args.filePath`, `output.args.offset`, `output.args.limit`.
Logic in order:
1. If `offset != null` or `limit != null`, allow (targeted read).
2. If `filePath` is missing/empty, allow.
3. Count lines via UTF-8 read + `split("\n").length`. If unreadable/missing, allow
   and let the `read` tool report the error.
4. If lines <= threshold, allow.
5. Else throw: `File is {lines} lines (threshold: {minLines}). Delegate to the
   bulk-reader subagent instead of reading it directly. If you need exact content
   for editing, re-read with offset/limit for just the section you need.`
   The message contains counts and next actions only, never file contents.

### 5.2 bash routing

Inputs: `output.args.command` (string only; non-strings pass through).
Logic in order:
1. If command contains `|`, allow (piped commands count as targeted reads).
2. Extract single-shot read targets matching `cat|head|tail|less|more <file>` —
   first file operand per command, skipping flags (`-x`), redirections/variables
   (`$`, `<`), and globs (`*`); strip surrounding quotes. Compound commands joined
   by `;`, `&&`, or `||` are scanned as a whole, so any over-threshold target in any
   segment blocks.
3. For each target: if missing/unreadable, skip (allow); if lines <= threshold, skip.
4. On first target over threshold, throw: `File is {lines} lines (threshold:
   {minLines}). Do not cat large files into context — delegate to the bulk-reader
   subagent instead, or use a targeted read (grep, offset/limit) for the section
   you need.`
5. No silent arg rewrites in v1; no `task`/`skill` interception in v1.

## 6. Configuration and error handling

Package options (passed via the plugin entry's options object in `opencode.json`;
implementation confirms the exact shape against installed types and documents it):
- `minLines`: positive integer, default 350. Non-numeric, zero, or negative
  resolves to 350. Read once at plugin init (restart picks up changes).
- `bulkReaderModel`: e.g. `anthropic/claude-haiku-4-20250514`. Unset means inherit.
- `codeWriterModel`: same semantics as above.

Env fallback (used only when the corresponding package option is absent):
- Canonical: `BIGLITTLE_MIN_LINES`, `BIGLITTLE_BULK_READER_MODEL`,
  `BIGLITTLE_CODE_WRITER_MODEL`.
- Deprecated alias: `SHUNT_MIN_LINES` honored as fallback for `BIGLITTLE_MIN_LINES`
  (documented as deprecated). `PORTAL_MIN_LINES` / `PORTAL_*_MODEL` are not honored
  in the new package; research references to them are historical.
- Threshold parsing: `parseInt` semantics, must be finite and > 0, else 350.

Error handling invariants:
- Block messages are the router: they name `bulk-reader` and offer the
  `offset/limit` (or grep/pipe) fallback.
- Never include file contents in thrown messages.
- No bypass flag in v1 (hard block as approved). Targeted reads are the bypass.
- `event` hook is not used; observation-only needs do not exist in v1.

## 7. Testing and done gate

Three layers; all three are required to call the work done:

1. Unit tests (run in CI without models or a running OpenCode instance):
   - Threshold parsing matrix (unset, valid, zero, negative, garbage → 350).
   - Line counting (small/large/missing/unreadable files).
   - `read` routing matrix: small→allow, big→block, targeted (offset/limit)→allow,
     missing path→allow.
   - `bash` routing matrix: big `cat`→block, small→allow, piped→allow,
     flags/globs/missing→allow, non-string command→allow, other tools untouched.
   - Permission snapshots for both agents (deny-all shape, writer lockdown,
     bulk-reader bash allowlist present).
2. Fixture install proof (manual or scripted, no model calls):
   - Install the built package into a minimal fixture project via `opencode.json`,
     start OpenCode, confirm `@bulk-reader` / `@code-writer` resolve and a large
     `read` produces the block message while a targeted read passes.
   - Also confirms hook signatures against the installed `@opencode-ai/plugin`
     types (research schemas were reconstructed; this is the point where drift
     would surface).
3. Token benchmark (manual, models configured — the done gate):
   - Fixed sample corpus with at least one multi-file Q&A task and one
     spec-plus-reference generation task.
   - Compare estimated input+output tokens for direct reads versus delegated
     `bulk-reader` summaries (and reference-read bypass for `code-writer`).
   - Record corpus, models, threshold, and before/after token counts with the
     release notes. No fixed percentage is promised; the benchmark exists to show
     the mechanism works and to catch regressions where delegation costs more
     than it saves.

CI asserts layer 1. Layers 2 and 3 are documented manual gates with checklists.

## 8. Risks and known limits

- Hook input/output JSON has no published schema; signatures were reconstructed from
  official examples and community plugins. Mitigation: verify against installed
  `@opencode-ai/plugin` types during implementation and re-check on upgrades.
- Savings require a cheap worker model; without it the plugin adds discipline but
  not cost reduction. Mitigation: document this prominently; benchmark proves it.
- Portal caveats carry over: worker summaries may lack reliable line numbers, so
  callers must re-read target sections with `offset`/`limit` before editing; keep
  debugging, architecture, and safety-critical reasoning on the main model.
- Bash allowlist exactness depends on OpenCode permission-map semantics for `bash`
  patterns; overly broad globs would re-open arbitrary execution. Mitigation:
  snapshot tests plus fixture review of what the agent can actually run.
- Live load was never verified in research (`bun` unavailable). Mitigation: fixture
  install proof is a required gate before release.
