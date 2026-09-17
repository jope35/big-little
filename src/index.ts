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

export const BULK_READER_DESCRIPTION =
  "Fast read-only codebase explorer for large files and multi-file questions. Use when you need to read files over ~350 lines, answer questions spanning multiple files, or map code patterns without loading full files into context. Specify thoroughness: quick, medium, or very thorough.";

export const BULK_READER_PROMPT = `You are a codebase exploration specialist focused on fast, accurate, read-only navigation.

Core Tool Strategy:
- Glob: Locate files by pattern or extension.
- Grep: Search code text and regex patterns across targeted directories.
- Read: Inspect specific file contents once narrowed down.
- Bash: Use exclusively for read-only commands (e.g. 'ls', directory listing, 'git log').

Guidelines:
- Follow a top-down workflow: filter paths with Glob/Grep before reading full files.
- Adapt your search depth based on the thoroughness level specified by the caller: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.
- Always return file paths as absolute paths.
- Summarize key findings concisely using file paths, relevant line numbers, and short snippets. Do not output full files unless requested.
- Avoid using emojis.
- STRICT READ-ONLY MODE: Never run commands that create, modify, move, or delete files or alter system state.

Output contract (token discipline):
- Output structured bullets only. No greetings, no prose, no preambles.
- Lead every bullet with the exact name, type, or line number.
- Use nested bullets for details. Skip anything the caller did not ask for.

Do not edit code and do not reason about bugs or architecture beyond what was asked — report facts so the caller can act.`;

export const CODE_WRITER_DESCRIPTION =
  "Generates production-ready boilerplate from a spec plus a required reference file. Use when you need tests, config scaffolding, type stubs, DTOs, or other predictable code that must match existing patterns. Always provide a spec, a reference file, and a target path.";

export const CODE_WRITER_PROMPT = `You are a code generation specialist. Generate production-ready files based on provided specs and reference files.

Guidelines:
- Match existing patterns, conventions, typing, naming, and style exactly.
- Resolve ambiguities using established reference context.
- Output strictly raw code. Exclude markdown code blocks, explanations, or introductory text unless requested.
- Produce fully implemented code without placeholders or stubs.

Operating contract:
- A reference file is required. Without a file to match patterns against, you would generate context-free code that fits nothing in the project — always read the reference before writing.
- Write the finished file with the edit tool; the caller never needs to see the generated code in chat.
- If the spec is ambiguous, make reasonable choices that match the reference code's patterns.
- Do not refactor beyond the spec and do not reason about bugs or architecture — generate what was specified.`;

export function resolveModels(options: BigLittleOptions = {}): {
  bulkReaderModel?: string;
  codeWriterModel?: string;
} {
  const bulkReaderModel =
    options.bulkReaderModel ?? process.env.BIGLITTLE_BULK_READER_MODEL ?? undefined;
  const codeWriterModel =
    options.codeWriterModel ?? process.env.BIGLITTLE_CODE_WRITER_MODEL ?? undefined;
  const out: { bulkReaderModel?: string; codeWriterModel?: string } = {};
  if (bulkReaderModel) out.bulkReaderModel = bulkReaderModel;
  if (codeWriterModel) out.codeWriterModel = codeWriterModel;
  return out;
}

export function buildAgentConfig(options: BigLittleOptions = {}): Record<string, unknown> {
  const { bulkReaderModel, codeWriterModel } = resolveModels(options);
  return {
    "bulk-reader": {
      description: BULK_READER_DESCRIPTION,
      mode: "subagent",
      temperature: 0.2,
      ...(bulkReaderModel ? { model: bulkReaderModel } : {}),
      permission: {
        "*": "deny",
        grep: "allow",
        glob: "allow",
        list: "allow",
        read: "allow",
        webfetch: "allow",
        websearch: "allow",
        edit: "deny",
        task: "deny",
        bash: {
          "*": "deny",
          "ls*": "allow",
          "git log*": "allow",
          "git status*": "allow",
          "git diff*": "allow",
          "grep*": "allow",
          "rg*": "allow",
          "wc*": "allow",
        },
      },
      prompt: BULK_READER_PROMPT,
    },
    "code-writer": {
      description: CODE_WRITER_DESCRIPTION,
      mode: "subagent",
      temperature: 0.2,
      ...(codeWriterModel ? { model: codeWriterModel } : {}),
      permission: {
        "*": "deny",
        read: "allow",
        edit: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        bash: "deny",
        webfetch: "deny",
        websearch: "deny",
        task: "deny",
      },
      prompt: CODE_WRITER_PROMPT,
    },
  };
}

export async function applyAgentConfig(cfg: any, options: BigLittleOptions = {}): Promise<void> {
  const agents = buildAgentConfig(options);
  cfg.agent = {
    ...(cfg.agent ?? {}),
    ...agents,
  };
}

export function buildReadBlockMessage(lines: number, minLines: number): string {
  return (
    `File is ${lines} lines (threshold: ${minLines}). ` +
    `Delegate to the bulk-reader subagent instead of reading it directly. ` +
    `If you need exact content for editing, re-read with offset/limit for just the section you need.`
  );
}

export function buildBashBlockMessage(lines: number, minLines: number): string {
  return (
    `File is ${lines} lines (threshold: ${minLines}). ` +
    `Do not cat large files into context — delegate to the bulk-reader subagent instead, ` +
    `or use a targeted read (grep, offset/limit) for the section you need.`
  );
}

export function checkReadRequest(
  args: { filePath?: string; offset?: number | null; limit?: number | null },
  minLines: number
): string | null {
  if (args.offset != null || args.limit != null) return null;
  if (!args.filePath) return null;
  const lines = countLines(args.filePath);
  if (lines === null || lines <= minLines) return null;
  return buildReadBlockMessage(lines, minLines);
}

export function checkBashRequest(command: unknown, minLines: number): string | null {
  if (typeof command !== "string") return null;
  for (const target of extractBashTargets(command)) {
    const lines = countLines(target);
    if (lines !== null && lines > minLines) {
      return buildBashBlockMessage(lines, minLines);
    }
  }
  return null;
}

export function handleToolBefore(
  input: { tool?: unknown },
  output: { args?: Record<string, unknown> },
  minLines: number
): void {
  const tool = String(input?.tool ?? "").toLowerCase();
  const args = (output?.args ?? {}) as Record<string, any>;
  if (tool === "read") {
    const msg = checkReadRequest(
      { filePath: args.filePath, offset: args.offset, limit: args.limit },
      minLines
    );
    if (msg !== null) throw new Error(msg);
    return;
  }
  if (tool === "bash") {
    const msg = checkBashRequest(args.command, minLines);
    if (msg !== null) throw new Error(msg);
    return;
  }
}

export const BigLittlePlugin: Plugin = async () => {
  return {};
};

export default { id: "big-little", server: BigLittlePlugin } satisfies PluginModule;
