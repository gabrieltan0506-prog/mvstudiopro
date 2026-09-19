import { describe, expect, it } from "vitest";
import {
  MANHUA_SHOT_KEYART_STATE_ZH,
  manhuaShotKeyartState,
  manhuaShotKeyartStateZh,
} from "./manhuaShotKeyartState";

const state = (over: Partial<Parameters<typeof manhuaShotKeyartState>[0]>) =>
  manhuaShotKeyartState({ hasImage: false, failed: false, running: false, pixelLocked: false, ...over });

describe("镜头静帧状态（列表卡与当前镜面板共用一处判断）", () => {
  it("有图但没过垫图锁 = 不能出片，不许显示成已就绪", () => {
    expect(state({ hasImage: true, pixelLocked: false })).toBe("unlocked");
    expect(MANHUA_SHOT_KEYART_STATE_ZH.unlocked).toContain("不能出片");
    // 反例对照：过了锁才是可出片
    expect(state({ hasImage: true, pixelLocked: true })).toBe("ready");
    expect(MANHUA_SHOT_KEYART_STATE_ZH.ready).toContain("可出片");
  });

  it("有图优先于失败与进行中：重出成功过的镜不许还挂着「失败」", () => {
    expect(state({ hasImage: true, pixelLocked: true, failed: true, running: true })).toBe("ready");
  });

  it("无图时：失败 → error，进行中 → running，都没有 → idle", () => {
    expect(state({ failed: true })).toBe("error");
    expect(state({ running: true })).toBe("running");
    expect(state({})).toBe("idle");
    // 失败与进行中同时为真时先报失败（用户要看的是需要动手的那个）
    expect(state({ failed: true, running: true })).toBe("error");
  });

  it("文案函数与状态函数同源，不会各写一份", () => {
    expect(manhuaShotKeyartStateZh({ hasImage: true, failed: false, running: false, pixelLocked: false }))
      .toBe(MANHUA_SHOT_KEYART_STATE_ZH.unlocked);
    expect(Object.keys(MANHUA_SHOT_KEYART_STATE_ZH).sort()).toEqual(
      ["error", "idle", "ready", "running", "stale", "unlocked"],
    );
  });
});
