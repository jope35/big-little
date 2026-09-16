# Portal plugin for OpenCode

Port of Spotify's Portal pattern ("cut token usage by 90"):
I/O-heavy grunt work (bulk reads, boilerplate generation) goes to cheap
subagents; the frontier model keeps reasoning and edits.

## Layout (self-contained)

```
portal/
  plugin.ts            # runtime: injects both agents + routing hooks (only file OpenCode needs)
  agent/
    bulk-reader.md     # source of truth for the bulk-reader prompt (also Claude-compatible)
    code-writer.md     # source of truth for the code-writer prompt (also Claude-compatible)
  hooks/
    check-file-size    # bash hook, Claude-compat (logic also lives in plugin.ts)
    check-bash-read    # bash hook, Claude-compat (logic also lives in plugin.ts)
```

## Install (OpenCode)

```bash
mkdir -p .opencode/plugins
cp research_portal_opencode/portal/plugin.ts .opencode/plugins/portal.ts
```

Agents are injected via the `config` hook — no extra agent files needed at runtime.
`agent/*.md` and `hooks/*` ship for transparency and Claude-Code reuse.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `SHUNT_MIN_LINES` (or `PORTAL_MIN_LINES`) | `350` | Full-file reads above this are redirected to `bulk-reader` |
| `PORTAL_BULK_READER_MODEL` | inherit caller | Cheap worker, e.g. `anthropic/claude-haiku-4-20250514` |
| `PORTAL_CODE_WRITER_MODEL` | inherit caller | Cheap worker for generation |

Set a cheap model to realise the savings; without it the subagents inherit the
caller's model (works, but no cost reduction).

## Usage

- `@bulk-reader <question over large/multiple files> -- thoroughness: quick | medium | very thorough`
- `@code-writer <spec> --reference <file> --target <file>`
- Large `read` / `cat` calls are blocked with a message pointing at `bulk-reader`;
  targeted reads (`offset`/`limit`, `grep`, pipes) always pass through.

## Limits (from the article)

- No delegated editing: worker summaries lack reliable line numbers — re-read the
  target section with `offset`/`limit` before editing.
- No delegated reasoning: debugging, architecture, safety-critical code stay on
  the main model.
