import { describe, expect, it } from "vitest";
import {
  MANHUA_DELIVERY_SURFACES,
  MANHUA_DELIVERY_UPSCALE_LABEL_ZH,
  MANHUA_DELIVERY_UPSCALE_TARGETS,
  canMountBgmNow,
  canUpscaleNow,
  isManhuaDeliveryUpscaleTarget,
} from "./manhuaDeliveryOrder";

describe("漫剧工厂 / 自由画布共用交付判据", () => {
  it("两处入口只开放 2K / 4K 交付超分", () => {
    expect([...MANHUA_DELIVERY_UPSCALE_TARGETS]).toEqual(["2k", "4k"]);
    expect(isManhuaDeliveryUpscaleTarget("2k")).toBe(true);
    expect(isManhuaDeliveryUpscaleTarget("4k")).toBe(true);
    expect(isManhuaDeliveryUpscaleTarget("1080p")).toBe(false);
    for (const target of MANHUA_DELIVERY_UPSCALE_TARGETS) {
      expect(MANHUA_DELIVERY_UPSCALE_LABEL_ZH[target].length).toBeGreaterThan(6);
    }
  });

  it.each(MANHUA_DELIVERY_SURFACES)("%s：没有可交付视频时两种后期都拒绝", (surface) => {
    expect(canUpscaleNow({
      surface,
      hasDeliveryVideo: false,
      bgmMounted: false,
      target: "2k",
    }).ok).toBe(false);
    expect(canMountBgmNow({
      surface,
      hasDeliveryVideo: false,
      wantsUpscale: false,
      upscaleCompleted: false,
    }).ok).toBe(false);
  });

  it.each(MANHUA_DELIVERY_SURFACES)("%s：只接受合法 2K / 4K 超分档", (surface) => {
    expect(canUpscaleNow({
      surface,
      hasDeliveryVideo: true,
      bgmMounted: false,
      target: "1080p",
    })).toMatchObject({ ok: false, reasonZh: expect.stringContaining("2K 或 4K") });
    expect(canUpscaleNow({
      surface,
      hasDeliveryVideo: true,
      bgmMounted: false,
      target: "4k",
    })).toEqual({ ok: true });
  });

  it.each(MANHUA_DELIVERY_SURFACES)("%s：贴过 BGM 后拒绝反向超分", (surface) => {
    const result = canUpscaleNow({
      surface,
      hasDeliveryVideo: true,
      bgmMounted: true,
      target: "2k",
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reasonZh).toContain("视频→2K/4K 超分→贴 BGM");
  });

  it.each(MANHUA_DELIVERY_SURFACES)("%s：选了超分但没完成时贴 BGM 只告警", (surface) => {
    const result = canMountBgmNow({
      surface,
      hasDeliveryVideo: true,
      wantsUpscale: true,
      upscaleCompleted: false,
      upscaleTarget: "4k",
    });
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.warnZh).toContain("建议先超分");
  });

  it.each(MANHUA_DELIVERY_SURFACES)("%s：不超分或已超分时直接允许贴 BGM", (surface) => {
    expect(canMountBgmNow({
      surface,
      hasDeliveryVideo: true,
      wantsUpscale: false,
      upscaleCompleted: false,
    })).toEqual({ ok: true });
    expect(canMountBgmNow({
      surface,
      hasDeliveryVideo: true,
      wantsUpscale: true,
      upscaleCompleted: true,
      upscaleTarget: "2k",
    })).toEqual({ ok: true });
  });

  it.each(MANHUA_DELIVERY_SURFACES)("%s：声明要超分却没选合法档时拒绝", (surface) => {
    expect(canMountBgmNow({
      surface,
      hasDeliveryVideo: true,
      wantsUpscale: true,
      upscaleCompleted: false,
      upscaleTarget: "1080p",
    })).toMatchObject({ ok: false, reasonZh: expect.stringContaining("2K 或 4K") });
  });
});
