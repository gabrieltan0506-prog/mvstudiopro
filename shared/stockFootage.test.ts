import { describe, expect, it } from "vitest";
import {
  STOCK_FOOTAGE_ALLOWED_USAGES,
  STOCK_FOOTAGE_PURPOSES,
  STOCK_FOOTAGE_PURPOSE_LABEL,
  assertStockUsageAllowed,
  isAllowedStockDownloadUrl,
  isStockAssetInsertable,
  matchesOrientation,
  stockDurationFrames,
  stockFootageAdoptInputSchema,
  stockFootageSearchInputSchema,
} from "./stockFootage";

const uuid = "8f0c2a5e-3b1d-4c6e-9a7f-1234567890ab";

describe("stockFootage 合同", () => {
  it("漫剧禁止 insert，只允许参考图与空镜（反向）", () => {
    expect(() => assertStockUsageAllowed("manhua", "insert")).toThrow(/不能替换既定角色/);
    expect(() => assertStockUsageAllowed("manhua", "reference")).not.toThrow();
    expect(() => assertStockUsageAllowed("manhua", "empty_shot")).not.toThrow();
    expect(() => assertStockUsageAllowed("mv", "empty_shot")).toThrow(/仅限漫剧/);
  });

  it("复刻（remix）只允许 insert：参考图与空镜都被拒，schema 同步", () => {
    expect(STOCK_FOOTAGE_PURPOSES).toContain("remix");
    expect(STOCK_FOOTAGE_ALLOWED_USAGES.remix).toEqual(["insert"]);
    expect(() => assertStockUsageAllowed("remix", "insert")).not.toThrow();
    expect(() => assertStockUsageAllowed("remix", "reference")).toThrow(/短视频复刻的实拍补充画面只允许 insert/);
    expect(() => assertStockUsageAllowed("remix", "empty_shot")).toThrow(/仅限漫剧/);
    expect(STOCK_FOOTAGE_PURPOSE_LABEL.remix).toBe("短视频复刻的实拍补充画面");
    const ok = stockFootageAdoptInputSchema.parse({ requestId: uuid, providerAssetId: "77", kind: "video", purpose: "remix", usage: "insert", orientation: "portrait", context: { segmentId: "2", note: "痛点放大" } });
    expect(ok).toMatchObject({ purpose: "remix", usage: "insert", orientation: "portrait", context: { segmentId: "2", note: "痛点放大" } });
    expect(stockFootageAdoptInputSchema.safeParse({ requestId: uuid, providerAssetId: "77", kind: "video", purpose: "remix", usage: "reference" }).success).toBe(false);
    expect(stockFootageSearchInputSchema.parse({ query: "city", purpose: "remix", orientation: "portrait" }).orientation).toBe("portrait");
    // 既有用途的允许表不受影响
    expect(STOCK_FOOTAGE_ALLOWED_USAGES.marketing).toEqual(["insert", "reference"]);
    expect(STOCK_FOOTAGE_ALLOWED_USAGES.manhua).toEqual(["reference", "empty_shot"]);
  });

  it("采用输入在 schema 层就拒绝漫剧直接入片", () => {
    const bad = stockFootageAdoptInputSchema.safeParse({ requestId: uuid, providerAssetId: "123", kind: "video", purpose: "manhua", usage: "insert" });
    expect(bad.success).toBe(false);
    const ok = stockFootageAdoptInputSchema.parse({ requestId: uuid, providerAssetId: "123", kind: "photo", purpose: "manhua", usage: "reference" });
    expect(ok.provider).toBe("pexels");
    expect(ok.context).toEqual({});
  });

  it("采用输入拒绝非数字素材编号与客户端额外字段（如下载地址）", () => {
    expect(stockFootageAdoptInputSchema.safeParse({ requestId: uuid, providerAssetId: "../x", kind: "video", purpose: "mv" }).success).toBe(false);
    expect(stockFootageAdoptInputSchema.safeParse({ requestId: uuid, providerAssetId: "1", kind: "video", purpose: "mv", downloadUrl: "https://evil" }).success).toBe(false);
  });

  it("搜索输入：时长区间反转被拒，默认值补齐", () => {
    expect(stockFootageSearchInputSchema.safeParse({ query: "rain", purpose: "mv", minDurationSec: 20, maxDurationSec: 5 }).success).toBe(false);
    const v = stockFootageSearchInputSchema.parse({ query: " rain ", purpose: "mv" });
    expect(v).toMatchObject({ query: "rain", kind: "video", page: 1, perPage: 15 });
  });

  it("下载主机白名单只认 https 的 Pexels 文件主机", () => {
    expect(isAllowedStockDownloadUrl("https://videos.pexels.com/video-files/1/a.mp4")).toBe(true);
    expect(isAllowedStockDownloadUrl("https://images.pexels.com/photos/1/a.jpeg")).toBe(true);
    expect(isAllowedStockDownloadUrl("http://videos.pexels.com/a.mp4")).toBe(false);
    expect(isAllowedStockDownloadUrl("https://videos.pexels.com.evil.com/a.mp4")).toBe(false);
    expect(isAllowedStockDownloadUrl("not a url")).toBe(false);
  });

  it("画幅判定与帧换算", () => {
    expect(matchesOrientation(1920, 1080, "landscape")).toBe(true);
    expect(matchesOrientation(1080, 1920, "landscape")).toBe(false);
    expect(matchesOrientation(1080, 1920, "portrait")).toBe(true);
    expect(matchesOrientation(1000, 1050, "square")).toBe(true);
    expect(stockDurationFrames(10.99)).toBe(329);
    expect(isStockAssetInsertable({ usage: "reference" })).toBe(false);
    expect(isStockAssetInsertable({ usage: "empty_shot" })).toBe(true);
  });
});
