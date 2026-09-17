# big-little

OpenCode plugin. Big model keeps orchestration. Little worker subagents do bulk reads and boilerplate.

Requires OpenCode 1.x (1.18 or later). OpenCode 2 beta is not supported.

## Install

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["big-little"]
}
```

Restart OpenCode after install. Restart picks up config changes.

## Verify your install

Run `opencode debug config`. Check that `bulk-reader` and `code-writer` appear under `agent`. Run `opencode debug agent bulk-reader` to see the expanded permission rules. Both commands use no model.

## Configuration

Every option is optional. Env vars apply only when the matching option is absent.

With options (tuple form):

```json
{
  "plugin": [
    ["big-little", { "minLines": 500 }]
  ]
}
```

| Option | Env fallback | Default | Rule |
| --- | --- | --- | --- |
| `minLines` | `BIGLITTLE_MIN_LINES`, then deprecated `SHUNT_MIN_LINES` | `350` | Positive integer. Zero, negative, or garbage means `350`. |
| `bulkReaderModel` | `BIGLITTLE_BULK_READER_MODEL` | unset (inherit caller model) | Example `anthropic/claude-haiku-4-20250514`. |
| `codeWriterModel` | `BIGLITTLE_CODE_WRITER_MODEL` | unset (inherit caller model) | Same semantics. |

`PORTAL_MIN_LINES` and `PORTAL_*_MODEL` are not honored.

## What it does

- Registers `bulk-reader` (read-only explorer) and `code-writer` (boilerplate writer via `edit`).
- Blocks full-file `read` over threshold. Message names `bulk-reader` and offers `offset/limit` retry.
- Blocks `cat|head|tail|less|more` over threshold. Piped commands pass.
- Targeted reads (`offset` or `limit` set) always pass.

## Limits

- Set a cheap worker model or you get discipline without cost saving.
- Re-read target sections with `offset/limit` before edit. Worker line numbers can drift.
- Keep debugging and architecture on the main model.
- `code-writer` cannot run bash or network. Caller runs tests and lint.
