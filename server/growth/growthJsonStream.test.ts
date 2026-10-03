import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { growthJsonChunks, readGrowthGzipJson, writeGrowthGzipJson } from "./growthJsonStream";

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
});
