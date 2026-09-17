#!/usr/bin/env bash
# Load proof for big-little. No model calls.
# Usage: scripts/verify-fixture.sh           (normal run, global config merges)
#        SANDBOX=1 scripts/verify-fixture.sh (full env isolation, for CI)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$(mktemp -d /tmp/biglittle-fixture.XXXXXX)"
XDGD="$(mktemp -d /tmp/biglittle-xdg.XXXXXX)"
trap 'rm -rf "$FIX" "$XDGD"' EXIT

npm --prefix "$ROOT" run build

# Fixture project: big file, small file, plugin via local path with low threshold.
mkdir -p "$FIX"
seq 1 400 > "$FIX/big.txt"
seq 1 3 > "$FIX/small.txt"
cat > "$FIX/opencode.json" <<EOF
{ "plugin": [["$ROOT", { "minLines": 10 }]] }
EOF

if [ "${SANDBOX:-0}" = "1" ]; then
  ISOLATION=(env -u OPENCODE_CONFIG_CONTENT "XDG_CONFIG_HOME=$XDGD")
else
  ISOLATION=(env)
fi

cd "$FIX"

# 1. Plugin loads, options tuple arrives, both agents land in resolved config.
"${ISOLATION[@]}" opencode debug config > resolved.json 2> err.log
node -e '
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("resolved.json", "utf8"));
const br = cfg.agent?.["bulk-reader"];
const cw = cfg.agent?.["code-writer"];
if (!br) throw new Error("bulk-reader missing from resolved config");
if (!cw) throw new Error("code-writer missing from resolved config");
if (br.mode !== "subagent") throw new Error("bulk-reader is not subagent");
if (br.permission?.bash?.["*"] !== "deny") throw new Error("bash default is not deny");
if (br.permission?.bash?.["ls*"] !== "allow") throw new Error("ls* is not allowed");
if (cw.permission?.bash !== "deny") throw new Error("code-writer bash is not deny");
if (cw.permission?.edit !== "allow") throw new Error("code-writer edit is not allow");
console.log("PASS: agents injected with expected permission shape");
'

# 2. Expanded agent rules match the spec allowlist.
"${ISOLATION[@]}" opencode debug agent bulk-reader > agent-br.json 2>> err.log
node -e '
const fs = require("fs");
const agent = JSON.parse(fs.readFileSync("agent-br.json", "utf8"));
const rules = agent.permission ?? [];
const has = (permission, pattern, action) =>
  rules.some((r) => r.permission === permission && r.pattern === pattern && r.action === action);
if (!has("bash", "ls*", "allow")) throw new Error("expanded rules lack ls* allow");
if (!has("bash", "git log*", "allow")) throw new Error("expanded rules lack git log* allow");
if (!has("bash", "*", "deny")) throw new Error("expanded rules lack bash default deny");
if (!has("edit", "*", "deny")) throw new Error("expanded rules lack edit deny");
if (!has("task", "*", "deny")) throw new Error("expanded rules lack task deny");
console.log("PASS: bulk-reader expanded rules match spec allowlist");
'

# 3. Sandbox mode: global config must not leak in.
if [ "${SANDBOX:-0}" = "1" ]; then
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync("resolved.json", "utf8"));
    const plugins = JSON.stringify(cfg.plugin ?? []);
    if (plugins.includes("openchamber")) throw new Error("global plugin leaked into sandbox");
    if (cfg.mcp && Object.keys(cfg.mcp).length > 0) throw new Error("global MCP leaked into sandbox");
    console.log("PASS: sandbox isolation holds");
  '
fi

echo "fixture proof passed"
