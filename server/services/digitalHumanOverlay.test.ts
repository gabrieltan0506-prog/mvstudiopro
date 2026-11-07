import { describe, expect, it } from "vitest";
import type { StockFootageAsset } from "../../shared/stockFootage";
import { DIGITAL_HUMAN_OVERLAY_STOCK_EXPECT, digitalHumanOverlayCredits, digitalHumanOverlayFfmpegArgs, digitalHumanOverlayFileExt, resolveDigitalHumanOverlays } from "./digitalHumanOverlay";
import { loadOwnedStockAsset } from "./stockFootage/ownership";

const A = `sf_${"a".repeat(48)}`, B = `sf_${"b".repeat(48)}`;
function asset(assetId: string, patch: Partial<StockFootageAsset> = {}): StockFootageAsset {
  return {
    assetId, requestId: "00000000-0000-4000-8000-000000000009", kind: "video", purpose: "digital_human", usage: "insert",
    gcsUri: `gs://test-only/stock-footage/7/${assetId}.mp4`, mimeType: "video/mp4", bytes: 1000, sha256: "0".repeat(64),
    width: 1920, height: 1080, durationSec: 6,
    source: { provider: "pexels", providerAssetId: "123", pageUrl: "https://www.pexels.com/video/123/", author: { name: "Author" }, license: { name: "Pexels License", url: "https://www.pexels.com/license/" }, downloadedFrom: "https://videos.pexels.com/x.mp4", providerFileId: "1", retrievedAt: "2026-11-08T00:00:00Z" },
    context: {}, adoptedAt: "2026-11-08T00:00:00Z", ...patch,
  };
}
const ov = (assetId: string, startSec: number, durationSec: number, sourceInSec = 0) => ({ assetId, startSec, durationSec, sourceInSec, mode: "overlay" as const });

describe("服务端覆盖素材以 loadOwnedStockAsset 为准", () => {
  it("正向：每个 assetId 只查一次，返回服务端 gcsUri/类型/时长，并生成署名", async () => {
    const calls: string[] = [];
    const store = { [A]: asset(A), [B]: asset(B, { kind: "photo", durationSec: undefined, mimeType: "image/jpeg", gcsUri: `gs://test-only/stock-footage/7/${B}.jpg` }) };
    const rows = await resolveDigitalHumanOverlays(7, [ov(A, 0, 3, 3), ov(B, 4, 3), ov(A, 8, 2)], 10, async (uid, id) => { expect(uid).toBe(7); calls.push(id); return store[id as keyof typeof store]; });
    expect(calls).toEqual([A, B]);
    expect(rows.map(r => r.asset.gcsUri)).toEqual([store[A].gcsUri, store[B].gcsUri, store[A].gcsUri]);
    expect(digitalHumanOverlayCredits(rows)[0]).toMatchObject({ assetId: A, attribution: "Author / Pexels", license: "Pexels License", kind: "video" });
    expect(await resolveDigitalHumanOverlays(7, [], 10, async () => { throw new Error("不应调用"); })).toEqual([]);
  });
  it("反向：非本人/未采用直接抛错，不建任务；用途或采用方式不符拒绝；服务端时长覆盖客户端声称", async () => {
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, async () => { throw new Error("素材不存在或不属于本人"); })).rejects.toThrow("不属于本人");
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, async (_uid, id) => asset(id, { purpose: "mv" }))).rejects.toThrow("数字人");
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, async (_uid, id) => asset(id, { usage: "reference" }))).rejects.toThrow("可入片");
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, async () => asset(B))).rejects.toThrow("身份不一致");
    // 实际素材只有 2 秒：入点1+2秒超长
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2, 1)], 10, async (_uid, id) => asset(id, { durationSec: 2 }))).rejects.toThrow("超过素材时长");
    // 服务端说是照片：入点必须为0
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2, 1)], 10, async (_uid, id) => asset(id, { kind: "photo", durationSec: undefined }))).rejects.toThrow("入点须为0");
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 9, 2)], 10, async (_uid, id) => asset(id))).rejects.toThrow("口播总时长");
    await expect(resolveDigitalHumanOverlays(0, [ov(A, 0, 2)], 10, async (_uid, id) => asset(id))).rejects.toThrow("登录");
  });
});

describe("接入真实 loadOwnedStockAsset（注入记录加载）", () => {
  // 采用记录按 (assetId, userId) 取；只有本人且 succeeded 的记录可用
  const record = (a: StockFootageAsset, owner = 7, status = "succeeded") => async (id: string, uid: number) =>
    id === a.assetId && uid === owner ? { id, userId: String(owner), status, input: {} as never, output: { stage: "done" as never, asset: a } as never, updatedAt: new Date() } : null;
  const via = (a: StockFootageAsset, owner?: number, status?: string) =>
    (uid: number, id: string, expect?: Parameters<typeof loadOwnedStockAsset>[2]) => loadOwnedStockAsset(uid, id, expect, { load: record(a, owner, status) });

  it("正向：按数字人用途+insert 期望调用，返回服务端资产", async () => {
    const seen: unknown[] = [];
    const rows = await resolveDigitalHumanOverlays(7, [ov(A, 1, 3, 1)], 10, async (uid, id, expect) => { seen.push(expect); return via(asset(A))(uid, id, expect); });
    expect(seen).toEqual([DIGITAL_HUMAN_OVERLAY_STOCK_EXPECT]);
    expect(rows[0].asset.gcsUri).toBe(asset(A).gcsUri);
  });
  it("反向：他人素材、未采用完成、非数字人用途、参考用法都被 loadOwnedStockAsset 拒绝", async () => {
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, via(asset(A), 8))).rejects.toThrow("不属于当前账号");
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, via(asset(A), 7, "running"))).rejects.toThrow("未采用完成");
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, via(asset(A, { purpose: "marketing" })))).rejects.toThrow("不是为当前业务采用的");
    await expect(resolveDigitalHumanOverlays(7, [ov(A, 0, 2)], 10, via(asset(A, { usage: "reference" })))).rejects.toThrow("采用方式不适用");
  });
});

describe("覆盖画面合成参数", () => {
  const inputs = [
    { path: "/tmp/o0.mp4", kind: "video" as const, startSec: 1, durationSec: 2.5, sourceInSec: 3 },
    { path: "/tmp/o1.jpg", kind: "photo" as const, startSec: 5, durationSec: 3, sourceInSec: 0 },
  ];
  it("正向：母轨画面为输入0，视频按入点取段、照片循环固定时长，只输出叠加后视频且去掉全部音轨", () => {
    const args = digitalHumanOverlayFfmpegArgs({ picture: "/tmp/picture.mp4", inputs, width: 1080, height: 1920, target: "/tmp/out.mp4" });
    expect(args.slice(0, 3)).toEqual(["-y", "-i", "/tmp/picture.mp4"]);
    expect(args.join(" ")).toContain("-ss 3.000 -t 2.500 -i /tmp/o0.mp4");
    expect(args.join(" ")).toContain("-f image2 -loop 1 -framerate 30 -t 3.000 -i /tmp/o1.jpg");
    const map = args.indexOf("-map");
    expect(args[map + 1]).toBe("[vout]");
    expect(args.filter(a => a === "-map")).toHaveLength(1);
    expect(args).toContain("-an");
    expect(args.join(" ")).not.toMatch(/:a\b|\[a\]|-c:a/);
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("enable='between(t,1.000,3.500)'");
    expect(filter).toContain("enable='between(t,5.000,8.000)'");
  });
  it("反向：没有覆盖素材或时间无效时拒绝构造参数", () => {
    expect(() => digitalHumanOverlayFfmpegArgs({ picture: "p", inputs: [], width: 1080, height: 1920, target: "t" })).toThrow();
    expect(() => digitalHumanOverlayFfmpegArgs({ picture: "p", inputs: [{ ...inputs[0], startSec: -1 }], width: 1080, height: 1920, target: "t" })).toThrow("无效");
  });
  it("文件扩展名：照片按 MIME，视频固定 mp4", () => {
    expect(digitalHumanOverlayFileExt({ kind: "photo", mimeType: "image/png" })).toBe("png");
    expect(digitalHumanOverlayFileExt({ kind: "photo", mimeType: "image/jpeg" })).toBe("jpg");
    expect(digitalHumanOverlayFileExt({ kind: "video", mimeType: "image/png" })).toBe("mp4");
  });
});
