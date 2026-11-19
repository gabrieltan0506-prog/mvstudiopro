/**
 * 读档原文顾问分组写入（2026-11-19）：约 440 组 16 路并发；首个失败后不领新组、等在途收尾再抛；
 * plan.json 只在全部组写完后落盘；「内容不同禁止覆盖」逐组保持；已完整写过的同一原稿零重写。
 */
import { describe, expect, it } from "vitest";
import { createKnowledgeReadingPreparation, KNOWLEDGE_READING_SOURCE_WRITE_CONCURRENCY } from "./knowledgeReadingPreparation";

function store(opts: { delayMs?: number; failOn?: (key: string) => boolean } = {}) {
  const data = new Map<string, any>();
  const saves: string[] = [];
  let active = 0, peak = 0;
  const deps = {
    read: async (key: string) => (data.has(key) ? structuredClone(data.get(key)) : null),
    save: async (key: string, value: unknown) => {
      active += 1; peak = Math.max(peak, active);
      try {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 2));
        if (opts.failOn?.(key)) throw new Error(`gcs write failed (test) ${key}`);
        saves.push(key);
        data.set(key, structuredClone(value));
      } finally { active -= 1; }
    },
  };
  return { data, saves, deps, get peak() { return peak; } };
}
const parts = (n: number, tag = "原文") => Array.from({ length: n }, (_, i) => `## 第${i + 1}段\n${tag}${i}`);
const ROOT = "knowledge-reading/user-7/kc_pool";

describe("读档原文顾问写入并发", () => {
  it("1760 段 → 440 组以 16 路并发写入，结果与逐组串行相同", async () => {
    const s = store({ delayMs: 5 });
    const p = createKnowledgeReadingPreparation(7, "kc_pool", s.deps as any);
    await p.onSource("file-0:doc", parts(1760));
    expect(KNOWLEDGE_READING_SOURCE_WRITE_CONCURRENCY).toBe(16);
    expect(s.peak).toBe(16);
    expect(p.progress()?.batches).toBe(440);
    expect(p.progress()?.ready).toEqual(Array.from({ length: 440 }, (_, i) => i));
    expect(s.data.get(`${ROOT}/batch-439/input.json`).source.pages.map((x: any) => x.body)).toEqual(parts(1760).slice(1756));
    expect(s.saves.at(-1)).toBe(`${ROOT}/plan.json`);

    // 串行参照：同一输入、并发 1 的写法得到的每组内容逐字相同
    const serial = store({ delayMs: 0 });
    const q = createKnowledgeReadingPreparation(7, "kc_pool", serial.deps as any);
    await q.onSource("file-0:doc", parts(1760));
    expect(new Map(s.data)).toEqual(new Map(serial.data));
  });

  it("中途一组写失败：整次报错、plan 不落盘；重跑只补缺的组、已写的不重写，「内容不同禁止覆盖」仍在", async () => {
    let fail = true;
    const s = store({ failOn: (key) => fail && key.endsWith("/batch-37/input.json") });
    const p = createKnowledgeReadingPreparation(7, "kc_pool", s.deps as any);
    await expect(p.onSource("file-0:doc", parts(400))).rejects.toThrow("gcs write failed (test)");
    expect(s.data.has(`${ROOT}/plan.json`)).toBe(false);
    const written = new Set(s.saves);
    expect(written.size).toBeGreaterThan(0);
    expect(written.size).toBeLessThan(100);

    fail = false;
    s.saves.length = 0;
    const again = createKnowledgeReadingPreparation(7, "kc_pool", s.deps as any);
    await again.onSource("file-0:doc", parts(400));
    expect(s.saves.filter((k) => written.has(k))).toEqual([]);
    expect(s.saves.length).toBe(100 - written.size + 1);
    expect(again.progress()?.ready).toHaveLength(100);

    // 另一实例用不同内容写同一任务：首组即判「内容已改变」，不覆盖
    const other = createKnowledgeReadingPreparation(7, "kc_pool", { ...s.deps, read: async (k: string) => (k.endsWith("plan.json") ? null : s.deps.read(k)) } as any);
    const before = JSON.stringify(s.data.get(`${ROOT}/batch-0/input.json`));
    await expect(other.onSource("file-0:doc", parts(400, "偷换"))).rejects.toThrow("原顾问分段内容已改变");
    expect(JSON.stringify(s.data.get(`${ROOT}/batch-0/input.json`))).toBe(before);
  });

  it("同一原稿已完整写过（续做 / 旧任务）：零写入", async () => {
    const s = store();
    await createKnowledgeReadingPreparation(7, "kc_pool", s.deps as any).onSource("file-0:doc", parts(40));
    s.saves.length = 0;
    const resumed = createKnowledgeReadingPreparation(7, "kc_pool", s.deps as any);
    await resumed.onSource("file-0:doc", parts(40));
    expect(s.saves).toEqual([]);
    expect(resumed.progress()?.ready).toHaveLength(10);
  });

  it("同一实例的多次调用串行：后一份原稿的批号接在前一份之后，不交错", async () => {
    const s = store({ delayMs: 3 });
    const p = createKnowledgeReadingPreparation(7, "kc_pool", s.deps as any);
    const a = p.onSource("file-0:a", parts(20, "甲"));
    const b = p.onSource("file-1:b", parts(8, "乙"));
    await Promise.all([a, b]);
    expect(p.progress()?.batches).toBe(7);
    expect(s.data.get(`${ROOT}/batch-5/input.json`).source.pages[0].body).toContain("乙0");
    expect(s.data.get(`${ROOT}/batch-4/input.json`).source.pages[0].body).toContain("甲16");
  });
});
