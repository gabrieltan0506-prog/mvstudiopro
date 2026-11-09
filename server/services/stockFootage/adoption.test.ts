import { describe, expect, it, vi } from "vitest";
import { STOCK_ADOPT_ABANDONED_MESSAGE, abandonStockAdoption, adoptStockFootage, getStockAdoption, stockFootageAssetId, type StockAdoptionDeps, type StockAdoptionRecord } from "./adoption";
import { loadOwnedStockAsset } from "./ownership";
import { StockFootageError } from "./pexelsClient";

const REQ = "8f0c2a5e-3b1d-4c6e-9a7f-1234567890ab";
const video = {
  id: 42, width: 1920, height: 1080, url: "https://www.pexels.com/video/42/", image: "https://images.pexels.com/v.jpg", duration: 14,
  user: { name: "Lin", url: "https://www.pexels.com/@lin" },
  video_files: [{ id: 7, file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.pexels.com/video-files/42/a.mp4" }],
};

function makeDeps(over: Partial<StockAdoptionDeps> = {}) {
  const rows = new Map<string, StockAdoptionRecord>();
  const counters = { getAsset: 0, download: 0, store: 0 };
  let clock = new Date("2026-11-08T00:00:00Z").getTime();
  const deps: StockAdoptionDeps = {
    load: async id => (rows.has(id) ? structuredClone(rows.get(id)!) : null),
    claim: async r => (rows.has(r.id) ? false : (rows.set(r.id, structuredClone(r)), true)),
    takeover: async (id, _u, prev) => {
      const r = rows.get(id);
      if (!r || r.status !== "running" || new Date(r.updatedAt).getTime() !== prev.getTime()) return false;
      r.updatedAt = new Date(clock);
      return true;
    },
    save: async (id, _u, output, status) => {
      const r = rows.get(id)!;
      if (r.status === "succeeded") return;
      r.output = structuredClone(output);
      if (status) r.status = status;
      r.updatedAt = new Date(clock);
    },
    abandon: async id => {
      const r = rows.get(id);
      if (!r || r.status !== "running") return false;
      r.status = "failed";
      r.output = { ...(r.output ?? { stage: "claimed" }), stage: "failed", message: STOCK_ADOPT_ABANDONED_MESSAGE };
      r.updatedAt = new Date(clock);
      return true;
    },
    getAsset: (async () => { counters.getAsset++; return { kind: "video", video }; }) as StockAdoptionDeps["getAsset"],
    download: async () => { counters.download++; return { buffer: Buffer.from("fake-mp4-bytes"), contentType: "video/mp4" }; },
    store: async ({ objectName }) => { counters.store++; return { gcsUri: `gs://bucket/${objectName}` }; },
    sign: uri => `https://signed/${uri.slice(5)}`,
    now: () => new Date(clock),
    ...over,
  };
  return { deps, rows, counters, tick: (ms: number) => { clock += ms; } };
}

const input = { requestId: REQ, providerAssetId: "42", kind: "video" as const, purpose: "mv" as const, context: { projectId: "p1", shotId: "s3" } };

describe("adoptStockFootage", () => {
  it("正向：采用后得到本人 GCS 资产、来源证据与签名地址", async () => {
    const { deps } = makeDeps();
    const res = await adoptStockFootage(7, input, deps);
    expect(res.status).toBe("succeeded");
    expect(res.asset?.gcsUri).toBe(`gs://bucket/stock-footage/7/${stockFootageAssetId(7, REQ)}.mp4`);
    expect(res.asset?.source).toMatchObject({ provider: "pexels", providerAssetId: "42", providerFileId: "7", author: { name: "Lin" }, license: { name: "Pexels License" } });
    expect(res.asset?.durationSec).toBe(14);
    expect(res.asset?.url.startsWith("https://signed/")).toBe(true);
  });

  it("同一编号重复调用不重复下载/入库（幂等）", async () => {
    const { deps, counters } = makeDeps();
    await adoptStockFootage(7, input, deps);
    const again = await adoptStockFootage(7, input, deps);
    expect(again.status).toBe("succeeded");
    expect(counters).toEqual({ getAsset: 1, download: 1, store: 1 });
  });

  it("同一编号换素材 → 冲突（反向）", async () => {
    const { deps } = makeDeps();
    await adoptStockFootage(7, input, deps);
    await expect(adoptStockFootage(7, { ...input, providerAssetId: "43" }, deps)).rejects.toMatchObject({ kind: "conflict" });
  });

  it("断点恢复：入库失败后同编号续做，只补未完成阶段", async () => {
    let failStore = true;
    const { deps, counters } = makeDeps({
      store: async ({ objectName }) => { if (failStore) throw new Error("gcs 503"); return { gcsUri: `gs://bucket/${objectName}` }; },
    });
    const first = await adoptStockFootage(7, input, deps);
    expect(first.status).toBe("reconcile_manual");
    failStore = false;
    const second = await adoptStockFootage(7, input, deps);
    expect(second.status).toBe("succeeded");
    expect(counters.getAsset).toBe(1); // 上游元数据已在 resolved 回执里，不重取
  });

  it("另一个请求仍在处理（回执新鲜）时不抢跑；过期后可接手", async () => {
    const { deps, rows, tick } = makeDeps();
    const id = stockFootageAssetId(7, REQ);
    const { stockAdoptDigest } = await import("./adoption");
    const { stockFootageAdoptInputSchema } = await import("../../../shared/stockFootage");
    const params = stockFootageAdoptInputSchema.parse(input);
    rows.set(id, { id, userId: "7", status: "running", input: { action: "stock_footage_adopt", digest: stockAdoptDigest(params), params }, output: { stage: "claimed" }, updatedAt: deps.now() });
    expect((await adoptStockFootage(7, input, deps)).status).toBe("running");
    tick(4 * 60_000);
    expect((await adoptStockFootage(7, input, deps)).status).toBe("succeeded");
  });

  it("下架/超限属于永久失败，标记 failed 且不再续做（反向）", async () => {
    const { deps, counters } = makeDeps({ download: async () => { throw new StockFootageError("too_large", "素材文件超过处理上限"); } });
    const res = await adoptStockFootage(7, input, deps);
    expect(res.status).toBe("failed");
    const again = await adoptStockFootage(7, input, deps);
    expect(again.status).toBe("failed");
    expect(counters.getAsset).toBe(1);
  });

  it("下载结果不是视频 → 拒收（反向）", async () => {
    const { deps } = makeDeps({ download: async () => ({ buffer: Buffer.from("<html>"), contentType: "text/html" }) });
    expect((await adoptStockFootage(7, input, deps)).status).toBe("failed");
  });

  it("上游给出白名单外下载地址 → 拒收（反向）", async () => {
    const evil = { ...video, video_files: [{ ...video.video_files[0], link: "https://evil.example.com/a.mp4" }] };
    const { deps, counters } = makeDeps({ getAsset: (async () => ({ kind: "video", video: evil })) as StockAdoptionDeps["getAsset"] });
    expect((await adoptStockFootage(7, input, deps)).status).toBe("failed");
    expect(counters.download).toBe(0);
  });

  it("未启用/限流向上抛，保留回执可续做", async () => {
    const { deps, rows } = makeDeps({ getAsset: (async () => { throw new StockFootageError("not_configured", "未启用"); }) as StockAdoptionDeps["getAsset"] });
    await expect(adoptStockFootage(7, input, deps)).rejects.toMatchObject({ kind: "not_configured" });
    expect(rows.get(stockFootageAssetId(7, REQ))?.status).toBe("running");
  });

  it("放弃：reconcile_manual → failed（带放弃原因）；同编号再采用回 failed，不重新下载", async () => {
    const { deps, counters, rows } = makeDeps({ store: async () => { throw new Error("gcs 503"); } });
    expect((await adoptStockFootage(7, input, deps)).status).toBe("reconcile_manual");
    const res = await abandonStockAdoption(7, REQ, deps);
    expect(res).toEqual({ assetId: stockFootageAssetId(7, REQ), requestId: REQ, status: "failed", message: STOCK_ADOPT_ABANDONED_MESSAGE });
    expect(rows.get(stockFootageAssetId(7, REQ))?.status).toBe("failed");
    expect((await getStockAdoption(7, REQ, deps))).toMatchObject({ status: "failed", message: STOCK_ADOPT_ABANDONED_MESSAGE });
    const again = await adoptStockFootage(7, input, deps);
    expect(again.status).toBe("failed");
    // 放弃后同编号不再续做：上游元数据与下载都只发生在第一次
    expect(counters).toEqual({ getAsset: 1, download: 1, store: 0 });
  });

  it("放弃不碰已成功的资产，也不打断新鲜运行中的占位（反向）", async () => {
    const { deps, rows, tick } = makeDeps();
    const ok = await adoptStockFootage(7, input, deps);
    const kept = await abandonStockAdoption(7, REQ, deps);
    expect(kept.status).toBe("succeeded");
    expect(kept.asset?.gcsUri).toBe(ok.asset?.gcsUri);
    expect(rows.get(stockFootageAssetId(7, REQ))?.status).toBe("succeeded");

    const REQ2 = "9f0c2a5e-3b1d-4c6e-9a7f-1234567890ab";
    const id2 = stockFootageAssetId(7, REQ2);
    const { stockAdoptDigest } = await import("./adoption");
    const { stockFootageAdoptInputSchema } = await import("../../../shared/stockFootage");
    const params = stockFootageAdoptInputSchema.parse({ ...input, requestId: REQ2 });
    rows.set(id2, { id: id2, userId: "7", status: "running", input: { action: "stock_footage_adopt", digest: stockAdoptDigest(params), params }, output: { stage: "claimed" }, updatedAt: deps.now() });
    expect((await abandonStockAdoption(7, REQ2, deps)).status).toBe("running");
    expect(rows.get(id2)?.status).toBe("running");
    tick(4 * 60_000);
    expect((await abandonStockAdoption(7, REQ2, deps)).status).toBe("failed");
    expect(rows.get(id2)?.status).toBe("failed");
    await expect(abandonStockAdoption(8, REQ2, deps)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("真实 claim 以 JS 毫秒时间写 updatedAt（不交给数据库 now() 的微秒精度，否则 takeover 永远对不上）", async () => {
    vi.resetModules();
    const captured: Array<Record<string, unknown>> = [];
    const chain = {
      insert: () => ({ values: (v: Record<string, unknown>) => { captured.push(v); return { onConflictDoNothing: () => ({ returning: async () => [{ id: v.id }] }) }; } }),
    };
    vi.doMock("../../db", () => ({ getDb: async () => chain }));
    const mod = await import("./adoption");
    const at = new Date("2026-11-09T01:02:03.456Z");
    const ok = await mod.realStockAdoptionDeps.claim({ id: "sf_x", userId: "7", status: "running", input: { action: "stock_footage_adopt", digest: "d", params: {} as never }, output: { stage: "claimed" }, updatedAt: at });
    expect(ok).toBe(true);
    expect(captured[0]).toMatchObject({ id: "sf_x", userId: "7", type: "stock_footage", status: "running", attempts: 1, updatedAt: at, createdAt: at });
    vi.doUnmock("../../db");
    vi.resetModules();
  });

  it("真实 takeover 以 ISO 字符串比对毫秒截断的 updatedAt（不把裸 Date 交给驱动按本地时区序列化）", async () => {
    vi.resetModules();
    const captured: unknown[] = [];
    const chain = {
      update: () => ({ set: () => ({ where: (w: unknown) => { captured.push(w); return { returning: async () => [{ id: "sf_x" }] }; } }) }),
    };
    vi.doMock("../../db", () => ({ getDb: async () => chain }));
    const mod = await import("./adoption");
    const prev = new Date("2026-11-09T01:02:03.456Z");
    expect(await mod.realStockAdoptionDeps.takeover("sf_x", 7, prev)).toBe(true);
    const flatten = (node: unknown, out: unknown[] = []): unknown[] => {
      if (Array.isArray(node)) for (const c of node) flatten(c, out);
      else if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) for (const c of (node as { queryChunks: unknown[] }).queryChunks) flatten(c, out);
      else if (node && typeof node === "object" && "value" in (node as object)) flatten((node as { value: unknown }).value, out);
      else out.push(node);
      return out;
    };
    const leaves = flatten(captured[0]);
    expect(leaves).toContain("2026-11-09T01:02:03.456Z");
    expect(leaves.some(v => v instanceof Date)).toBe(false);
    expect(leaves.some(v => typeof v === "string" && v.includes("date_trunc('milliseconds'"))).toBe(true);
    vi.doUnmock("../../db");
    vi.resetModules();
  });

  it("查询与归属核对：他人账号、未完成、用途不符都拒绝", async () => {
    const { deps } = makeDeps();
    const res = await adoptStockFootage(7, input, deps);
    expect((await getStockAdoption(7, REQ, deps)).status).toBe("succeeded");
    const asset = await loadOwnedStockAsset(7, res.assetId, { purpose: "mv", kind: "video" }, deps);
    expect(asset.gcsUri).toBe(res.asset!.gcsUri);
    await expect(loadOwnedStockAsset(8, res.assetId, {}, { load: async () => null })).rejects.toMatchObject({ kind: "not_found" });
    await expect(loadOwnedStockAsset(7, res.assetId, { purpose: "manhua" }, deps)).rejects.toMatchObject({ kind: "invalid" });
    await expect(loadOwnedStockAsset(7, res.assetId, { usages: ["reference"] }, deps)).rejects.toMatchObject({ kind: "invalid" });
    await expect(loadOwnedStockAsset(7, "sf_bad", {}, deps)).rejects.toMatchObject({ kind: "invalid" });
  });
});
