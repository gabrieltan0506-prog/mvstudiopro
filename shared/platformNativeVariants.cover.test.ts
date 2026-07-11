import { describe, expect, it } from "vitest";
import {
  composePlatformCoverNativeVisualDirective,
  mapUiPlatformHintToNativeVariantId,
  pickCoverVariantFromVariants,
  type PlatformNativeVariant,
} from "../../shared/platformNativeVariants";

const variants: PlatformNativeVariant[] = [
  {
    platform: "xiaohongshu",
    format: "图文",
    hook: "小红书钩子",
    coverHeadline: "冰箱贴比证书劝人",
    coverSubline: "先睡再卷",
    tags: ["休息"],
    blueOceanKeywords: ["生活"],
  },
  {
    platform: "bilibili",
    format: "短视频",
    hook: "B站钩子",
    coverHeadline: "学历越前越不信",
    tags: ["知识"],
    blueOceanKeywords: ["反差"],
  },
  {
    platform: "weixin_channels",
    format: "短视频",
    hook: "视频号钩子",
    coverHeadline: "散会两小时还在刷",
    coverSubline: "真正没下班",
    tags: ["职场"],
    blueOceanKeywords: ["转发"],
  },
];

describe("platform cover native pick", () => {
  it("maps UI hints to native variant ids", () => {
    expect(mapUiPlatformHintToNativeVariantId("xiaohongshu")).toBe("xiaohongshu");
    expect(mapUiPlatformHintToNativeVariantId("douyin")).toBe("weixin_channels");
    expect(mapUiPlatformHintToNativeVariantId("bilibili")).toBe("bilibili");
  });

  it("prefers coverHeadline for selected platform", () => {
    const bili = pickCoverVariantFromVariants(variants, "bilibili");
    expect(bili.coverHeadline).toBe("学历越前越不信");
    expect(bili.platform).toBe("bilibili");

    const dy = pickCoverVariantFromVariants(variants, "douyin");
    expect(dy.coverHeadline).toBe("散会两小时还在刷");
    expect(dy.coverSubline).toBe("真正没下班");
  });

  it("composes short native visual directives", () => {
    expect(composePlatformCoverNativeVisualDirective("xiaohongshu", { format: "图文" })).toMatch(/小红书/);
    expect(composePlatformCoverNativeVisualDirective("bilibili")).toMatch(/B站/);
    expect(composePlatformCoverNativeVisualDirective("weixin_channels")).toMatch(/视频号/);
  });
});
