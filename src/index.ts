import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";

export interface BigLittleOptions {
  minLines?: unknown;
  bulkReaderModel?: string;
  codeWriterModel?: string;
}

export const DEFAULT_MIN_LINES = 350;

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (Number.isFinite(raw) && raw > 0 && Number.isInteger(raw)) return raw;
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    return null;
  }
  if (typeof raw === "string") {
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
    return null;
  }
  return null;
}

export function resolveThreshold(options: BigLittleOptions = {}): number {
  const fromOption = parsePositiveInt(options.minLines);
  if (fromOption !== null) return fromOption;
  const fromEnv = parsePositiveInt(process.env.BIGLITTLE_MIN_LINES);
  if (fromEnv !== null) return fromEnv;
  const fromDeprecated = parsePositiveInt(process.env.SHUNT_MIN_LINES);
  if (fromDeprecated !== null) return fromDeprecated;
  return DEFAULT_MIN_LINES;
}

export function countLines(filePath: string): number | null {
  try {
    return readFileSync(filePath, "utf8").split("\n").length;
  } catch {
    return null;
  }
}

const BASH_READ_RE = /\b(cat|head|tail|less|more)\s+([^|;&\n]+)/g;
const BASH_TOKEN_RE = /'[^']*'|"[^"]*"|\S+/g;

export function extractBashTargets(command: string): string[] {
  if (command.includes("|")) return [];
  const targets: string[] = [];
  for (const match of command.matchAll(BASH_READ_RE)) {
    const rest = (match[2] ?? "").trim();
    for (const token of rest.match(BASH_TOKEN_RE) ?? []) {
      if (!token || token.startsWith("-")) continue;
      if (/^[+-]?\d+$/.test(token)) continue; // flag value, e.g. `20` in `head -n 20 file`
      if (token.startsWith("$") || token.includes("*")) continue;
      if (token.startsWith("<")) break; // stdin redirect (`cat < file`): no file operand
      targets.push(token.replace(/^['"]|['"]$/g, ""));
      break;
    }
  }
  return targets;
}

export const BigLittlePlugin: Plugin = async () => {
  return {};
};

export default { id: "big-little", server: BigLittlePlugin } satisfies PluginModule;
