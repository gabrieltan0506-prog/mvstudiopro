import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { growthJsonChunks, readGrowthGzipJson, readGrowthJsonItemsStream, writeGrowthGzipJson } from "./growthJsonStream";

describe("growth streaming persistence", () => {
  it("preserves every item and JSON Unicode/null/omission semantics", async () => {
    const value = { updatedAt: new Date("2026-10-03"), collection: { items: Array.from({ length: 12000 }, (_, i) => ({ id: i, title: "中文🌧️".repeat(10), missing: undefined, value: i % 2 ? null : 0 })) } };
    const chunks = Array.from(growthJsonChunks(value));
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.join("")).toBe(JSON.stringify(value));
    const dir = await mkdtemp(path.join(tmpdir(), "growth-stream-"));
    try {
      const file = path.join(dir, "current.json");
      await writeGrowthGzipJson(file, value);
      expect(await readGrowthGzipJson(file + ".gz")).toEqual(JSON.parse(JSON.stringify(value)));
      const before = await readFile(file + ".gz");
      await expect(writeGrowthGzipJson(file, { items: [BigInt(1)] })).rejects.toThrow();
      expect(await readFile(file + ".gz")).toEqual(before);
      expect(await readdir(dir)).toEqual(["current.json.gz"]);
      await writeFile(file + ".gz", "invalid-gzip");
      await expect(readGrowthGzipJson(file + ".gz")).rejects.toThrow();
      await expect(readGrowthGzipJson(file + ".missing")).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("按键索引的 items 对象逐条分块，流式回读不拼整串且兼容缩进旧文件", async () => {
    const items: Record<string, unknown> = {};
    // 含转义引号、反斜杠、花括号与多字节字符，跨 64KB 读块边界
    for (let i = 0; i < 20000; i++) items[`k:${i}"\\{`] = { key: i, title: "引号\"}{]".repeat(i % 7), skip: undefined, n: i % 3 ? null : 1.5e3 };
    const value = { updatedAt: "2026-11-18", platform: "douyin", items, tail: [1, { a: "b" }] };
    const chunks = Array.from(growthJsonChunks(value));
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.join("")).toBe(JSON.stringify(value));
    const expected = JSON.parse(JSON.stringify(value));
    const dir = await mkdtemp(path.join(tmpdir(), "growth-stream-items-"));
    try {
      const file = path.join(dir, "douyin.json");
      await writeFile(file, JSON.stringify(value, null, 2));
      await writeGrowthGzipJson(file, value, { keepPlain: true });
      expect((await readdir(dir)).sort()).toEqual(["douyin.json", "douyin.json.gz"]);
      for (const [target, gzip] of [[file + ".gz", true], [file, false]] as const) {
        const seen: Record<string, unknown> = {};
        const result = await readGrowthJsonItemsStream(target, { gzip, onItem: (key, item) => { seen[key] = item; } });
        expect(result.hasItems).toBe(true);
        expect(result.itemCount).toBe(20000);
        expect(seen).toEqual(expected.items);
        expect(result.fields).toEqual({ updatedAt: "2026-11-18", platform: "douyin", tail: [1, { a: "b" }] });
      }
      const full = JSON.stringify(value);
      await writeFile(file + ".gz", gzipSync(Buffer.from(full.slice(0, full.length - 40))));
      await expect(readGrowthJsonItemsStream(file + ".gz", { gzip: true, onItem: () => {} })).rejects.toThrow();
      await writeFile(file, full + "x");
      await expect(readGrowthJsonItemsStream(file, { gzip: false, onItem: () => {} })).rejects.toThrow();
      await expect(readGrowthJsonItemsStream(file + ".missing", { gzip: true, onItem: () => {} })).rejects.toMatchObject({ code: "ENOENT" });
      const empty = path.join(dir, "empty.json");
      await writeFile(empty, "{\n  \"items\": {}\n}\n");
      expect(await readGrowthJsonItemsStream(empty, { gzip: false, onItem: () => {} })).toEqual({ fields: {}, itemCount: 0, hasItems: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
