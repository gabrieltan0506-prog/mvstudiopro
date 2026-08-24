import { describe, expect, it } from "vitest";
import {
  MANHUA_DELIVERY_UPSCALE_LABEL_ZH,
  MANHUA_DELIVERY_UPSCALE_TARGETS,
  canMountBgmNow,
  canUpscaleNow,
  upscaleBilledSeconds,
} from "./manhuaDeliveryOrder";

describe("超分只有 2K / 4K", () => {
  it("两档，与服务端 api/jobs.ts「只支持 2K 或 4K」一致", () => {
    expect([...MANHUA_DELIVERY_UPSCALE_TARGETS]).toEqual(["2k", "4k"]);
  });

  it("每档都有说明，不让用户猜差在哪", () => {
    for (const t of MANHUA_DELIVERY_UPSCALE_TARGETS) {
      expect(MANHUA_DELIVERY_UPSCALE_LABEL_ZH[t].length).toBeGreaterThan(6);
    }
  });
});

describe("顺序不可逆：成片 → 超分 → 贴 BGM", () => {
  it("没拼片不给超分", () => {
    expect(canUpscaleNow({ hasAssembled: false, bgmMounted: false }).ok).toBe(false);
  });

  it("贴过 BGM 的不许再超分 —— 会重新编码混死的音轨，等于把废片做得更贵", () => {
    const r = canUpscaleNow({ hasAssembled: true, bgmMounted: true });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reasonZh).toContain("成片→超分→贴 BGM");
  });

  it("拼好且没贴 BGM，放行", () => {
    expect(canUpscaleNow({ hasAssembled: true, bgmMounted: false })).toEqual({ ok: true });
  });

  it("想超分却没超就贴 BGM：只提示不硬拦 —— 不超分也是一条正路", () => {
    const r = canMountBgmNow({ hasAssembled: true, upscaled: false, wantsUpscale: true });
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.warnZh).toContain("建议先超分");
  });

  it("不打算超分的直接放行，不啰嗦", () => {
    expect(canMountBgmNow({ hasAssembled: true, upscaled: false, wantsUpscale: false })).toEqual({
      ok: true,
    });
  });

  it("没拼片不给贴 BGM", () => {
    expect(canMountBgmNow({ hasAssembled: false, upscaled: false, wantsUpscale: false }).ok).toBe(
      false,
    );
  });
});

describe("超分计费秒数", () => {
  it("最低按 5 秒，向上取整，封顶 600", () => {
    expect(upscaleBilledSeconds(2)).toBe(5);
    expect(upscaleBilledSeconds(12.1)).toBe(13);
    expect(upscaleBilledSeconds(999)).toBe(600);
  });
});
