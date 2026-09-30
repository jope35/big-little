import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveThreshold,
  countLines,
  DEFAULT_MIN_LINES,
  extractBashTargets,
  buildBulkReaderInfo,
  buildCodeWriterInfo,
  BULK_READER_PERMISSIONS,
  CODE_WRITER_PERMISSIONS,
  checkReadRequest,
  checkBashRequest,
  handleV2ToolBefore,
  resolveInDir,
} from "../src/index.ts";
import BigLittleModuleDefault from "../src/index.ts";

describe("resolveThreshold", () => {
  it("defaults to 350 when no option and no env", () => {
    delete process.env.BIGLITTLE_MIN_LINES;
    delete process.env.SHUNT_MIN_LINES;
    assert.equal(resolveThreshold({}), 350);
    assert.equal(DEFAULT_MIN_LINES, 350);
  });

  it("uses package option when valid", () => {
    assert.equal(resolveThreshold({ minLines: 100 }), 100);
  });

  it("maps zero, negative, garbage to 350", () => {
    delete process.env.BIGLITTLE_MIN_LINES;
    delete process.env.SHUNT_MIN_LINES;
    assert.equal(resolveThreshold({ minLines: 0 }), 350);
    assert.equal(resolveThreshold({ minLines: -5 }), 350);
    assert.equal(resolveThreshold({ minLines: "garbage" }), 350);
    assert.equal(resolveThreshold({ minLines: NaN }), 350);
  });

  it("uses BIGLITTLE_MIN_LINES env when option absent", () => {
    delete process.env.SHUNT_MIN_LINES;
    process.env.BIGLITTLE_MIN_LINES = "200";
    assert.equal(resolveThreshold({}), 200);
    delete process.env.BIGLITTLE_MIN_LINES;
  });

  it("honors deprecated SHUNT_MIN_LINES as fallback", () => {
    delete process.env.BIGLITTLE_MIN_LINES;
    process.env.SHUNT_MIN_LINES = "250";
    assert.equal(resolveThreshold({}), 250);
    delete process.env.SHUNT_MIN_LINES;
  });

  it("prefers option over env", () => {
    process.env.BIGLITTLE_MIN_LINES = "200";
    assert.equal(resolveThreshold({ minLines: 120 }), 120);
    delete process.env.BIGLITTLE_MIN_LINES;
  });
});

describe("countLines", () => {
  it("counts small file lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-"));
    const p = join(dir, "small.txt");
    writeFileSync(p, "a\nb\nc");
    assert.equal(countLines(p), 3);
    rmSync(dir, { recursive: true });
  });

  it("returns null for missing file", () => {
    assert.equal(countLines("/no/such/file-xyz.txt"), null);
  });
});

describe("extractBashTargets", () => {
  it("extracts single cat target", () => {
    assert.deepEqual(extractBashTargets("cat bigfile.txt"), ["bigfile.txt"]);
  });

  it("returns empty for piped commands", () => {
    assert.deepEqual(extractBashTargets("cat bigfile.txt | head -20"), []);
  });

  it("skips flags and picks file", () => {
    assert.deepEqual(extractBashTargets("head -n 20 bigfile.txt"), ["bigfile.txt"]);
  });

  it("skips vars, redirects, globs", () => {
    assert.deepEqual(extractBashTargets("cat $FILE"), []);
    assert.deepEqual(extractBashTargets("cat < bigfile.txt"), []);
    assert.deepEqual(extractBashTargets("cat *.txt"), []);
  });

  it("strips quotes", () => {
    assert.deepEqual(extractBashTargets('cat "my file.txt"'), ["my file.txt"]);
  });

  it("scans compound commands as a whole", () => {
    assert.deepEqual(extractBashTargets("echo hi; cat bigfile.txt"), ["bigfile.txt"]);
    assert.deepEqual(extractBashTargets("echo hi && head small.txt"), ["small.txt"]);
  });

  it("ignores non-read commands", () => {
    assert.deepEqual(extractBashTargets("ls -la"), []);
    assert.deepEqual(extractBashTargets("grep foo bigfile.txt"), []);
  });
});

function perm(info: any, action: string, resource: string): string | undefined {
  return info.permissions?.find((p: any) => p.action === action && p.resource === resource)
    ?.effect;
}

describe("v2 agent info", () => {
  it("bulk-reader is deny-first with read tools and narrow shell allowlist", () => {
    delete process.env.BIGLITTLE_BULK_READER_MODEL;
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
    const br: any = buildBulkReaderInfo({});
    assert.equal(br.mode, "subagent");
    assert.ok(!("temperature" in br), "temperature must be dropped in V2");
    assert.ok(!("prompt" in br), "legacy prompt key must not exist (use system)");
    assert.ok(typeof br.system === "string" && br.system.length > 0);
    assert.ok(br.system.includes("read-only"), "system must contain read-only guidance");
    assert.ok(br.system.includes("Shell"), "system must say Shell, not Bash (V2 tool name)");
    assert.ok(!br.system.includes("Bash:"), "system must not reference the old Bash tool label");
    assert.ok(br.description.includes("minLines"));
    assert.ok(br.description.includes("350"));
    // Exact permission array from the plan.
    assert.deepEqual(br.permissions, BULK_READER_PERMISSIONS);
    assert.equal(perm(br, "*", "*"), "deny");
    assert.equal(perm(br, "read", "*"), "allow");
    assert.equal(perm(br, "glob", "*"), "allow");
    assert.equal(perm(br, "grep", "*"), "allow");
    assert.equal(perm(br, "webfetch", "*"), "allow");
    assert.equal(perm(br, "websearch", "*"), "allow");
    assert.equal(perm(br, "edit", "*"), "deny");
    assert.equal(perm(br, "subagent", "*"), "deny");
    assert.equal(perm(br, "shell", "*"), "deny");
    assert.equal(perm(br, "shell", "ls *"), "allow");
    assert.equal(perm(br, "shell", "git log *"), "allow");
    assert.equal(perm(br, "shell", "git status *"), "allow");
    assert.equal(perm(br, "shell", "git diff *"), "allow");
    assert.equal(perm(br, "shell", "grep *"), "allow");
    assert.equal(perm(br, "shell", "rg *"), "allow");
    assert.equal(perm(br, "shell", "wc *"), "allow");
    // No removed actions anywhere in the permission arrays.
    const actions = new Set(br.permissions.map((p: any) => p.action));
    assert.ok(!actions.has("bash"), "old bash action must not appear (V2 is shell)");
    assert.ok(!actions.has("task"), "old task action must not appear (V2 is subagent)");
    assert.ok(!actions.has("list"), "removed V2 list tool must not appear");
    assert.ok(!("model" in br), "model key must be absent when unset");
  });

  it("code-writer can edit but has no shell or network", () => {
    delete process.env.BIGLITTLE_BULK_READER_MODEL;
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
    const cw: any = buildCodeWriterInfo({});
    assert.equal(cw.mode, "subagent");
    assert.ok(!("temperature" in cw));
    assert.ok(!("prompt" in cw));
    assert.ok(typeof cw.system === "string" && cw.system.length > 0);
    assert.deepEqual(cw.permissions, CODE_WRITER_PERMISSIONS);
    assert.equal(perm(cw, "*", "*"), "deny");
    assert.equal(perm(cw, "read", "*"), "allow");
    assert.equal(perm(cw, "edit", "*"), "allow");
    assert.equal(perm(cw, "glob", "*"), "allow");
    assert.equal(perm(cw, "grep", "*"), "allow");
    assert.equal(perm(cw, "shell", "*"), "deny");
    assert.equal(perm(cw, "webfetch", "*"), "deny");
    assert.equal(perm(cw, "websearch", "*"), "deny");
    assert.equal(perm(cw, "subagent", "*"), "deny");
    const actions = new Set(cw.permissions.map((p: any) => p.action));
    assert.ok(!actions.has("bash"), "old bash action must not appear (V2 is shell)");
    assert.ok(!actions.has("task"), "old task action must not appear (V2 is subagent)");
    assert.ok(!actions.has("list"), "removed V2 list tool must not appear");
    assert.ok(!("model" in cw), "model key must be absent when unset");
  });

  it("sets model only when provided via option or env (parsed to provider/model ref)", () => {
    delete process.env.BIGLITTLE_BULK_READER_MODEL;
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
    let br: any = buildBulkReaderInfo({
      bulkReaderModel: "anthropic/claude-haiku-4-20250514",
    });
    assert.deepEqual(br.model, {
      providerID: "anthropic",
      id: "claude-haiku-4-20250514",
    });
    let cw: any = buildCodeWriterInfo({});
    assert.ok(!("model" in cw));
    process.env.BIGLITTLE_CODE_WRITER_MODEL = "anthropic/claude-haiku-4-20250514";
    cw = buildCodeWriterInfo({});
    assert.deepEqual(cw.model, {
      providerID: "anthropic",
      id: "claude-haiku-4-20250514",
    });
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
    // Variant suffix passes through the parser.
    br = buildBulkReaderInfo({ bulkReaderModel: "anthropic/claude-sonnet-4-5#high" });
    assert.equal(br.model.providerID, "anthropic");
    assert.equal(br.model.id, "claude-sonnet-4-5");
    assert.equal(br.model.variant, "high");
  });
});

describe("routing", () => {
  it("allows small read and blocks big read", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-route-"));
    const small = join(dir, "small.txt");
    const big = join(dir, "big.txt");
    writeFileSync(small, "a\nb");
    writeFileSync(big, Array(400).fill("x").join("\n"));
    assert.equal(checkReadRequest({ path: small }, 350), null);
    const msg = checkReadRequest({ path: big }, 350);
    assert.ok(msg);
    assert.ok(msg!.includes("bulk-reader"));
    assert.ok(msg!.includes("offset/limit"));
    assert.ok(!msg!.includes("xxxxx"), "message must not include file contents");
    rmSync(dir, { recursive: true });
  });

  it("accepts legacy filePath defensively", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-compat-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("x").join("\n"));
    assert.ok(checkReadRequest({ filePath: big }, 350));
    rmSync(dir, { recursive: true });
  });

  it("allows targeted read even on big file", () => {
    assert.equal(checkReadRequest({ path: "big.txt", offset: 1, limit: 10 }, 350), null);
    assert.equal(checkReadRequest({ path: "big.txt", offset: 1 }, 350), null);
    assert.equal(checkReadRequest({ path: "big.txt", limit: 10 }, 350), null);
  });

  it("allows missing path", () => {
    assert.equal(checkReadRequest({}, 350), null);
    assert.equal(checkReadRequest({ path: "" }, 350), null);
    assert.equal(checkReadRequest({ path: "/no/such.txt" }, 350), null);
  });

  it("resolves relative paths against cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-cwd-"));
    writeFileSync(join(dir, "big.txt"), Array(400).fill("x").join("\n"));
    writeFileSync(join(dir, "small.txt"), "hi");
    // Relative path without cwd fails open (server process cwd is unrelated).
    assert.equal(checkReadRequest({ path: "bl-no-such-file-xyz.txt" }, 350), null);
    // With the session directory, the same relative path blocks.
    assert.ok(checkReadRequest({ path: "big.txt" }, 350, dir));
    assert.equal(checkReadRequest({ path: "small.txt" }, 350, dir), null);
    assert.ok(checkBashRequest("cat big.txt", 350, dir));
    assert.equal(checkBashRequest("cat small.txt", 350, dir), null);
    rmSync(dir, { recursive: true });
  });

  it("resolveInDir passes absolute through, joins relative under cwd", () => {
    assert.equal(resolveInDir("/abs/big.txt", "/sess"), "/abs/big.txt");
    assert.equal(resolveInDir("big.txt", "/sess"), join("/sess", "big.txt"));
    assert.equal(resolveInDir("big.txt"), "big.txt");
  });

  it("blocks big cat and allows piped, small, non-string", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-bash-"));
    const big = join(dir, "big.txt");
    const small = join(dir, "small.txt");
    writeFileSync(big, Array(400).fill("y").join("\n"));
    writeFileSync(small, "hi");
    const blockMsg = checkBashRequest(`cat ${big}`, 350);
    assert.ok(blockMsg);
    assert.ok(blockMsg!.includes("bulk-reader"));
    assert.equal(checkBashRequest(`cat ${small}`, 350), null);
    assert.equal(checkBashRequest(`cat ${big} | head -20`, 350), null);
    assert.equal(checkBashRequest("cat $FILE", 350), null);
    assert.equal(checkBashRequest(12345, 350), null);
    assert.equal(checkBashRequest("ls -la", 350), null);
    rmSync(dir, { recursive: true });
  });

  it("handleV2ToolBefore throws only on block and ignores other tools", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-hook-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("z").join("\n"));
    assert.throws(() => handleV2ToolBefore("READ", { path: big }, 350));
    assert.doesNotThrow(() => handleV2ToolBefore("read", { path: big, limit: 5 }, 350));
    assert.doesNotThrow(() => handleV2ToolBefore("edit", { path: big }, 350));
    assert.doesNotThrow(() => handleV2ToolBefore(undefined, {}, 350));
    // V2 contract key is `path`; legacy `filePath` still blocks (defensive).
    assert.throws(() => handleV2ToolBefore("read", { filePath: big }, 350));
    // Relative path resolves against the session directory when provided.
    assert.throws(() => handleV2ToolBefore("read", { path: "big.txt" }, 350, dir));
    rmSync(dir, { recursive: true });
  });
});

describe("v2 tool hook", () => {
  it("blocks big full read, passes targeted read", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-v2-read-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("x").join("\n"));
    assert.throws(() => handleV2ToolBefore("read", { path: big }, 350));
    assert.doesNotThrow(() =>
      handleV2ToolBefore("read", { path: big, offset: 1, limit: 5 }, 350)
    );
    rmSync(dir, { recursive: true });
  });

  it("blocks big cat via shell, passes piped/small/non-string", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-v2-shell-"));
    const big = join(dir, "big.txt");
    const small = join(dir, "small.txt");
    writeFileSync(big, Array(400).fill("y").join("\n"));
    writeFileSync(small, "hi");
    assert.throws(() => handleV2ToolBefore("shell", { command: `cat ${big}` }, 350));
    assert.equal(handleV2ToolBefore("shell", { command: `cat ${small}` }, 350), undefined);
    assert.equal(
      handleV2ToolBefore("shell", { command: `cat ${big} | head -20` }, 350),
      undefined
    );
    assert.equal(handleV2ToolBefore("shell", { command: "ls -la" }, 350), undefined);
    assert.equal(handleV2ToolBefore("shell", { command: 12345 as any }, 350), undefined);
    rmSync(dir, { recursive: true });
  });

  it("shell is the V2 contract (bash matched only defensively)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-v2-contract-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("z").join("\n"));
    // Contract: shell blocks.
    assert.throws(() => handleV2ToolBefore("shell", { command: `cat ${big}` }, 350));
    // Defensive: legacy bash name still blocks the same payload (one-line compat).
    assert.throws(() => handleV2ToolBefore("bash", { command: `cat ${big}` }, 350));
    // Unknown tools always pass.
    assert.doesNotThrow(() => handleV2ToolBefore("webfetch", { url: big }, 350));
    rmSync(dir, { recursive: true });
  });
});

describe("V2 plugin wiring", () => {
  it("default-exports id + setup (no legacy server export)", () => {
    const mod: any = BigLittleModuleDefault;
    assert.equal(mod.id, "big-little");
    assert.equal(typeof mod.setup, "function");
    assert.ok(!("server" in mod), "legacy server export must not exist");
  });

  it("setup registers agent transform + execute.before hook", async () => {
    const mod: any = BigLittleModuleDefault;
    let transformCb: any = null;
    let hookName: string | null = null;
    let hookCb: any = null;
    const ctx: any = {
      options: { minLines: 350 },
      agent: {
        transform: async (cb: any) => {
          transformCb = cb;
          return { dispose: async () => {} };
        },
      },
      tool: {
        hook: async (name: string, cb: any) => {
          hookName = name;
          hookCb = cb;
          return { dispose: async () => {} };
        },
      },
    };
    await mod.setup(ctx);
    assert.ok(transformCb, "agent.transform must be registered");
    assert.equal(hookName, "execute.before");

    // Replay the captured transform against a stub editor.
    const updates: Array<{ id: string; info: any }> = [];
    const editor: any = {
      update: (id: string, fn: (draft: any) => void) => {
        const draft: any = {};
        fn(draft);
        updates.push({ id, info: draft });
      },
    };
    transformCb(editor);
    const ids = updates.map((u) => u.id).sort();
    assert.deepEqual(ids, ["bulk-reader", "code-writer"]);
    for (const u of updates) {
      assert.equal(u.info.mode, "subagent");
      assert.ok(Array.isArray(u.info.permissions));
      assert.ok(typeof u.info.system === "string");
    }

    // Captured hook blocks a big read event (V2 input shape: { path }).
    const dir = mkdtempSync(join(tmpdir(), "bl-wire-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("w").join("\n"));
    await assert.rejects(hookCb({ tool: "read", input: { path: big } }));
    await hookCb({ tool: "read", input: { path: big, limit: 5 } });
    rmSync(dir, { recursive: true });
  });

  it("hook resolves relative paths via the session directory", async () => {
    const mod: any = BigLittleModuleDefault;
    let hookCb: any = null;
    const dir = mkdtempSync(join(tmpdir(), "bl-sessdir-"));
    writeFileSync(join(dir, "big.txt"), Array(400).fill("w").join("\n"));
    let lookups = 0;
    const ctx: any = {
      options: { minLines: 350 },
      agent: { transform: async () => ({ dispose: async () => {} }) },
      session: {
        get: async (input: any) => {
          lookups++;
          assert.equal(input.sessionID, "sess-1");
          return { location: { directory: dir } };
        },
      },
      tool: {
        hook: async (_name: string, cb: any) => {
          hookCb = cb;
          return { dispose: async () => {} };
        },
      },
    };
    await mod.setup(ctx);
    // Relative path blocks once the session directory is known ...
    await assert.rejects(hookCb({ tool: "read", sessionID: "sess-1", input: { path: "big.txt" } }));
    // ... and the lookup is cached (one call total across both invocations).
    await hookCb({ tool: "read", sessionID: "sess-1", input: { path: "big.txt", limit: 5 } });
    assert.equal(lookups, 1);
    rmSync(dir, { recursive: true });
  });

  it("hook fails open when the session lookup fails", async () => {
    const mod: any = BigLittleModuleDefault;
    let hookCb: any = null;
    const ctx: any = {
      options: { minLines: 350 },
      agent: { transform: async () => ({ dispose: async () => {} }) },
      session: {
        get: async () => {
          throw new Error("boom");
        },
      },
      tool: {
        hook: async (_name: string, cb: any) => {
          hookCb = cb;
          return { dispose: async () => {} };
        },
      },
    };
    await mod.setup(ctx);
    await hookCb({ tool: "read", sessionID: "sess-x", input: { path: "big.txt" } });
  });

  it("options come from ctx.options", async () => {
    const mod: any = BigLittleModuleDefault;
    let hookCb: any = null;
    const ctx: any = {
      options: { minLines: 10 },
      agent: { transform: async () => ({ dispose: async () => {} }) },
      tool: {
        hook: async (_name: string, cb: any) => {
          hookCb = cb;
          return { dispose: async () => {} };
        },
      },
    };
    await mod.setup(ctx);
    const dir = mkdtempSync(join(tmpdir(), "bl-opts-"));
    const medium = join(dir, "medium.txt");
    writeFileSync(medium, "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk"); // 11 lines
    await assert.rejects(hookCb({ tool: "read", input: { path: medium } }));
    rmSync(dir, { recursive: true });
  });
});
