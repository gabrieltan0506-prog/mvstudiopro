import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { readGrowthJsonItemsStream, writeGrowthGzipJson } from "./growthJsonStream";
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const strs = ["", "a", "}{][,:\"\\", "中文😀 ", "\\\"", "x".repeat(70000), " ", "\n\t", "\\\\", "end\\"];
function val(d = 0): unknown {
  const r = rnd();
  if (d > 3 || r < 0.3) return [null, true, false, 0, -1.5e-7, 12345678901234, strs[Math.floor(rnd() * strs.length)]][Math.floor(rnd() * 7)];
  if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => val(d + 1));
  return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => [strs[Math.floor(rnd() * strs.length)] + i, val(d + 1)]));
}
it("fuzz: stream reader equals JSON.parse for indented, compact and gzip forms", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fuzz-"));
  for (let round = 0; round < 150; round++) {
    const items: Record<string, unknown> = {};
    const n = Math.floor(rnd() * 30);
    for (let i = 0; i < n; i++) items[strs[Math.floor(rnd() * strs.length)].slice(0, 20) + ":" + i] = val();
    const doc = { updatedAt: "t", platform: val(), items, tail: val() };
    const expected = JSON.parse(JSON.stringify(doc));
    for (const [name, body, gzip] of [
      ["a.json", Buffer.from(JSON.stringify(doc, null, 2)), false],
      ["b.json", Buffer.from(JSON.stringify(doc)), false],
      ["c.json.gz", gzipSync(JSON.stringify(doc, null, 2)), true],
    ] as const) {
      const file = path.join(dir, name);
      await fs.writeFile(file, body);
      const got: Record<string, unknown> = {};
      const r = await readGrowthJsonItemsStream(file, { gzip, onItem: (k, v) => { got[k] = v; } });
      expect(got).toEqual(expected.items);
      expect(r.fields).toEqual({ updatedAt: "t", platform: expected.platform, tail: expected.tail });
      expect(r.itemCount).toBe(Object.keys(expected.items).length);
    }
    const plain = path.join(dir, "w.json");
    await writeGrowthGzipJson(plain, doc);
    const got: Record<string, unknown> = {};
    await readGrowthJsonItemsStream(plain + ".gz", { gzip: true, onItem: (k, v) => { got[k] = v; } });
    expect(got).toEqual(expected.items);
  }
  // 截断必须抛错
  const full = JSON.stringify({ items: { a: { x: [1, 2, "s"] }, b: 2 } });
  for (let cut = 1; cut < full.length; cut++) {
    const file = path.join(dir, "t.json");
    await fs.writeFile(file, full.slice(0, cut));
    await expect(readGrowthJsonItemsStream(file, { gzip: false, onItem: () => {} })).rejects.toThrow();
  }
  await fs.rm(dir, { recursive: true, force: true });
}, 120000);
