# OpenCode Agents Config — Explore Subagent & Custom Agents

## Sources
- https://opencode.ai/docs/agents/ (fetched 2026-09-16, Last updated: Sep 14, 2026)
- https://opencode.ai/docs/plugins/ (fetched 2026-09-16)
- https://v2.opencode.ai/agents (via mintlify_context)
- https://github.com/sst/opencode/blob/c7b35342/packages/opencode/src/agent/agent.ts (via exa search — Zod `Info` schema + `explore` definition)
- https://github.com/anomalyco/opencode/blob/02b7eb59/packages/opencode/src/agent/agent.ts + b6478dce variant (same `explore` definition)
- https://raw.githubusercontent.com/sst/opencode/dev/packages/opencode/src/agent/prompt/explore.txt (exact explore system prompt)
- https://gist.github.com/hamsolodev/5eb4670465eb60d63f56497534e71829 (prompt-construction pipeline summary)

## 1. Built-in agents overview

Two types:

- **Primary** (`mode: primary`): main assistants, cycle with `Tab` / `switch_agent` keybind. Built-ins: `build` (default, all tools), `plan` (edits/bash=`ask` or `deny`, analysis only).
- **Subagent** (`mode: subagent`): invoked by primaries or manually via `@mention`. Built-ins: `general`, `explore`, `scan`/`scout` (docs vary: current docs list `General`, `Explore`, `Scout`; codebase `agent.ts` lists `general`, `explore` + hidden `compaction`, `title`, `summary`).

Hidden system primaries (`hidden: true`, `*: deny`): `compaction`, `title`, `summary` — auto-run, not selectable.

## 2. Default `explore` agent definition

From `packages/opencode/src/agent/agent.ts`:

```ts
explore: {
  name: "explore",
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",
      grep: "allow",
      glob: "allow",
      list: "allow",
      bash: "allow",
      webfetch: "allow",
      websearch: "allow",
      codesearch: "allow", // sst variant; anomalyco variant omits codesearch, keeps read
      read: "allow",
      external_directory: readonlyExternalDirectory, // "*": "ask" + skill/reference/tmp allowlist
    }),
    user,
  ),
  description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
  prompt: PROMPT_EXPLORE, // from ./prompt/explore.txt, replaces provider prompt entirely
  options: {},
  mode: "subagent",
  native: true,
},
```

Docs summary (`Use explore`): `Mode: subagent`, fast read-only, cannot modify files. Use to find files by patterns, search keywords, answer codebase questions.

Zod `Info` schema fields (code source):
```ts
{
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().optional(),
  hidden: z.boolean().optional(),
  topP: z.number().optional(),
  temperature: z.number().optional(),
  color: z.string().optional(),
  permission: PermissionNext.Ruleset,
  model: z.object({ modelID: z.string(), providerID: z.string() }).optional(),
  variant: z.string().optional(),
  prompt: z.string().optional(),
  options: z.record(z.string(), z.any()),
  steps: z.number().int().positive().optional(),
}
```

### Exact `explore` system prompt (`prompt/explore.txt`)

```
You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash for file operations like copying, moving, or listing directory contents
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Do not create any files, or run bash commands that modify the user's system state in any way

Complete the user's search request efficiently and report your findings clearly.
```

Note: if agent defines `prompt`, it replaces provider prompt (`anthropic.txt` / `beast.txt` / `gemini.txt` / `codex_header.txt` / `qwen.txt` in `packages/opencode/src/session/prompt/`).

## 3. Custom agent file format

Two ways (docs `Configure` section):

### 3a. JSON in `opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "build": {
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "{file:./prompts/build.txt}",
      "permission": { "edit": "allow", "bash": "allow" }
    },
    "plan": {
      "mode": "primary",
      "model": "anthropic/claude-haiku-4-20250514",
      "permission": { "edit": "deny", "bash": "deny" }
    },
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a code reviewer. Focus on security, performance, and maintainability.",
      "permission": { "edit": "deny" }
    }
  }
}
```

`prompt: "{file:./prompts/...}"` is relative to config file location (global or project).

### 3b. Markdown with frontmatter

Filename becomes agent name: `review.md` → `review`. Nested path becomes ID: `.opencode/agents/team/reviewer.md` → `team/reviewer` (v2 docs).

`~/.config/opencode/agents/review.md`:
```md
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
permission:
  edit: deny
  bash: deny
---
You are in code review mode. Focus on:
- Code quality and best practices
- Potential bugs and edge cases
- Performance implications
- Security considerations

Provide constructive feedback without making direct changes.
```

Markdown body = system prompt. Frontmatter = same fields as JSON `agent.<name>` entry.

### Frontmatter / JSON option reference

| Field | Required? | Example | Notes |
|---|---|---|---|
| `description` | Yes (docs: required) | `Reviews code...` | Used by LLM to auto-delegate; keep specific + `when to use`. |
| `mode` | No, default `all` | `primary` / `subagent` / `all` | `primary`=Tab-switchable, `subagent`=@mentionable + Task tool. |
| `model` | No | `anthropic/claude-sonnet-4-20250514`, `opencode/gpt-5.1-codex` | Format `provider/model-id`. If omitted: primary uses global model, subagent inherits caller model. |
| `prompt` | No | `{file:./prompts/code-review.txt}` or inline string | Markdown body is prompt for `.md` agents. |
| `permission` | No | `edit: deny`, `bash: {"*": ask, "git log*": allow}` | `ask`/`allow`/`deny` per key; `read,edit,glob,grep,list,bash,task,external_directory,lsp,skill` accept glob→action map, rest shorthand only. Last matching rule wins. `tools: {write:false}` is deprecated alias. |
| `permission.task` | No | `task: { "*": deny, "orchestrator-*": allow }` | Controls which subagents this agent can invoke via Task tool; denied = hidden from Task description. User `@mention` still works. |
| `temperature` | No | `0.1` | 0.0–1.0; 0.0–0.2 analysis, 0.3–0.5 balanced, 0.6–1.0 brainstorm. Default model-specific (often 0, Qwen 0.55). |
| `top_p` (`topP`) | No | `0.9` | Alternative randomness control. JSON key is `top_p`. |
| `steps` | No | `5` | Max agentic iterations; then forced summary. Legacy `maxSteps` deprecated. |
| `disable` | No | `true` | Removes built-in or custom agent. |
| `hidden` | No | `true` | Subagents only; hides from `@` autocomplete but still callable via Task. |
| `color` | No | `#ff6b6b` / `accent` | Hex or theme color: `primary,secondary,accent,success,warning,error,info`. |
| `variant` | No | — | Provider variant passthrough. |
| Extra keys | — | `reasoningEffort: high` | Passed through to provider as model options. Run `opencode models` to list models. |

Permission pattern example (fine-grained bash):
```md
---
description: Code review without edits
mode: subagent
permission:
  edit: deny
  bash:
    "*": ask
    "git diff": allow
    "git log*": allow
    "grep *": allow
  webfetch: deny
---
Only analyze code and suggest changes.
```

Create wizard:
```
opencode agent create
```
1. global vs project, 2. description, 3. generates prompt+ID, 4. permission picker (unselected=deny), 5. writes markdown file.

## 4. Where agents live

Canonical (current docs `Markdown` section):
- Global: `~/.config/opencode/agents/`
- Per-project: `.opencode/agents/` (discovers `.opencode` dirs from cwd up to project root)

Plugin context:
- JS/TS plugin code lives in `.opencode/plugins/` (project) / `~/.config/opencode/plugins/` (global), or npm packages via `"plugin": [...]` in `opencode.json` (cached in `~/.cache/opencode/node_modules/`, Bun-installed). See https://opencode.ai/docs/plugins/
- Markdown agents shipped inside a plugin package / research-portal pattern live in `agent/*.md` (singular) at plugin root, per task premise + gist (`User-defined agents can also come from .opencode/agent/*.md`) and v2 discovery (`path below agents/ becomes agent ID`). Current docs use plural `agents/` — treat `agent/*.md` as plugin-bundled equivalent of `.opencode/agents/*.md`; filename/path → agent ID.
- Custom tools (often paired with agents) are scanned from `.opencode/tool/` + plugin `tool` exports; agents reference them via `permission` wildcard e.g. `mymcp_*: deny`.

## 5. How to delegate to explore vs custom agents

- Primary switch: `Tab` / `switch_agent` keybind (build ↔ plan).
- Manual subagent: `@explore ...`, `@general ...`, `@<custom-name> ...` e.g. `@general help me search for this function`. `@` autocomplete respects `hidden:true` (hidden still Task-callable).
- Auto-delegate: primary picks subagent from `description`. Make explore-style descriptions task-specific: include triggers + thoroughness hint (`quick` / `medium` / `very thorough` for explore).
- Programmatic (agent-to-agent): Task tool → child session with restricted permissions (no todo, no recursive task unless `permission.task` allows). Gate with:
```json
{
  "agent": {
    "orchestrator": {
      "mode": "primary",
      "permission": { "task": { "*": "deny", "orchestrator-*": "allow", "code-reviewer": "ask" } }
    }
  }
}
```
- Navigate child sessions: `session_child_first` (Leader+Down) → parent→first child; `session_child_cycle` (Right) / `reverse` (Left); `session_parent` (Up) back to parent.
- Override example — lock down explore further or swap model:
```json
{
  "agent": {
    "explore": {
      "model": "anthropic/claude-haiku-4-20250514",
      "permission": { "bash": "deny", "webfetch": "deny" }
    }
  }
}
```

## 6. Copy-paste examples (docs)

`~/.config/opencode/agents/docs-writer.md`:
```md
---
description: Writes and maintains project documentation
mode: subagent
permission:
  bash: deny
---
You are a technical writer. Create clear, comprehensive documentation.
Focus on:
- Clear explanations
- Proper structure
- Code examples
- User-friendly language
```

`~/.config/opencode/agents/security-auditor.md`:
```md
---
description: Performs security audits and identifies vulnerabilities
mode: subagent
permission:
  edit: deny
---
You are a security expert. Focus on identifying potential security issues.
Look for:
- Input validation vulnerabilities
- Authentication and authorization flaws
- Data exposure risks
- Dependency vulnerabilities
- Configuration security issues
```
