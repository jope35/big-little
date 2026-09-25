import { Plugin, Model } from "@opencode/plugin";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

export interface BigLittleOptions {
  minLines?: unknown;
  bulkReaderModel?: string;
  codeWriterModel?: string;
}

export const DEFAULT_MIN_LINES = 350;

function parsePositiveInt(raw: unknown): number | null {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw.trim(), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
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
  "Fast read-only codebase explorer for large files and multi-file questions. Use when you need to read files over the minLines threshold (default 350 lines, user-overridable via plugin option or env), answer questions spanning multiple files, or map code patterns without loading full files into context. Specify thoroughness: quick, medium, or very thorough.";

export const BULK_READER_PROMPT = `You are a codebase exploration specialist focused on fast, accurate, read-only navigation.

Core Tool Strategy:
- Glob: Locate files by pattern or extension.
- Grep: Search code text and regex patterns across targeted directories.
- Read: Inspect specific file contents once narrowed down.
- Shell: Use exclusively for read-only commands (e.g. 'ls', directory listing, 'git log').

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
  return { ...(bulkReaderModel && { bulkReaderModel }), ...(codeWriterModel && { codeWriterModel }) };
}

export interface V2Permission {
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
}

export interface V2AgentInfo {
  description: string;
  mode: "subagent";
  system: string;
  permissions: V2Permission[];
  model?: { providerID: string; id: string; variant?: string };
}

function parseModelRef(ref: string): { providerID: string; id: string; variant?: string } {
  return Model.Ref.parse(ref) as unknown as { providerID: string; id: string; variant?: string };
}

export const BULK_READER_PERMISSIONS: V2Permission[] = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "webfetch", resource: "*", effect: "allow" },
  { action: "websearch", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
  { action: "shell", resource: "*", effect: "deny" },
  { action: "shell", resource: "ls *", effect: "allow" },
  { action: "shell", resource: "git log *", effect: "allow" },
  { action: "shell", resource: "git status *", effect: "allow" },
  { action: "shell", resource: "git diff *", effect: "allow" },
  { action: "shell", resource: "grep *", effect: "allow" },
  { action: "shell", resource: "rg *", effect: "allow" },
  { action: "shell", resource: "wc *", effect: "allow" },
];

export const CODE_WRITER_PERMISSIONS: V2Permission[] = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "shell", resource: "*", effect: "deny" },
  { action: "webfetch", resource: "*", effect: "deny" },
  { action: "websearch", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
];

export function buildBulkReaderInfo(options: BigLittleOptions = {}): V2AgentInfo {
  const { bulkReaderModel } = resolveModels(options);
  return {
    description: BULK_READER_DESCRIPTION,
    mode: "subagent",
    system: BULK_READER_PROMPT,
    ...(bulkReaderModel ? { model: parseModelRef(bulkReaderModel) } : {}),
    permissions: BULK_READER_PERMISSIONS.map((p) => ({ ...p })),
  };
}

export function buildCodeWriterInfo(options: BigLittleOptions = {}): V2AgentInfo {
  const { codeWriterModel } = resolveModels(options);
  return {
    description: CODE_WRITER_DESCRIPTION,
    mode: "subagent",
    system: CODE_WRITER_PROMPT,
    ...(codeWriterModel ? { model: parseModelRef(codeWriterModel) } : {}),
    permissions: CODE_WRITER_PERMISSIONS.map((p) => ({ ...p })),
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
  args: { filePath?: string; path?: string; offset?: number | null; limit?: number | null },
  minLines: number,
  cwd?: string
): string | null {
  if (args.offset != null || args.limit != null) return null;
  // V2 read tool sends `path`; accept legacy `filePath` defensively.
  const raw = args.path ?? args.filePath;
  if (!raw) return null;
  const lines = countLines(resolveInDir(raw, cwd));
  if (lines === null || lines <= minLines) return null;
  return buildReadBlockMessage(lines, minLines);
}

export function checkBashRequest(
  command: unknown,
  minLines: number,
  cwd?: string
): string | null {
  if (typeof command !== "string") return null;
  for (const target of extractBashTargets(command)) {
    const lines = countLines(resolveInDir(target, cwd));
    if (lines !== null && lines > minLines) {
      return buildBashBlockMessage(lines, minLines);
    }
  }
  return null;
}

// Resolve tool paths against the session dir; without cwd, raw passthrough fails open in countLines.
export function resolveInDir(p: string, cwd?: string): string {
  if (!cwd || isAbsolute(p)) return p;
  return resolvePath(cwd, p);
}

export function handleV2ToolBefore(
  tool: unknown,
  input: Record<string, any> | null | undefined,
  minLines: number,
  cwd?: string
): void {
  const name = String(tool ?? "").toLowerCase();
  const args = (input ?? {}) as Record<string, any>;
  if (name === "read") {
    const msg = checkReadRequest(
      { path: args.path, filePath: args.filePath, offset: args.offset, limit: args.limit },
      minLines,
      cwd
    );
    if (msg !== null) throw new Error(msg);
    return;
  }
  // V2 contract is `shell`. Match `bash` defensively (one line) for old callers.
  if (name === "shell" || name === "bash") {
    const msg = checkBashRequest(args.command, minLines, cwd);
    if (msg !== null) throw new Error(msg);
    return;
  }
}

export default Plugin.define({
  id: "big-little",
  async setup(ctx) {
    const opts = (ctx.options ?? {}) as BigLittleOptions;
    const minLines = resolveThreshold(opts);
    const bulkInfo = buildBulkReaderInfo(opts);
    const codeInfo = buildCodeWriterInfo(opts);
    await ctx.agent.transform((editor) => {
      editor.update("bulk-reader", (agent) => {
        Object.assign(agent, bulkInfo);
      });
      editor.update("code-writer", (agent) => {
        Object.assign(agent, codeInfo);
      });
    });
    // Session directory cache: models usually send relative paths, which only
    // resolve correctly against the calling session's directory (not the
    // server process cwd). One cached lookup per session; fail open to raw
    // paths when the lookup fails.
    const dirCache = new Map<string, string>();
    const sessionDir = async (sessionID: unknown): Promise<string | undefined> => {
      if (typeof sessionID !== "string" || !sessionID) return undefined;
      const hit = dirCache.get(sessionID);
      if (hit) return hit;
      try {
        const info = (await ctx.session.get({ sessionID } as any)) as any;
        const dir = info?.location?.directory ?? info?.directory;
        if (typeof dir === "string" && dir) {
          dirCache.set(sessionID, dir);
          return dir;
        }
      } catch {
        // Fail open: fall through to raw-path behavior below.
      }
      return undefined;
    };
    await ctx.tool.hook("execute.before", async (event) => {
      try {
        const e = event as unknown as {
          tool?: unknown;
          input?: Record<string, any>;
          sessionID?: unknown;
        };
        const cwd = await sessionDir(e.sessionID);
        handleV2ToolBefore(e.tool, e.input, minLines, cwd);
      } catch (err) {
        // Fail open on unexpected errors; only deliberate block throws leave.
        if (err instanceof Error && err.message.startsWith("File is ")) throw err;
      }
    });
  },
});
