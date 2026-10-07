# Devin Fusion UX Findings (docs research)

Sources:
- https://docs.devin.ai/desktop/fusion
- https://docs.devin.ai/cli/fusion
- Web search: "Devin Fusion mode docs CLI desktop" (supplemental: devin.ai/cli landing, cognition.com/blog/local-fusion, cognition.com/blog/devin-fusion, docs.devin.ai/cli/essential-commands, docs.devin.ai/desktop/devin-local)

Date: 2026-10-04

## 1. What Fusion is (user-visible concept)

- Fusion is NOT an agent mode (Normal / Plan / Ask) and NOT a permission mode (Normal / Accept Edits / Smart / Bypass / Autonomous).
- It is a **model family / pairing**: a frontier **Lead** + cost-efficient **Sidekick** working together in one session.
  - Lead: planning, design decisions, investigations, correctness-critical work, review.
  - Sidekick: executes lead's plan — writes code, runs builds/tests, verifies changes.
- User interacts with a single Devin; pairing happens behind the scenes.
- Value prop (both docs pages verbatim): "frontier intelligence at a lower cost" / "frontier intelligence, for cheaper" because routine work runs on cheaper sidekick.
- Recommended pairing: **Fable 5.1 (lead) + SWE-2 (sidekick)**. Docs say "Fusion's instructions are tuned for how each pair works together."

## 2. How to enable / trigger Fusion

### Desktop (Devin Desktop, Devin Local session only)
- Open model selector in a Devin Local session:
  - from the composer, OR
  - by running `/model`
- Pick **Fusion** family, then configure pairing (see §4).
- `fusion` as direct arg (e.g. `/model fusion`) opens the model picker (does not skip picker).
- Can switch away from Fusion to a specific model at any time from same selector.
- Explicit non-availability: `/fusion` shortcut is a Devin CLI command and **isn't available in Devin Desktop**.
- Implied prerequisite: must be using **Devin Local** agent harness (shared with CLI), not Cascade. Cascade has its own Code/Plan/Ask modes.

### CLI (Devin CLI)
- Run `/fusion` during a session → opens Fusion model picker, choose lead / effort / sidekick.
- Alternative: `/model fusion` → also opens model picker.
- Can switch away at any time with `/model` (to a specific model).
- Single-turn `devin -p` mode not documented as supporting Fusion picker (picker is REPL/session interaction).

## 3. Commands

| Command | Where | Effect |
|---|---|---|
| `/fusion` | CLI only | Open Fusion model picker (lead, effort, sidekick) |
| `/model` | CLI + Desktop (Devin Local) | Open model selector; select Fusion family or switch away to specific model |
| `/model fusion` | CLI + Desktop | Opens Fusion/model picker (not a direct one-shot select) |
| `/session-stats` (alias `/stats`) | CLI (documented on Fusion pages) | Show token usage, cost by model, estimated Fusion savings when pricing data available |
| `/fast` | CLI (general commands ref) | Switch to SWE-1.6 Fast — separate from Fusion Fast Mode, not documented as Fusion command |
| `/mode`, `/normal`, `/accept-edits`, `/smart`, `/plan`, `/ask`, `/bypass` | CLI / Devin Local | Orthogonal agent/permission modes; usable alongside Fusion |

No Fusion-specific CLI flags (e.g. `devin --fusion`) documented on Fusion pages.

## 4. Config options / model selection

In model picker, select **Fusion** family, then configure:
- **Lead**: which frontier model drives session.
- **Effort**: how much compute lead spends reasoning before responding.
- **Sidekick**: which cost-efficient model executes work. All leads show a recommended sidekick.
- **Fast Mode**: swaps in faster variants of same models where available — same intelligence, higher speed, at higher cost.
- Both rates visible in model picker; billing is per-model rate (see §6).

No config-file keys (e.g. settings.json) documented on Fusion pages for default pairing.

## 5. Model selection details

- Fusion isn't a single model — family of lead+sidekick pairings.
- Only named models in docs: Fable 5.1 + SWE-2 (recommended). Other leads/sidekicks exist in picker but not enumerated on Fusion pages.
- Broader CLI model universe (from devin.ai/cli search result, not Fusion pages): Claude Fable 5.1 / Opus 5 / Sonnet 5, GPT-6 Astra / GPT-5.6 Sol and Luna, Gemini 3.7, Cognition SWE-2 / Fusion / Adaptive, open weights. Fusion picker draws from these.

##  пол6. Pricing / availability (UX-relevant gating)

- Availability: paid plans only; CLI **3000.10.20+**, Desktop **3.10.0+**. Not in free/trial.
- Not available for legacy / credit-based plans, incl. enterprise on legacy credits billing (Warning callout on both pages).
- Pricing:
  - Self-serve: lead + sidekick tokens draw down quota at each model's own per-token rate.
  - Enterprise (Cognition Platform – ACUs): metered in ACUs, scaled by tokens × respective rates.

## 7. Fallback behavior

- **No automatic fallback documented** on either Fusion page.
- No mention of: lead taking over on sidekick failure, sidekick upgrade/downgrade mid-session (cloud-blog describes dynamic routing/compaction-time switching, but Local Fusion docs do not promise this UX), offline fallback, or model-unavailable fallback.
- Only documented escape hatch is manual: switch away via `/model` (CLI) or model selector (Desktop).
- Tip says compare total cost + quality across similar tasks via `/session-stats` rather than choosing by token price alone — implies user-driven iteration, not auto-fallback.

## 8. Differences: Desktop vs CLI

| Aspect | Desktop | CLI |
|---|---|---|
| Open picker | Composer model selector or `/model` → pick Fusion | `/fusion` OR `/model` → picker; `/model fusion` also opens picker |
| `/fusion` command | Explicitly NOT available | Primary entry point |
| Usage stats | Not mentioned on Desktop Fusion page | `/session-stats` (`/stats`) with per-model cost + estimated savings |
| Agent harness | Devin Local (shared with CLI); Fusion only in Devin Local, not Cascade | Native |
| Pairing model (Lead/Sidekick/Effort/Fast Mode) | Identical | Identical |
| Availability version | 3.10.0+ | 3000.10.20+ |
| Pricing/plan gating | Identical | Identical |
| Page copy | Otherwise verbatim identical to CLI page except Selecting Fusion section + stats tip context | — |

Orthogonal modes note:
- CLI / Devin Local agent modes: Normal, Plan, Ask (`/plan`, `/ask`); permission modes: Normal, Accept Edits, Smart, Bypass, Autonomous (sandbox-only). Fusion composes with these.
- Desktop Cascade modes (Code/Plan/Ask, `Cmd+.`/`Ctrl+.`) are separate; Fusion docs only cover Devin Local sessions.
