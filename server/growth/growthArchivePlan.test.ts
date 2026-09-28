import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planArchiveBatch, writeArchivePlan } from "../../scripts/growth-archive-plan.mjs";
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
function fixture(dir = "2026-09-01-00") {
  const body = "真实归档字节",
    fingerprint = "a".repeat(64);
  const archive = {
    assetName: `archive-${dir}.tar.gz`,
    bytes: Buffer.byteLength(body),
    sha256: sha(body),
  };
  const manifest = {
    schemaVersion: 1,
    dir,
    sourceFingerprint: fingerprint,
    archive,
    parts: [{ ...archive, index: 0 }],
  };
  const raw = JSON.stringify(manifest),
    name = `archive-${dir}.manifest.json`;
  const asset = (name: string, bytes: number, digest: string) => ({
    name,
    size: bytes,
    digest: `sha256:${digest}`,
    state: "uploaded",
  });
  return {
    row: `${dir}\t${fingerprint}\t100\n`,
    manifest,
    name,
    raw,
    assets: [
      asset(name, Buffer.byteLength(raw), sha(raw)),
      asset(archive.assetName, archive.bytes, archive.sha256),
    ],
  };
}
describe("归档断点规划", () => {
  it("发布凭证与资产摘要一致才跳过；变化目录重新备份", () => {
    const f = fixture();
    expect(
      planArchiveBatch(f.row, f.assets, new Map([[f.name, f.raw]]))
    ).toMatchObject({ reused: 1, selected: [], reclaim: [expect.stringContaining(f.row.trim().split("\t")[0])], remaining: 0 });
    expect(
      planArchiveBatch(
        f.row.replace("a".repeat(64), "b".repeat(64)),
        f.assets,
        new Map([[f.name, f.raw]])
      )
    ).toMatchObject({ reused: 0, reclaim: [], pending: 1 });
  });
  it.each([
    "missing",
    "corrupt",
    "legacy",
    "payload-missing",
    "payload-changed",
    "manifest-changed",
  ])("%s 不允许冒充已备份", mode => {
    const f = fixture();
    let raw = f.raw;
    if (mode === "missing") raw = "";
    if (mode === "corrupt") raw = "{broken";
    if (mode === "legacy")
      raw = JSON.stringify({ ...f.manifest, sourceFingerprint: undefined });
    if (mode === "payload-missing") f.assets.pop();
    if (mode === "payload-changed")
      f.assets[1].digest = `sha256:${"b".repeat(64)}`;
    if (mode === "manifest-changed") f.assets[0].digest = "";
    expect(
      planArchiveBatch(f.row, f.assets, new Map([[f.name, raw]]))
    ).toMatchObject({ reused: 0, reclaim: [], pending: 1 });
  });
  it("大积压分批，下一轮靠已发布凭证向前推进", () => {
    const fixtures = Array.from({ length: 30 }, (_, i) =>
      fixture(`2026-09-${String(i + 1).padStart(2, "0")}-00`)
    );
    const snapshot = fixtures.map(f => f.row).join("");
    const first = planArchiveBatch(snapshot, [], new Map());
    expect(first).toMatchObject({ reused: 0, pending: 30, remaining: 18 });
    expect(first.selected).toHaveLength(12);
    const second = planArchiveBatch(
      snapshot,
      fixtures.slice(0, 12).flatMap(f => f.assets),
      new Map(fixtures.slice(0, 12).map(f => [f.name, f.raw]))
    );
    expect(second).toMatchObject({ reused: 12, pending: 18, remaining: 6 });
    expect(second.selected[0]).toContain("2026-09-13-00");
  });
  it("数据量也有上限，超大单目录不被永久饿死", () => {
    const f = fixture();
    const big = f.row.replace("\t100\n", "\t800000000\n");
    expect(
      planArchiveBatch(big + fixture("2026-09-02-00").row, [], new Map())
        .selected
    ).toHaveLength(1);
  });
  it("已回读且指纹未变的旧归档按容量与数量限制进入独立删源队列", () => {
    const fixtures = Array.from({ length: 6 }, (_, i) =>
      fixture(`2026-08-${String(i + 1).padStart(2, "0")}-00`)
    );
    const plan = planArchiveBatch(
      fixtures.map(f => f.row).join(""),
      fixtures.flatMap(f => f.assets),
      new Map(fixtures.map(f => [f.name, f.raw]))
    );
    expect(plan).toMatchObject({ reused: 6, pending: 0, selected: [], reclaimRemaining: 2 });
    expect(plan.reclaim).toHaveLength(4);
    const fields = plan.reclaim[0].split("\t");
    expect(fields).toEqual([
      "2026-08-01-00", "a".repeat(64), "100",
      fixtures[0].manifest.archive.assetName,
      String(fixtures[0].manifest.archive.bytes), fixtures[0].manifest.archive.sha256,
      fixtures[0].name, String(Buffer.byteLength(fixtures[0].raw)), sha(fixtures[0].raw),
      expect.any(String),
    ]);
  });
  it("只有reclaim时跳过新上传但继续删源；真正空批次才标记EMPTY", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "growth-archive-plan-"));
    try {
      const f = fixture();
      writeArchivePlan(root, planArchiveBatch(f.row, f.assets, new Map([[f.name, f.raw]])));
      expect(fs.existsSync(path.join(root, "UPLOAD_EMPTY"))).toBe(true);
      expect(fs.existsSync(path.join(root, "EMPTY"))).toBe(false);
      expect(fs.readFileSync(path.join(root, "reclaim.tsv"), "utf8")).toContain(f.name);
      writeArchivePlan(root, planArchiveBatch("", [], new Map()));
      expect(fs.existsSync(path.join(root, "UPLOAD_EMPTY"))).toBe(false);
      expect(fs.existsSync(path.join(root, "EMPTY"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("非法路径/指纹/空字节数中止而非静默过滤", () => {
    for (const row of ["../bad\tx\t1", `ok\t${"a".repeat(64)}\t`, ""]) {
      if (row) expect(() => planArchiveBatch(row, [], new Map())).toThrow();
    }
  });
});
