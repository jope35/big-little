# Research Report: Port Spotify Portal (90% token saving) to OpenCode

## Question

How to port https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90
to OpenCode as a self-contained plugin with two agents (bulk-reader linked to explore, code-writer from scratch)
plus routing hooks inspired by
https://github.com/sorantis/portal-ai-plugins/blob/add-shunt-claude/plugins/shunt/hooks/check-file-size ?

## Answer (TL;DR)

Built at `research_portal_opencode/portal/`:

- `plugin.ts` — self-contained runtime: `config` hook injects `bulk-reader` + `code-writer`;
  `tool.execute.before` hook enforces routing (large `read` / `cat|head|tail|less|more` redirected).
- `agent/bulk-reader.md` — your pasted prompt, linked to OpenCode's `explore` shape
  (same deny-all + read-tools permission set, `mode: subagent`, thoroughness levels, Portal bullet-only output contract).
- `agent/code-writer.md` — your pasted prompt, built from scratch (needs `edit` to write files, everything else denied).
- `hooks/check-file-size`, `hooks/check-bash-read` — bash originals (Claude-compat, verified); same logic lives natively in `plugin.ts`.
- `README.md` — install + env config + usage + limits.

Install: `cp research_portal_opencode/portal/plugin.ts .opencode/plugins/portal.ts`.
Optional env: `SHUNT_MIN_LINES` (default 350), `PORTAL_BULK_READER_MODEL` / `PORTAL_CODE_WRITER_MODEL`
(e.g. `anthropic/claude-haiku-4-20250514` — unset means inherit caller model: works, but no cost saving).

## What each subtopic found

### 1. Spotify Portal pattern (findings_spotify-portal-pattern.md)

- AiKA Modes = declarative agents (prompt + model + temp + tools) on ephemeral runtime, name-resolved
  (own > team > public), 30s cap, 10–30s delegation latency.
- `bulk-reader` (multi-file Q&A → bullets, temp 0.2, e.g. Gemini Flash) vs `code-writer`
  (spec + required reference → code to disk, "output only code").
- Saving: worker absorbs corpus + generation; only the summary returns → ~90% mean bulk-read saving (Java monorepo).
- Routing (shunt plugin): PreToolUse hooks (350-line default via `SHUNT_MIN_LINES`, targeted reads pass)
  + bash wrappers + Skills; "plugin decides *when*, mode decides *how*".
- Limits: no delegated editing (bad line numbers) or reasoning (missed thread-safety bug); threshold avoids
  overhead on small files.

### 2. OpenCode agents config (findings_opencode-agents-config.md)

- Built-in `explore`: `mode: subagent`, deny-all except `grep/glob/list/bash/webfetch/websearch/codesearch/read`;
  prompt = `packages/opencode/src/agent/prompt/explore.txt`; description carries the `quick/medium/very thorough` hint.
- Custom agents: JSON `agent.{name}` in `opencode.json` or Markdown frontmatter (`description` required;
  `mode/model/prompt/permission/temperature/top_p/steps/disable/hidden/color`); filename → agent name.
- Locations: `~/.config/opencode/agents/`, `.opencode/agents/`; plugin-bundled `agent/*.md` (glob accepts
  `agent/` and `agents/`); plugins inject agents via the `config` hook (verified via mintlify_context).
- Delegate via `@mention`, auto-delegate via `description`, agent-to-agent via Task tool gated by `permission.task`.

### 3. OpenCode plugins + hooks (findings_opencode-plugins-hooks.md)

- OpenCode has **no `plugin.json`** — a plugin is a JS/TS module in `.opencode/plugins/` (or npm via `opencode.json`).
  `plugin.json` + `hooks/*.sh` is Claude-Code convention (what `shunt/` uses).
- Routing point is `tool.execute.before(input{tool,sessionID,callID}, output{args})`: mutate `output.args`
  to rewrite, `throw` to block; `event` hook is observer-only.
- `check-file-size` contract: stdin `{tool_input:{file_path,offset,limit}}` → stdout
  `{"decision":"allow"}` / `{"decision":"block","reason":...}`; threshold `SHUNT_MIN_LINES` default 350.
- Verified port: native TS in `plugin.ts` + thin shell-adapter alternative documented in findings.

## Key design decisions (and why)

1. **Single-file runtime (`plugin.ts` injects agents via `config`)** — discovery of `agent/*.md` inside a plugin
   dir is version-dependent; `config`-hook injection is documented and always works, so the plugin is truly
   self-contained. The `.md` files remain the source of truth / Claude-compat copies.
2. **`bulk-reader` mirrors `explore` permissions** — your "linked to explore" requirement; plus `task: deny`
   (no recursive delegation) and the Portal bullets-only output contract on top of your prompt.
3. **`code-writer` gets `edit: allow`, `bash/web*: deny`** — it must write files to disk (the disk-write bypass
   is half the saving); cheap models should not run shell commands or browse.
4. **No `model` hardcoded** — OpenCode users span providers; env vars (`PORTAL_*_MODEL`) opt into the cheap
   worker. Temp fixed at 0.2 per the article.
5. **Blocking (throw) rather than silent rewrite** — matches shunt semantics and the official OpenCode
   `EnvProtection` example; the error message is the router (names `bulk-reader`, offers `offset/limit` fallback).
6. **Keep `SHUNT_MIN_LINES`** — compat with the article's tuning; `PORTAL_MIN_LINES` accepted as alias.

## Verification done

- `bash -n` on both hooks + 5 functional cases (small→allow, big→block, targeted→allow, `cat` big→block,
  piped→allow) — all correct.
- 22 structural checks on `plugin.ts` + frontmatter of both agent files — all pass
  (hooks, permissions, prompts in sync, balanced syntax).
- Not verified: live load inside OpenCode (`bun` unavailable here) — first-run check is
  `cp portal/plugin.ts .opencode/plugins/portal.ts`, open OpenCode, `@bulk-reader` / `@code-writer` autocomplete.

## Gaps / limitations

- Hook input/output JSON has no published schema; signatures reconstructed from official examples +
  `oh-my-opencode` + community manuals — re-check against installed `@opencode-ai/plugin` types on upgrade.
- Savings depend on setting a cheap `PORTAL_*_MODEL`; without it you get discipline but not cost reduction.
- Same Portal caveats apply: re-read with `offset`/`limit` before editing; keep debugging/architecture on the main model.

## Sources

- https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90
- https://opencode.ai/docs/agents/ and https://opencode.ai/docs/plugins/
- https://github.com/sorantis/portal-ai-plugins/blob/add-shunt-claude/plugins/shunt/hooks/check-file-size
- Full per-subtopic sources in `findings_*.md`.
