# Findings: OpenCode Plugins + Hooks for Routing to Specific Agents

## 1. Plugin directory layout (OpenCode native)

**Sources:**
- https://opencode.ai/docs/plugins/
- https://dev.opencode.ai/docs/plugins/

OpenCode has **no `plugin.json`**. A plugin is a JS/TS module exporting a plugin function. There are two load mechanisms:

```
~/.config/opencode/plugins/   # global plugins (all projects)
.opencode/plugins/            # project-level plugins
.opencode/package.json        # optional deps for local plugins
opencode.json                 # { "plugin": ["npm-package", "@scope/pkg"] }
~/.config/opencode/opencode.json
```

Load order (all hooks run in sequence):
1. Global config (`~/.config/opencode/opencode.json`)
2. Project config (`opencode.json`)
3. Global plugin dir
4. Project plugin dir

Duplicate npm name+version loaded once; local + npm with similar names both load.

From npm (`opencode.json`):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-helicone-session", "opencode-wakatime", "@my-org/custom-plugin"]
}
```
Installed via Bun at startup, cached in `~/.cache/opencode/node_modules/`.

Local deps (`.opencode/package.json`):
```json
{ "dependencies": { "shescape": "^2.1.0" } }
```
`bun install` runs at startup; plugins can then `import`.

Suggested self-contained portal layout (OpenCode-native, no `plugin.json` needed):
```
.opencode/
  plugins/
    portal.ts         # or portal.js — exports PortalPlugin, routing hooks
  agents/             # custom agents auto-discovered, or injected via `config` hook
    bulk-reader.md
    code-writer.md
  skills/             # e.g. bulk-reader skill if you want slash-invocable
```

> Note: `plugin.json` + `hooks/*.sh` + `agents/*.md` layout is **Claude Code plugin convention**, used by `sorantis/portal-ai-plugins/plugins/shunt/` and by community adapters like `shanebishop1/opencode-command-hooks` and `Cipher-85/OpenCode-Game-Studios/.opencode/docs/hooks-reference.md`, not OpenCode core. If strict OpenCode-native is required, use `*.ts` plugin + `tool.execute.before`; if Claude-compat is desired, add a thin JS adapter (see §5).

## 2. Plugin function schema

```ts
// .opencode/plugins/example.ts
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  console.log("Plugin initialized!")
  return {
    // Hook implementations go here
  }
}
```

Context args:
- `project`: current project info
- `directory`: cwd
- `worktree`: git worktree path
- `client`: opencode SDK client (e.g. `client.app.log()`, `client.session.*`)
- `$`: Bun shell API (`await $\`osascript ...\``)

JS equivalent:
```js
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  return { /* hooks */ }
}
```

Multiple named exports allowed per file; every exported function is treated as a plugin.

Structured logging (prefer over `console.log`):
```ts
await client.app.log({
  body: { service: "my-plugin", level: "info", message: "Plugin initialized", extra: { foo: "bar" } }
})
// level: debug | info | warn | error
```

## 3. Hooks reference

### 3.1 Hook table (from `joshuadavidthomas/opencode-plugins-manual/docs/04-hooks-reference.md`, commit 3efc95b, cross-checked with official docs)

| Hook | Purpose | Can mutate |
|------|---------|------------|
| `config` | Inject commands, agents, MCP servers; runs once at init; mutates input directly | config object |
| `tool` | Register custom tools `{ [name]: ToolDefinition }` | N/A (returns tools) |
| `auth` | Register auth providers | N/A |
| `event` | Subscribe to all system events (observer only) | nothing |
| `chat.message` | Process incoming messages | message + parts |
| `chat.params` | Modify LLM params | temperature, topP, options |
| `permission.ask` | Handle permission requests | status ask/deny/allow |
| `tool.execute.before` | Pre-execution; **main routing/blocking point** | `output.args` |
| `tool.execute.after` | Post-execution | tool output |
| `experimental.text.complete` | Post-generation text modification | generated text |
| `experimental.session.compacting` | Inject/replace compaction prompt | `output.context[]`, `output.prompt` |
| `shell.env` | Inject env into all shell exec (AI tools + user terminals) | `output.env` |

Official docs “Events” list (values for generic `event` hook):
- Command: `command.executed`
- File: `file.edited`, `file.watcher.updated`
- Install: `installation.updated`
- LSP: `lsp.client.diagnostics`, `lsp.updated`
- Message: `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`
- Permission: `permission.asked`, `permission.replied`
- Server: `server.connected`
- Session: `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`
- Todo: `todo.updated`
- Shell: `shell.env`
- Tool: `tool.execute.after`, `tool.execute.before`
- TUI: `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`

### 3.2 Exact signatures

**`tool.execute.before` — rewrite / block / route:**
```ts
// from oh-my-opencode/src/plugin/tool-execute-before.ts (illnar-io + magicJie forks)
(input: { tool: string; sessionID: string; callID: string },
 output: { args: Record<string, unknown> }) => Promise<void>
```
- Mutate `output.args` in place to rewrite.
- `throw new Error("...")` to block (official `.env` example).
- `input.tool` is lowercase-compared in practice (`input.tool.toLowerCase()`).

**`tool.execute.after`:**
```ts
(input: { tool: string; sessionID: string; callID: string },
 output: { output: string; title?: string; metadata?: unknown }) => Promise<void>
```

**`event` (observer):**
```ts
event: async ({ event }: { event: { type: string; properties: Record<string, unknown> } }) => {
  if (event.type === "session.idle") { /* ... */ }
  if (event.type.startsWith("session.")) { /* ... */ }
}
```

**`shell.env`:**
```js
"shell.env": async (input, output) => {
  output.env.MY_API_KEY = "secret"
  output.env.PROJECT_ROOT = input.cwd
}
```

**`experimental.session.compacting`:**
```ts
"experimental.session.compacting": async (input, output) => {
  output.context.push(`## Custom Context\n...`); // appended to default prompt
  // OR replace entirely:
  // output.prompt = `You are generating a continuation prompt ...`
}
```
When `output.prompt` is set, `output.context` is ignored.

## 4. How hooks route / block / rewrite to agents

### Pattern A — block via throw (official)
```js
// .opencode/plugins/env-protection.js — source: https://opencode.ai/docs/plugins/
export const EnvProtection = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("Do not read .env files")
      }
    },
  }
}
```

### Pattern B — rewrite args in place (official)
```js
import { escape } from "shescape"
export const MyPlugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") {
        output.args.command = escape(output.args.command)
      }
    },
  }
}
```

### Pattern C — route `task` to specific subagent (oh-my-opencode, verified in two forks)
```ts
// https://github.com/illnar-io/oh-my-opencode/blob/dev/src/plugin/tool-execute-before.ts
if (input.tool === "task") {
  const argsObject = output.args
  const category = typeof argsObject.category === "string" ? argsObject.category : undefined
  // ...
  const resolvedAgent = await resolveSessionAgent(ctx.client, sessionId)
  argsObject.subagent_type = resolvedAgent ?? "continue"
}
```
This is the direct mechanism for Portal-style routing: intercept `task` (or `skill`) calls in `tool.execute.before` and set `output.args.subagent_type` / `output.args.agent` to `bulk-reader` or `code-writer`. Also observed: intercepting `skill` tool (`if (hooks.ralphLoop && input.tool === "skill")`) to rewrite `output.args.name`.

Other production guards seen in `magicJie/oh-my-opencode` fork:
```ts
if (input.tool.toLowerCase() === "bash" && typeof output.args.command === "string") {
  if (output.args.command.includes("\x00")) {
    output.args.command = output.args.command.replace(/\x00/g, "")
  }
}
```

### Pattern D — session lifecycle routing
```js
export const NotificationPlugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`osascript -e 'display notification "Session completed!" with title "opencode"'`
      }
    },
  }
}
```
Use `session.created` to inject context / pick agent; `session.idle` to archive; `session.compacted` + `experimental.session.compacting` to preserve routing state across compaction.

## 5. Hook inspiration: `shunt/hooks/check-file-size` (Claude-Code style, not OpenCode-native)

**Source:** https://github.com/sorantis/portal-ai-plugins/blob/add-shunt-claude/plugins/shunt/hooks/check-file-size (branch `add-shunt-claude`, 33 lines, executable bash, 1.23 KB)

Stdin/stdout contract (Claude `PreToolUse`):
- Input JSON on stdin: `{ "tool_input": { "file_path": "...", "offset": ..., "limit": ... } }`
- Output JSON on stdout: `{"decision":"allow"}` or `{"decision":"block","reason":"..."}`

Reconstructed script (unescaped from GitHub-rendered view):
```bash
#!/bin/bash
# Block full-file reads on large files, redirect to /bulk-reader skill
# Self-contained: all routing logic lives here, no CLAUDE.md needed
MIN_LINES="${SHUNT_MIN_LINES:-350}"
case "$MIN_LINES" in ''|*[!0-9]*) MIN_LINES=350 ;; esac
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
offset=$(echo "$input" | jq -r '.tool_input.offset // empty')
limit=$(echo "$input" | jq -r '.tool_input.limit // empty')
# Allow targeted reads (offset or limit set) — Claude already knows what it needs
if [ -n "$offset" ] || [ -n "$limit" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi
# Allow if file doesn't exist or path is empty
if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi
# Allow small files — delegation overhead isn't worth it
lines=$(wc -l < "$file_path" 2>/dev/null | tr -d ' ' || echo "0")
if [ "$lines" -le "$MIN_LINES" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi
echo "{\"decision\": \"block\", \"reason\": \"File is ${lines} lines (threshold: ${MIN_LINES}). Use the /bulk-reader skill to delegate this read to AiKA instead of reading it directly. If you need exact content for editing, re-read with an offset/limit for just the section you need.\"}"
```

Design takeaways for OpenCode port:
- Threshold via env `SHUNT_MIN_LINES`, default 350, validated numeric.
- Allow-list: targeted reads, missing files, small files.
- Block message tells agent exactly what to do instead (`/bulk-reader` skill + offset/limit fallback).
- To run this logic in OpenCode, either (a) reimplement in `tool.execute.before` checking `input.tool === "read"` and `output.args`, throwing or rewriting to a `task` call with `subagent_type: "bulk-reader"`, or (b) keep bash file + thin adapter that builds Claude-shaped stdin (see below).

## 6. Adapter pattern: running Claude-style shell hooks inside OpenCode

**Sources:**
- https://github.com/Cipher-85/opencode-game-studios/blob/main/.opencode/docs/hooks-reference.md
- https://github.com/shanebishop1/opencode-command-hooks/blob/main/src/executor.ts
- https://github.com/joshuadavidthomas/opencode-plugins-manual/blob/main/docs/07-events.md
- https://github.com/joshuadavidthomas/opencode-plugins-manual/blob/main/docs/04-hooks-reference.md

`ccgs-hooks.js` / `opencode-command-hooks` approach: OpenCode JS plugin maps OpenCode events to shell scripts with Claude-shaped stdin JSON. Mapping table (from Cipher-85):

| Shell script | OpenCode event | Upstream (Claude) | Trigger |
|---|---|---|---|
| `validate-commit.sh` | `tool.execute.before` (bash) | PreToolUse (Bash) | `git commit` |
| `validate-push.sh` | `tool.execute.before` (bash) | PreToolUse (Bash) | `git push` to protected branch |
| `validate-assets.sh` | `tool.execute.after` (write/edit) | PostToolUse | asset changes |
| `session-start.sh` | `session.created` | SessionStart | session begins |
| `detect-gaps.sh` | `session.created` | SessionStart | fresh project detect |
| `pre-compact.sh` | `experimental.session.compacting` | PreCompact | inject `output.context[]` |
| `post-compact.sh` | `session.compacted` | PostCompact | restore state |
| `session-stop.sh` | `session.idle` | Stop | archive |
| `log-agent.sh` | `tool.execute.before` (task) | SubagentStart | audit start |
| `log-agent-stop.sh` | `tool.execute.after` (task) | SubagentStop | audit stop |

`opencode-command-hooks` executor semantics (`executor.ts`):
- Single entry point filters hooks by `{ event, toolName, agent, slashCommand, toolArgs }`.
- Normalizes `session.start` → `session.created`.
- `filterToolHooks` supports `when.toolArgs` exact matching (e.g. only fire when `filePath` matches glob).
- **Non-blocking:** hook failures never throw; they log + optionally inject into session. Contrast with native `throw new Error()` blocking — choose per use-case.

Minimal OpenCode-native port of `check-file-size` (no shell adapter needed):
```ts
import type { Plugin } from "@opencode-ai/plugin"
import { statSync, readFileSync } from "node:fs"

export const PortalRouter: Plugin = async () => {
  const MIN_LINES = Number(process.env.SHUNT_MIN_LINES ?? 350) || 350
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "read") return
      const { filePath, offset, limit } = output.args as {
        filePath?: string; offset?: number; limit?: number
      }
      if (offset != null || limit != null) return // targeted read, allow
      if (!filePath) return
      let lines = 0
      try {
        lines = readFileSync(filePath, "utf8").split("\n").length
      } catch { return } // missing file, allow
      if (lines <= MIN_LINES) return
      throw new Error(
        `File is ${lines} lines (threshold: ${MIN_LINES}). ` +
        `Delegate to bulk-reader subagent instead of reading directly. ` +
        `If you need exact content for editing, re-read with offset/limit.`
      )
    },
    // Agent routing example: force large-read tasks to bulk-reader
    // (extend with your own heuristics on output.args.description/prompt)
    // if (input.tool === "task") { (output.args as any).subagent_type = "bulk-reader" }
  }
}
```

Node shell-adapter alternative (if reusing `check-file-size` file as-is):
```ts
import type { Plugin } from "@opencode-ai/plugin"
import { execFileSync } from "node:child_process"

export const ShuntAdapter: Plugin = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "read") return
    const stdin = JSON.stringify({
      tool_input: { file_path: (output.args as any).filePath, offset: (output.args as any).offset, limit: (output.args as any).limit },
    })
    const out = execFileSync("./plugins/shunt/hooks/check-file-size", { input: stdin, encoding: "utf8", cwd: directory })
    const decision = JSON.parse(out)
    if (decision.decision === "block") throw new Error(decision.reason)
  },
})
```

## 7. Gaps / caveats
- OpenCode docs do not publish a JSON-schema for hook input/output; signatures above are reconstructed from official examples + `oh-my-opencode` TS + `types.gen.ts` event schemas. Verify against installed `@opencode-ai/plugin` types (`packages/sdk/js`) before finalizing.
- `plugin.json` in the research plan refers to Claude-Code convention; OpenCode-native replacement is the exported `Plugin` function + optional `config` hook returning agents/commands/MCP. If cross-compat with Claude Code is a goal, keep both: `plugin.json` for Claude + `.opencode/plugins/*.ts` adapter for OpenCode.
- `event` hook is observer-only (cannot block); blocking/rewriting must use `tool.execute.before` (throw/mutate) or `permission.ask`.
- 4 fetches/searches used (2× webfetch, 1× mintlify_context, 1× websearch); within 3–5 budget.

## Sources
1. https://opencode.ai/docs/plugins/ (official plugin docs, structure, events, examples)
2. https://github.com/sorantis/portal-ai-plugins/blob/add-shunt-claude/plugins/shunt/hooks/check-file-size (bash hook inspiration, allow/block JSON contract)
3. Mintlify context: `dev.opencode.ai/docs/plugins/` + `opencode.ai/docs/plugins.md` (load order, TS types)
4. Websearch “opencode plugin hooks tool.execute.before input output JSON schema event types” — esp.:
   - https://github.com/illnar-io/oh-my-opencode/blob/dev/src/plugin/tool-execute-before.ts
   - https://github.com/magicJie/oh-my-opencode/blob/dev/src/plugin/tool-execute-before.ts
   - https://github.com/joshuadavidthomas/opencode-plugins-manual/blob/main/docs/04-hooks-reference.md
   - https://github.com/joshuadavidthomas/opencode-plugins-manual/blob/main/docs/07-events.md
   - https://github.com/joshuadavidthomas/opencode-plugins-manual/blob/main/docs/appendix/event-schemas.md
   - https://github.com/Cipher-85/opencode-game-studios/blob/main/.opencode/docs/hooks-reference.md
   - https://github.com/shanebishop1/opencode-command-hooks/blob/main/src/executor.ts
