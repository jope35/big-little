# Fusion for big-little — Design

Date: 2026-10-04
Status: draft for review, not approved for planning
Repo: big-little, OpenCode v2 plugin (`@opencode/plugin` 2.0.16)

## Intent

Add the Devin Fusion pattern to this repo by extending big-little, not by replacing it.
One session pairs a frontier lead with a cheap sidekick. The user talks to the lead only.
The lead plans and reviews. The sidekick does bounded mechanical work through a brief
(goal plus limits plus success check) and returns results only.

Agreed scope from review: extend big-little, add `leadModel` plus `sidekickModel` plus
`effort`, add one generic sidekick agent, keep `bulk-reader` and `code-writer` untouched,
threshold guard emits brief text, `/fusion` shows plus sets pairing, minimal effort mapping,
two-tier prompt tuning, no stats in v1, no fast mode in v1.

## Constraints

- OpenCode v2 plugin API only. Entrypoint stays `Plugin.define({ id: "big-little", setup(ctx) })`.
- Transforms stay synchronous, cheap, replayable. Option and model data resolves before callbacks.
- `session context` hooks expose model as readonly, so no per-dispatch model swap in v1.
- `tool execute.before` can only mutate input or throw. Routing is advisory brief text.
- `switchModel` affects later turns only.
- No new dependencies unless the spec names them. None named.
- Keep `bulk-reader` and `code-writer` ids, descriptions, permissions, behavior unchanged.

## Success criteria

- Fresh reader can configure lead plus sidekick plus effort from copy-pasted snippets.
- Large full-file read over threshold is blocked with brief text naming the generic sidekick.
- Narrow `offset/limit` reads and small files pass.
- Generic sidekick runs read plus search plus edit tasks without shell or network or subagents.
- `/fusion` reports current pairing and accepts a new pairing for later turns.
- `npm run build` plus `npm test` green. Fixture proof passes normal plus sandbox.

## Architecture

Setup reads options plus env, resolves threshold plus models plus effort, then registers
three things: agent transform (pins generic sidekick model plus system plus permissions),
tool guard (threshold plus brief text for `read` and `shell`), command plus context hook
(`/fusion` show plus set, minimal effort mapping).

The lead is the caller session model unless `leadModel` is set. When `leadModel` is set,
setup registers it as the model default and `/fusion` applies it with `switchModel` for later
turns. The sidekick fleet is
`bulk-reader` plus `code-writer` (unchanged) plus one new generic `sidekick` agent pinned
to `sidekickModel` when set, inheriting caller model when unset.

## Components

- Options: `leadModel`, `sidekickModel`, `effort`, existing `minLines`, existing
  `bulkReaderModel`, `codeWriterModel`. Env fallback per existing precedent. No `fastMode`.
- Generic sidekick agent: `mode subagent`, system prompt for bounded execution from briefs,
  deny-by-default permissions with read plus glob plus grep plus edit allow, shell plus
  webfetch plus websearch plus subagent deny. Exact resource list fixed during implementation
  from live `explore` pattern.
- Brief guard: reuse `countLines`, `extractBashTargets`, `resolveInDir`, session-dir lookup.
  Over threshold and without `offset/limit`, throw brief text with goal slot, file scope,
  limits, success check, sidekick name. Piped shell passes. Fail open except deliberate blocks.
- Command `/fusion`: shows current pairing plus effort, accepts lead plus sidekick plus effort
  args, validates through `Model.Ref.parse`, calls `switchModel` for later turns.
- Context hook: maps `effort` to `reasoningEffort` only for providers that accept it,
  ignores elsewhere. No other option changes in v1.
- Two-tier tuning: weak sidekick tier gets prescriptive briefs and no pushback. Strong sidekick
  tier gets loose briefs and may challenge the plan. Exploration needed for planning stays on
  the lead for the weak tier.

## Data flow

Lead attempts `read` or `shell`. Guard resolves path against session dir and counts lines.
Under threshold it passes. Over threshold without bounds it throws brief text. The lead
reissues the unit as a subagent call to the generic sidekick with the brief filled in.
The sidekick explores, edits through `edit`, returns result text only. The lead reviews,
re-reads narrow sections with `offset/limit`, and owns the final change.

## Error handling

- Guard throws only `Error("File is ... delegate ...")` style blocks. All other errors fail open.
- Relative paths resolve against `ctx.session.get` directory cache. Lookup failure falls back
  to raw path behavior, never blocks.
- Unknown tools, piped shell, non-string commands pass.
- Bad model refs in options or `/fusion` args are rejected with a plain message naming the
  expected `provider/model` form. Current session model is left unchanged on rejection.
- `switchModel` failure leaves pairing unchanged and reports the error text.

## Testing

- Unit: threshold precedence, line counting, bash target extraction, read plus shell guard
  decisions, brief text contents, model ref parsing, effort mapping, `/fusion` arg parsing.
- Wiring: setup against stub ctx captures agent transform plus tool hook plus command.
  Assert generic sidekick registered with expected model plus permissions, old agents untouched.
- Fixture: packed-tarball install in scratch dir, `minLines: 10`, full read blocked with brief
  text, narrow read passes, small cat passes, big cat blocked, `@sidekick` delegate runs,
  `/fusion` show plus set changes later turns.
- TUI smoke in scratch dir only: `@sidekick` autocomplete, one delegated summary, one edit.

## Non-goals for v1

No session stats view. No automatic classifier. No compaction-time switching. No cloud VM loop.
No sandbox parity work. No billing or ACU metering. No `fastMode`. No changes to `bulk-reader`
or `code-writer` prompts or permissions. No new dependencies.

## Open items before planning

Effort key per provider needs a live check because options start empty per call and overlays
apply after protocol lowering. Sidekick permission resource strings need a lock against live
`explore` output. `/fusion` arg grammar needs one final example agreed during spec review.
