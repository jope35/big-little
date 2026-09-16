# Spotify Portal Pattern for Saving Claude Code Tokens — Findings

Source: Dimitri Mazmanov, "Portal by Spotify cut my Claude Code token usage by 90%", Spotify Engineering, Sep 3, 2026.
URL: https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90

Related docs:
- AiKA Modes: https://backstage.spotify.com/docs/portal/core-features-and-plugins/aika/modes
- Plugin repo/marketplace: https://github.com/spotify/portal-ai-plugins (`shunt@portal`, `portal@portal`; article also links `sorantis/portal-ai-plugins` branch `add-shunt-claude/plugins/shunt`)
- Cost context: https://www.gartner.com/en/newsroom/press-releases/2026-06-24-gartner-predicts-ai-coding-costs-will-surpass-average-developer-salary-by-2028-as-token-consumption-surges

## TL;DR
Route I/O-heavy grunt work (bulk reads, boilerplate generation) to a cheap worker model via declarative Portal "AiKA Modes", keep the frontier model (Claude) for reasoning/edits. Enforce routing with a Claude Code plugin ("shunt") using PreToolUse hooks + wrapper scripts + Skills. Reported mean bulk-read saving ~90% on a Java monorepo (4 scenarios).

## 1. Portal architecture (AiKA Modes)
- A "mode" = declarative agent on an ephemeral runtime ("think AWS Lambda, but for agents").
- Definition: instructions (system prompt), model choice, params (e.g. temperature), MCP tools, visibility (public = company-shared / private), tags.
- Portal handles runtime: no infra, no API keys, no long-running servers.
- Callable from Portal CLI or API; goes through Portal CLI actions registry so the shunt plugin works against any Portal instance with AiKA plugin enabled.
- Modes addressed by name, resolved case-insensitively: own mode > team's > public. Forking a public mode auto-takes precedence, no config change.
- Invocations are ephemeral one-shots; nothing stored server-side. Follow-up re-sends files (free where it matters — corpus goes to worker, never enters Claude context).
- Single invocation capped at 30s; large generations must be split.
- Latency per delegation typically 10–30s (Claude Code → Portal backend → worker → back).

> "You define the instructions, pick a model, set parameters like temperature, and attach MCP tools. Portal handles the rest."

## 2. bulk-reader vs code-writer split
| | bulk-reader | code-writer |
|---|---|---|
| Purpose | Answer a question over multiple large files without loading them into Claude context | Generate predictable output (tests, config scaffolding, type stubs) from spec + reference |
| Worker model (example) | gemini-2.5-flash (any configured model allowed) | gemini-2.5-flash |
| Temperature | 0.2 | 0.2 |
| Key prompt constraint | "Output structured bullets only. No greetings, no prose, no preambles. Lead every bullet with exact name, type, or line number." | "Output only the code — no explanations, no markdown fences unless asked. Match existing patterns/conventions/naming/style exactly." |
| I/O | Files wrapped in XML tags + question → concise summary back to Claude | Spec + required reference file → code, optionally written straight to disk; Claude never sees generated code |
| Why it saves | Claude consumes short summary instead of full files | Claude avoids both reading reference files AND emitting expensive output tokens |

Reference is required for code-write: "without a file to match patterns against, the worker would generate context-free code that fits nothing in your project."
Fence-stripping matters: scripts strip markdown fences; "output only the code" avoids prose Claude must parse.

### Mode prompts (abridged from article)
- bulk-reader: "You are a precise code analyst. Read the provided files and answer the question concisely. Output structured bullets only. No greetings, no prose, no preambles. Lead every bullet with the exact name, type, or line number. Use nested bullets for details. Skip anything the caller did not ask for." (visibility: public, tags: coding, delegation)
- code-writer: "You generate code files based on a spec and reference files. Match the existing patterns, conventions, naming, and style exactly. Output only the code — no explanations, no markdown fences unless asked. If the spec is ambiguous, make reasonable choices that match the reference code's patterns."

## 3. Token saving mechanism
- Core insight: "Most of what an AI coding agent does for me isn't thinking. It's I/O." → frontier model is "wildly overqualified" for reads/boilerplate.
- Delegated corpus + generation happen on the cheap worker; only the distilled answer (bullets) returns to Claude context, or nothing (code-write to disk).
- Benchmark: Java monorepo, 4 scenarios, direct-read tokens vs summary tokens → mean ~90% bulk-read savings. Code-write savings harder to quantify (saves reference-read input + output tokens + disk-write bypass).
- Evolution: v1 was advisory routing rules in CLAUDE.md (ignorable, per-project copy). v2 = enforced plugin, shared company-wide.

Cost motivation quoted: "By 2028, AI coding costs are expected to blow past the average developer's salary. A quarter of engineering leaders already burn $200–$500 per developer per month on tokens."

## 4. Routing logic (shunt plugin — 3 layers)
1. **Hooks (enforcement):** two PreToolUse hooks fire before every tool call.
   - `check-file-size` on Read: blocks reads over threshold (default 350 lines, via `SHUNT_MIN_LINES`, e.g. set to 500 in `.claude/settings.json`), redirects to /bulk-reader skill. Targeted reads (offset/limit) pass through.
   - `check-bash-read` catches `cat|head|tail|less|more` on large files; piped commands (`cat file | grep`) pass (treated as targeted).
2. **Scripts (transport):** `bulk-read` / `code-write` bash wrappers with named args; build request, invoke Portal CLI actions, unwrap errors, report token usage to stderr.
   - `bulk-read --question "..." --paths src/Service.java src/Handler.java`
   - `code-write --spec "Write tests for UserService" --reference tests/OrderTest.java --target tests/UserTest.java`
3. **Skills (UX):** markdown skill files with description + invocation examples; hook block message points Claude at the skill. Graceful degradation: hook blocks even if skill unread.
- Decoupling: "The plugin decides *when* to delegate. The mode decides *how* to respond. Swap Gemini Flash for a cheaper model, change the system prompt, add MCP tools — the plugin doesn't change."

## 5. What doesn't work / limits
- No delegated editing: worker summaries lack reliable line numbers → Claude must re-read target section (offset/limit allowed) to edit.
- No delegated reasoning: worker missed a subtle thread-safety bug Claude caught; routing excludes debugging, architecture, safety-critical code.
- Latency/overhead: threshold exists because below it delegation costs more than it saves.
- Composability noted as next step: doc-writer, reviewer, translator, i18n modes; all reusable/shareable across projects and CLI-capable tools.

## 6. Reproduce / try
1. `claude plugin marketplace add spotify/portal-ai-plugins; claude plugin install portal@portal; claude plugin install shunt@portal`
2. `/portal:setup` to auth Portal CLI against your Portal instance (https://backstage.spotify.com/contact-us/try-portal)
3. Ask a multi-file question; public bulk-reader/code-writer modes need no setup. Fork to customize.

## Relevance to OpenCode research
- Directly maps to subagent/slash-command routing: cheap-model reader/writer subagents + hook- or threshold-enforced delegation instead of advisory AGENTS.md rules.
- Open questions for our repo: optimal line threshold, summary schema to preserve editability (line numbers), when code-write-to-disk bypass is safe.
