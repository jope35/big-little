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

export const BigLittlePlugin: Plugin = async () => {
  return {};
};

export default { id: "big-little", server: BigLittlePlugin } satisfies PluginModule;
