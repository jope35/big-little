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
  buildAgentConfig,
  applyAgentConfig,
  checkReadRequest,
  checkBashRequest,
  handleToolBefore,
  BigLittlePlugin,
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

describe("agent permissions", () => {
  it("bulk-reader is deny-all with read tools and narrow bash map", () => {
    const agents: any = buildAgentConfig({});
    const br = agents["bulk-reader"];
    assert.equal(br.mode, "subagent");
    assert.equal(br.temperature, 0.2);
    assert.equal(br.permission["*"], "deny");
    assert.equal(br.permission.read, "allow");
    assert.equal(br.permission.grep, "allow");
    assert.equal(br.permission.glob, "allow");
    assert.equal(br.permission.list, "allow");
    assert.equal(br.permission.webfetch, "allow");
    assert.equal(br.permission.websearch, "allow");
    assert.equal(br.permission.edit, "deny");
    assert.equal(br.permission.task, "deny");
    assert.equal(br.permission.bash["*"], "deny");
    assert.equal(br.permission.bash["ls*"], "allow");
    assert.equal(br.permission.bash["git log*"], "allow");
    assert.equal(br.permission.bash["git status*"], "allow");
    assert.equal(br.permission.bash["git diff*"], "allow");
    assert.equal(br.permission.bash["grep*"], "allow");
    assert.equal(br.permission.bash["rg*"], "allow");
    assert.equal(br.permission.bash["wc*"], "allow");
    assert.ok(!("model" in br), "model key must be absent when unset");
  });

  it("code-writer can edit but has no bash or network", () => {
    const agents: any = buildAgentConfig({});
    const cw = agents["code-writer"];
    assert.equal(cw.mode, "subagent");
    assert.equal(cw.temperature, 0.2);
    assert.equal(cw.permission["*"], "deny");
    assert.equal(cw.permission.read, "allow");
    assert.equal(cw.permission.edit, "allow");
    assert.equal(cw.permission.glob, "allow");
    assert.equal(cw.permission.grep, "allow");
    assert.equal(cw.permission.list, "allow");
    assert.equal(cw.permission.bash, "deny");
    assert.equal(cw.permission.webfetch, "deny");
    assert.equal(cw.permission.websearch, "deny");
    assert.equal(cw.permission.task, "deny");
  });

  it("sets model only when provided via option or env", () => {
    delete process.env.BIGLITTLE_BULK_READER_MODEL;
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
    let agents: any = buildAgentConfig({
      bulkReaderModel: "anthropic/claude-haiku-4-20250514",
    });
    assert.equal(agents["bulk-reader"].model, "anthropic/claude-haiku-4-20250514");
    assert.ok(!("model" in agents["code-writer"]));
    process.env.BIGLITTLE_CODE_WRITER_MODEL = "anthropic/claude-haiku-4-20250514";
    agents = buildAgentConfig({});
    assert.equal(agents["code-writer"].model, "anthropic/claude-haiku-4-20250514");
    delete process.env.BIGLITTLE_CODE_WRITER_MODEL;
  });

  it("config hook merges and never removes user agents", async () => {
    const cfg: any = { agent: { "my-agent": { mode: "primary" } } };
    await applyAgentConfig(cfg, {});
    assert.ok(cfg.agent["my-agent"], "user agent must survive");
    assert.ok(cfg.agent["bulk-reader"], "bulk-reader must exist");
    assert.ok(cfg.agent["code-writer"], "code-writer must exist");
  });
});

describe("routing", () => {
  it("allows small read and blocks big read", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-route-"));
    const small = join(dir, "small.txt");
    const big = join(dir, "big.txt");
    writeFileSync(small, "a\nb");
    writeFileSync(big, Array(400).fill("x").join("\n"));
    assert.equal(checkReadRequest({ filePath: small }, 350), null);
    const msg = checkReadRequest({ filePath: big }, 350);
    assert.ok(msg);
    assert.ok(msg!.includes("bulk-reader"));
    assert.ok(msg!.includes("offset/limit"));
    assert.ok(!msg!.includes("xxxxx"), "message must not include file contents");
    rmSync(dir, { recursive: true });
  });

  it("allows targeted read even on big file", () => {
    assert.equal(checkReadRequest({ filePath: "big.txt", offset: 1, limit: 10 }, 350), null);
    assert.equal(checkReadRequest({ filePath: "big.txt", offset: 1 }, 350), null);
    assert.equal(checkReadRequest({ filePath: "big.txt", limit: 10 }, 350), null);
  });

  it("allows missing path", () => {
    assert.equal(checkReadRequest({}, 350), null);
    assert.equal(checkReadRequest({ filePath: "" }, 350), null);
    assert.equal(checkReadRequest({ filePath: "/no/such.txt" }, 350), null);
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

  it("handleToolBefore throws only on block and ignores other tools", () => {
    const dir = mkdtempSync(join(tmpdir(), "bl-hook-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("z").join("\n"));
    assert.throws(() => handleToolBefore({ tool: "READ" }, { args: { filePath: big } }, 350));
    assert.doesNotThrow(() =>
      handleToolBefore({ tool: "read" }, { args: { filePath: big, limit: 5 } }, 350)
    );
    assert.doesNotThrow(() =>
      handleToolBefore({ tool: "edit" }, { args: { filePath: big } }, 350)
    );
    assert.doesNotThrow(() => handleToolBefore({}, {}, 350));
    rmSync(dir, { recursive: true });
  });
});

describe("BigLittlePlugin wiring", () => {
  it("default-exports a PluginModule wrapping BigLittlePlugin", () => {
    const mod: any = BigLittleModuleDefault;
    assert.equal(mod.id, "big-little");
    assert.strictEqual(mod.server, BigLittlePlugin);
  });

  it("exposes config and tool.execute.before hooks", async () => {
    const plugin: any = await BigLittlePlugin({} as any);
    assert.ok(typeof plugin.config === "function");
    assert.ok(typeof plugin["tool.execute.before"] === "function");
    assert.ok(!("event" in plugin), "event hook must not exist in v1");
  });

  it("config hook preserves user agents", async () => {
    const plugin: any = await BigLittlePlugin({} as any);
    const cfg: any = { agent: { mine: { mode: "primary" } } };
    await plugin.config(cfg);
    assert.ok(cfg.agent.mine);
    assert.ok(cfg.agent["bulk-reader"]);
    assert.ok(cfg.agent["code-writer"]);
  });

  it("tool hook blocks big read and passes targeted read", async () => {
    const plugin: any = await BigLittlePlugin({} as any, { minLines: 350 });
    const dir = mkdtempSync(join(tmpdir(), "bl-wire-"));
    const big = join(dir, "big.txt");
    writeFileSync(big, Array(400).fill("w").join("\n"));
    await assert.rejects(
      plugin["tool.execute.before"](
        { tool: "read", sessionID: "s", callID: "c" },
        { args: { filePath: big } }
      )
    );
    await plugin["tool.execute.before"](
      { tool: "read", sessionID: "s", callID: "c" },
      { args: { filePath: big, limit: 5 } }
    );
    rmSync(dir, { recursive: true });
  });

  it("options come from the second argument", async () => {
    const plugin: any = await BigLittlePlugin({} as any, { minLines: 10 });
    const dir = mkdtempSync(join(tmpdir(), "bl-opts-"));
    const medium = join(dir, "medium.txt");
    writeFileSync(medium, "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk"); // 11 lines
    await assert.rejects(
      plugin["tool.execute.before"](
        { tool: "read", sessionID: "s", callID: "c" },
        { args: { filePath: medium } }
      )
    );
    rmSync(dir, { recursive: true });
  });
});
