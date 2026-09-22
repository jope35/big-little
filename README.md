<h1 style="font-family: Baskerville, serif; font-size: 3em;">Big-Little</h1>

[![npm version](https://img.shields.io/npm/v/big-little.svg)](https://www.npmjs.com/package/big-little)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org)
[![OpenCode](https://img.shields.io/badge/OpenCode-1.18%2B-blue.svg)](https://opencode.ai)

OpenCode plugin. Big model keeps orchestration. Little worker subagents do bulk reads and boilerplate.

<p align="center">
  <img src="artifacts/img/still-video-square-90.png" alt="big-little still" width="50%">
</p>

## Contents

- [Contents](#contents)
- [Install](#install)
- [Verify your install](#verify-your-install)
- [Configuration](#configuration)
- [Examples](#examples)
- [How it works](#how-it-works)
  - [bulk-reader flow](#bulk-reader-flow)
  - [code-writer flow](#code-writer-flow)
- [What it does](#what-it-does)
- [Limits](#limits)

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
| `bulkReaderModel` | `BIGLITTLE_BULK_READER_MODEL` | unset (inherit caller model) | Example `opencode/nemotron-3.5-lightning-free`. |
| `codeWriterModel` | `BIGLITTLE_CODE_WRITER_MODEL` | unset (inherit caller model) | Same semantics. |

Model picks below are [OpenCode Zen](https://opencode.ai/docs/zen/#pricing) free-tier models (`opencode/nemotron-3.5-lightning-free` reads, `opencode/mimo-v2.5-free` writes), so most users already have them. Free-tier availability is limited-time — run `/models` in the TUI to confirm before pinning.

## Examples

1. Defaults only (350-line threshold, workers inherit your model):

```json
{
  "plugin": ["big-little"]
}
```

1. Custom threshold only:

```json
{
  "plugin": [["big-little", { "minLines": 500 }]]
}
```

1. Cheap bulk-reader only (the main cost saver; threshold stays 350):

```json
{
  "plugin": [["big-little", { "bulkReaderModel": "opencode/nemotron-3.5-lightning-free" }]]
}
```

1. Code-writer model only:

```json
{
  "plugin": [["big-little", { "codeWriterModel": "opencode/mimo-v2.5-free" }]]
}
```

1. Both workers pinned, default threshold:

```json
{
  "plugin": [
    [
      "big-little",
      {
        "bulkReaderModel": "opencode/nemotron-3.5-lightning-free",
        "codeWriterModel": "opencode/mimo-v2.5-free"
      }
    ]
  ]
}
```

1. Everything set:

```json
{
  "plugin": [
    [
      "big-little",
      {
        "minLines": 500,
        "bulkReaderModel": "opencode/nemotron-3.5-lightning-free",
        "codeWriterModel": "opencode/mimo-v2.5-free"
      }
    ]
  ]
}
```

Any option left out falls back to its env var, then the default (see table above). Env-only setup with zero options:

```bash
export BIGLITTLE_MIN_LINES=500
export BIGLITTLE_BULK_READER_MODEL=opencode/nemotron-3.5-lightning-free
export BIGLITTLE_CODE_WRITER_MODEL=opencode/mimo-v2.5-free
```

## How it works

### bulk-reader flow

```mermaid
flowchart LR
    primary["Primary agent"]
    hook["tool.execute.before hook"]
    br["bulk-reader subagent"]
    code[("Codebase")]

    primary -- "full read, file over minLines" --> hook
    hook -- "block: delegate to bulk-reader" --> br
    br -- "grep / glob / narrow reads" --> code
    br -- "summary + paths + line numbers" --> primary
    primary -- "offset/limit re-read of edit target" --> code
    primary -- "edit" --> code
```

Targeted reads (`offset`/`limit` set) and piped shell commands skip the hook entirely.

### code-writer flow

```mermaid
flowchart LR
    primary2["Primary agent"]
    cw["code-writer subagent"]
    code2[("Codebase")]

    primary2 -- "spec + reference file + target path" --> cw
    cw -- "read reference, match patterns" --> code2
    cw -- "write finished file via edit" --> code2
    primary2 -- "run tests + lint (writer has no bash)" --> code2
```

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
