# Research Plan: Port Spotify Portal (90% token saving) to OpenCode Plugin

## Main research question
How to port the Spotify Portal pattern from https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90 to OpenCode as a self-contained plugin with two agents (bulk-reader linked to explore, code-writer from scratch) plus hooks to route requests?

User-provided agent prompts (pasted-context-1.txt):
- Bulk-reader: codebase exploration specialist, Glob/Grep/Read/Bash read-only, top-down, return absolute paths, concise summaries, strict read-only.
- Code-writer: code generation specialist, match patterns/conventions, raw code output, fully implemented, no placeholders.

## Subtopics (3, non-overlapping)

### 1. spotify-portal-pattern
- Fetch and summarize the Spotify blog post: Portal architecture, bulk reader + code writer split, token savings mechanism, prompt details, routing logic.
- Expected: key facts, quotes, routing/hook logic that must be replicated.

### 2. opencode-agents-config
- OpenCode agents docs: https://opencode.ai/docs/agents/#use-explore , default explore subagent definition, custom agent config format, frontmatter fields, tools, modes, how to override/link bulk-reader to explore.
- Use mintlify_context + webfetch for primary sources.
- Expected: exact config schema for `agent/*.md` inside plugin, explore agent defaults.

### 3. opencode-plugins-hooks
- OpenCode plugins docs: https://opencode.ai/docs/plugins/ , plugin directory layout, self-contained plugin with agents, hooks system (event types, hook input/output JSON), example: https://github.com/sorantis/portal-ai-plugins/blob/add-shunt-claude/plugins/shunt/hooks/check-file-size
- Expected: plugin.json schema, hooks example code, how to route to specific agents.

## Synthesis plan
- Read all 3 findings_*.md files.
- Synthesize into plugin design: `plugins/portal/` layout with `plugin.json`, `agents/bulk-reader.md`, `agents/code-writer.md`, `hooks/route-to-agents.*`.
- Then implement plugin files locally, verified against docs.
