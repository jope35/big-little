import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "node:fs"

// Self-contained Portal port (Spotify "cut token usage by 90" pattern).
// - `config` hook injects the two agents, so this single file is enough at runtime.
// - `tool.execute.before` hook enforces routing (ported from shunt's check-file-size / check-bash-read).
// - `agent/*.md` files in this folder are the source of truth for the prompts below
//   (kept in sync manually) and double as Claude-Code-compatible agent definitions.

const DEFAULT_MIN_LINES = 350

function threshold(): number {
  const raw = process.env.SHUNT_MIN_LINES ?? process.env.PORTAL_MIN_LINES ?? String(DEFAULT_MIN_LINES)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_LINES
}

function countLines(path: string): number | null {
  try {
    return readFileSync(path, "utf8").split("\n").length
  } catch {
    return null // missing/unreadable file -> allow, let the tool report it
  }
}

const BULK_READER_DESCRIPTION =
  "Fast read-only codebase explorer for large files and multi-file questions. Use when you need to read files over ~350 lines, answer questions spanning multiple files, or map code patterns without loading full files into context. Specify thoroughness: quick, medium, or very thorough."

const BULK_READER_PROMPT = `You are a codebase exploration specialist focused on fast, accurate, read-only navigation.

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

Do not edit code and do not reason about bugs or architecture beyond what was asked — report facts so the caller can act.`

const CODE_WRITER_DESCRIPTION =
  "Generates production-ready boilerplate from a spec plus a required reference file. Use when you need tests, config scaffolding, type stubs, DTOs, or other predictable code that must match existing patterns. Always provide a spec, a reference file, and a target path."

const CODE_WRITER_PROMPT = `You are a code generation specialist. Generate production-ready files based on provided specs and reference files.

Guidelines:
- Match existing patterns, conventions, typing, naming, and style exactly.
- Resolve ambiguities using established reference context.
- Output strictly raw code. Exclude markdown code blocks, explanations, or introductory text unless requested.
- Produce fully implemented code without placeholders or stubs.

Operating contract:
- A reference file is required. Without a file to match patterns against, you would generate context-free code that fits nothing in the project — always read the reference before writing.
- Write the finished file with the edit tool; the caller never needs to see the generated code in chat.
- If the spec is ambiguous, make reasonable choices that match the reference code's patterns.
- Do not refactor beyond the spec and do not reason about bugs or architecture — generate what was specified.`

// Matches `cat|head|tail|less|more <file>` (single-shot reads, not pipes).
const BASH_READ_RE = /\b(cat|head|tail|less|more)\s+([^|;&\n]+)/g

function bashReadTargets(command: string): string[] {
  if (command.includes("|")) return [] // piped commands are treated as targeted reads
  const targets: string[] = []
  for (const match of command.matchAll(BASH_READ_RE)) {
    const rest = (match[2] ?? "").trim()
    for (const token of rest.split(/\s+/)) {
      if (!token || token.startsWith("-")) continue
      if (token.startsWith("$") || token.startsWith("<") || token.includes("*")) continue
      targets.push(token.replace(/^['"]|['"]$/g, ""))
      break // only the first file operand per command
    }
  }
  return targets
}

export const PortalPlugin: Plugin = async () => {
  const minLines = threshold()
  // Cheap worker models (Spotify used gemini-2.5-flash @ temp 0.2).
  // Unset => subagent inherits the caller's model (no savings, but works everywhere).
  // e.g. PORTAL_BULK_READER_MODEL="anthropic/claude-haiku-4-20250514"
  const bulkModel = process.env.PORTAL_BULK_READER_MODEL || undefined
  const codeModel = process.env.PORTAL_CODE_WRITER_MODEL || undefined

  return {
    // Inject both agents so the plugin is self-contained (no extra agent files needed at runtime).
    config: async (cfg: any) => {
      cfg.agent = {
        ...(cfg.agent ?? {}),
        "bulk-reader": {
          description: BULK_READER_DESCRIPTION,
          mode: "subagent",
          temperature: 0.2,
          ...(bulkModel ? { model: bulkModel } : {}),
          // Linked to the built-in explore subagent: same read-only shape (deny-all + read tools).
          permission: {
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            read: "allow",
            edit: "deny",
            task: "deny",
          },
          prompt: BULK_READER_PROMPT,
        },
        "code-writer": {
          description: CODE_WRITER_DESCRIPTION,
          mode: "subagent",
          temperature: 0.2,
          ...(codeModel ? { model: codeModel } : {}),
          // Built from scratch: needs edit to write files to disk, nothing else.
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
      }
    },

    // Routing enforcement (ported from shunt's check-file-size + check-bash-read).
    "tool.execute.before": async (input: any, output: any) => {
      const tool = String(input?.tool ?? "").toLowerCase()
      const args = (output?.args ?? {}) as Record<string, any>

      // 1. Full-file reads on large files -> delegate to bulk-reader.
      if (tool === "read") {
        const { filePath, offset, limit } = args as {
          filePath?: string
          offset?: number
          limit?: number
        }
        if (offset != null || limit != null) return // targeted read, allow
        if (!filePath) return
        const lines = countLines(filePath)
        if (lines == null || lines <= minLines) return
        throw new Error(
          `File is ${lines} lines (threshold: ${minLines}). ` +
            `Delegate to the bulk-reader subagent instead of reading it directly. ` +
            `If you need exact content for editing, re-read with offset/limit for just the section you need.`,
        )
      }

      // 2. cat/head/tail/less/more on large files -> same treatment.
      if (tool === "bash" && typeof args.command === "string") {
        for (const target of bashReadTargets(args.command)) {
          const lines = countLines(target)
          if (lines != null && lines > minLines) {
            throw new Error(
              `File is ${lines} lines (threshold: ${minLines}). ` +
                `Do not cat large files into context — delegate to the bulk-reader subagent instead, ` +
                `or use a targeted read (grep, offset/limit) for the section you need.`,
            )
          }
        }
      }
    },
  }
}
