import { describe, expect, it } from "vitest";
import { adoptStockFootage, getStockAdoption, stockFootageAssetId, type StockAdoptionDeps, type StockAdoptionRecord } from "./adoption";
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
