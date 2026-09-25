#!/usr/bin/env bash
# Load proof for big-little (OpenCode V2). No model calls.
# Usage: scripts/verify-fixture.sh           (host run against the background server)
#        SANDBOX=1 scripts/verify-fixture.sh (Docker clean room: no global config at all)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$(mktemp -d /tmp/biglittle-fixture.XXXXXX)"
trap 'rm -rf "$FIX"' EXIT

npm --prefix "$ROOT" run build

# Fixture project: big file, small file, plugin via local path with low threshold.
# V2 config form: "plugins" array with { package, options } (plan section 2.4).
mkdir -p "$FIX"
seq 1 400 > "$FIX/big.txt"
seq 1 3 > "$FIX/small.txt"
cat > "$FIX/opencode.json" <<EOF
{ "\$schema": "https://opencode.ai/config.json", "plugins": [{ "package": "$ROOT", "options": { "minLines": 10 } }] }
EOF

# Input-shape lock (verified against live V2 traffic, plan gotcha 4):
#   read  -> { path, offset?, limit? }   (NOT filePath; migration doc example is wrong)
#   shell -> { command }                 (as assumed)
# src/handleV2ToolBefore maps read->input.path and shell->input.command.
# Relative paths resolve against the calling session's directory (cached
# ctx.session.get lookup, fail open). See test "resolves relative paths
# against cwd" plus the live-session proof in the release notes.

if [ "${SANDBOX:-0}" = "1" ]; then
  # ---- Docker clean room: pristine HOME, so every bulk-reader/code-writer
  # ---- attribute must come from this plugin. Strict asserts enabled.
  if ! command -v docker >/dev/null; then
    echo "SANDBOX=1 requires docker" >&2
    exit 1
  fi
  CTX="$(mktemp -d /tmp/biglittle-docker.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$FIX' '$CTX'" EXIT
  cp "$(command -v opencode)" "$CTX/opencode"
  cp -r "$ROOT" "$CTX/repo"
  rm -rf "$CTX/repo/.git" "$CTX/repo/node_modules/.cache"
  cat > "$CTX/Dockerfile" <<'EOF'
FROM node:22-bookworm-slim
COPY opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode
COPY repo /repo
EOF
  docker build -q -t biglittle-check "$CTX" >/dev/null
  docker run --rm --network none biglittle-check bash -c '
    set -e
    mkdir -p /fixt && seq 1 400 > /fixt/big.txt && seq 1 3 > /fixt/small.txt
    printf "%s" "{ \"\$schema\": \"https://opencode.ai/config.json\", \"plugins\": [{ \"package\": \"/repo\", \"options\": { \"minLines\": 10 } }] }" > /fixt/opencode.json
    opencode service start >/dev/null 2>&1
    sleep 5
    opencode api session.create -d "{\"location\":{\"directory\":\"/fixt\"}}" > /dev/null
    for i in $(seq 1 30); do
      if opencode api agent.list --param "location[directory]=/fixt" > /agents.json 2>&1 \
        && node --input-type=module -e "
          import fs from \"node:fs\";
          const d = JSON.parse(fs.readFileSync(\"/agents.json\", \"utf8\")).data;
          if (!d.some((a) => a.id === \"bulk-reader\")) process.exit(1);
        " 2>/dev/null; then
        break
      fi
      if [ \"$i\" = \"30\" ]; then echo \"timed out waiting for bulk-reader\" >&2; exit 1; fi
      sleep 5
    done
    node --input-type=module -e "
import fs from \"node:fs\";
import { execSync } from \"node:child_process\";
const check = (await import(\"/repo/scripts/verify-lib.mjs\")).checkAgents;
const r = JSON.parse(fs.readFileSync(\"/agents.json\", \"utf8\"));
check(r.data, { strict: true });
console.log(\"PASS: clean-room agents match the V2 spec exactly\");
"
  '
  echo "fixture proof passed (sandbox)"
  exit 0
fi

# ---- Host run: background server boots the fixture location on demand.
# Global file-based agents may override scalar fields (system/temperature),
# so this mode asserts the plugin-owned contribution: presence, mode, and the
# exact permission rules. Full scalar proof lives in the sandbox run above.
# NOTE: `debug agents` / bare `agent.list` do NOT load project plugins; only a
# location boot (e.g. session.create with an explicit location) does. No model
# calls are made: the session is created and left idle.
opencode api session.create -d "{\"location\":{\"directory\":\"$FIX\"}}" > /dev/null
# The agent registry settles asynchronously after boot: poll until the
# plugin-upserted agents appear (or time out).
for i in $(seq 1 30); do
  if opencode api agent.list --param "location[directory]=$FIX" > "$FIX/agents.json" 2> "$FIX/err.log" \
    && node --input-type=module -e "
      import fs from 'node:fs';
      const d = JSON.parse(fs.readFileSync('$FIX/agents.json', 'utf8')).data;
      if (!d.some((a) => a.id === 'bulk-reader')) process.exit(1);
    " 2>/dev/null; then
    break
  fi
  if [ "$i" = "30" ]; then
    echo "timed out waiting for bulk-reader to appear" >&2
    exit 1
  fi
  sleep 5
done
node --input-type=module -e "
import fs from 'node:fs';
import { checkAgents } from '$ROOT/scripts/verify-lib.mjs';
const r = JSON.parse(fs.readFileSync('$FIX/agents.json', 'utf8'));
checkAgents(r.data, { strict: false });
console.log('PASS: agents injected with expected permission shape');
"

echo "fixture proof passed"
