# Benchmark results

Copy this file to `results.md` and fill in each field.

- Date:
- Corpus VERSION: 1. Commit SHA:
- Threshold: `minLines: 100` for runs B and C. Run A loads no plugin.
- Primary model for all runs:
- `bulkReaderModel` for runs B and C:
- `codeWriterModel` for runs B and C:
- OpenCode version from `opencode --version`:
- `@opencode/plugin` version:

## Token counts

Read input and output tokens from the session token display.

| Run | Task | Input | Output | Notes |
| --- | --- | --- | --- | --- |
| A | Questions with direct reads | | | |
| A | Generation with direct reads | | | |
| B | Questions with `@bulk-reader` and `offset/limit` | | | |
| C | Generation with `@code-writer` | | | |

## Totals

- Run A total (in and out):
- Runs B and C total (in and out):
- Change in percent (in and out):
- Result: keep the numbers even if delegation costs more, and note the cause.
