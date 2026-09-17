#!/usr/bin/env bash
# Token-benchmark setup for big-little. No model calls.
# Usage: scripts/benchmark-setup.sh
# Creates /tmp/bl-bench-a (no plugin, baseline),
#         /tmp/bl-bench-b (plugin, delegated reads),
#         /tmp/bl-bench-c (plugin, delegated write),
# each with a frozen copy of benchmark/corpus. Asserts the line-count
# gates, then prints next steps. See benchmark/README.md for procedure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="$ROOT/benchmark/corpus"
MIN_LINES=100

if [ ! -d "$CORPUS/qa" ] || [ ! -d "$CORPUS/gen" ]; then
  echo "error: corpus missing under $CORPUS" >&2
  exit 1
fi

# Gate: QA files must trip the hook, reference must stay readable.
MIN_LINES="$MIN_LINES" CORPUS="$CORPUS" node -e '
const fs = require("fs");
const min = Number(process.env.MIN_LINES);
const over = ["qa/orders.ts", "qa/inventory.ts", "qa/pricing.ts"];
for (const rel of over) {
  const n = fs.readFileSync(`${process.env.CORPUS}/${rel}`, "utf8").split("\n").length;
  if (n <= min) throw new Error(`${rel} is ${n} lines, must exceed ${min}`);
  console.log(`gate OK: ${rel} ${n} lines > ${min}`);
}
const ref = "gen/reference.user.dto.ts";
const n = fs.readFileSync(`${process.env.CORPUS}/${ref}`, "utf8").split("\n").length;
if (n > min) throw new Error(`${ref} is ${n} lines, must stay <= ${min}`);
console.log(`gate OK: ${ref} ${n} lines <= ${min}`);
'

npm --prefix "$ROOT" run build >/dev/null

for run in a b c; do
  dir="/tmp/bl-bench-$run"
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -r "$CORPUS" "$dir/corpus"
  if [ "$run" = "a" ]; then
    printf '{}\n' > "$dir/opencode.json"
  else
    printf '{ "plugin": [["%s", { "minLines": %s }]] }\n' "$ROOT" "$MIN_LINES" > "$dir/opencode.json"
  fi
  echo "run dir ready: $dir"
done

echo "---"
echo "A: cd /tmp/bl-bench-a && opencode   (no plugin, direct reads)"
echo "B: cd /tmp/bl-bench-b && opencode   (@bulk-reader + offset/limit)"
echo "C: cd /tmp/bl-bench-c && opencode   (@code-writer, reference read only)"
echo "Prompts: benchmark/README.md. Record counts in benchmark/results.md."
