import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveThreshold,
  countLines,
  DEFAULT_MIN_LINES,
} from "../src/index.ts";

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
