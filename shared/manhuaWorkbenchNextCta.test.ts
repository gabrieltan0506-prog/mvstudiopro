import { describe, expect, it } from "vitest";
import { resolveManhuaWorkbenchNextCta } from "./manhuaWorkbenchNextCta";

describe("resolveManhuaWorkbenchNextCta (阿硕步进)", () => {
  it("回看已确认剧本和资产时，操作随当前页面而非后续产物进度", () => {
    const progress = {
      outlineComplete: true, assetsComplete: true, episodeSheetCount: 5,
      stillsReadyEnough: false, videoBurnUnlocked: false, hasClip: false, factoryBusy: false,
    };
    for (const hasClip of [false, true]) {
      expect(resolveManhuaWorkbenchNextCta({ ...progress, hasClip, activePhase: "outline" }))
        .toMatchObject({ kind: "enter_assets", stepTitleZh: "剧本大纲", prevPhase: null, targetPhase: "assets" });
      expect(resolveManhuaWorkbenchNextCta({ ...progress, hasClip, activePhase: "assets" }))
        .toMatchObject({ kind: "enter_storyboard", stepTitleZh: "资产设定", prevPhase: "outline" });
    }
    expect(resolveManhuaWorkbenchNextCta({ ...progress, activePhase: "storyboard" }).kind).toBe("generate_keyarts");
    expect(resolveManhuaWorkbenchNextCta({ ...progress, activePhase: "outline", outlineComplete: false }).kind).toBe("confirm_outline");
    expect(resolveManhuaWorkbenchNextCta({ ...progress, activePhase: "outline", factoryBusy: true }).kind).toBe("busy");
  });
  it("大纲步：生成本步内容", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: false,
      assetsComplete: false,
      episodeSheetCount: 0,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
      writerPackReady: true,
    });
    expect(cta.kind).toBe("confirm_outline");
    expect(cta.labelZh).toBe("生成本步内容");
    expect(cta.stepTitleZh).toBe("剧本大纲");
    expect(cta.prevPhase).toBeNull();
  });

  it("未确认剧本时可先看资产，但标题和主操作必须说清当前页面与返回动作", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      activePhase: "assets",
      outlineComplete: false,
      assetsComplete: false,
      episodeSheetCount: 0,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
      writerPackReady: true,
    });
    expect(cta).toMatchObject({
      kind: "confirm_outline",
      labelZh: "返回并确认剧本大纲",
      stepTitleZh: "资产设定",
      targetPhase: "outline",
      prevPhase: "outline",
    });
  });

  it("状态切换瞬间仍按当前阶段显示标题，不闪回剧本大纲", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      activePhase: "storyboard",
      outlineComplete: false,
      assetsComplete: false,
      episodeSheetCount: 0,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
    });
    expect(cta).toMatchObject({
      kind: "confirm_outline",
      labelZh: "返回并确认剧本大纲",
      stepTitleZh: "分镜 · 关键静帧",
      targetPhase: "outline",
    });
  });

  it("资产步空墙：生成全部 + 生成本集角色设定卡", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: true,
      assetsComplete: true,
      episodeSheetCount: 0,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
    });
    expect(cta.kind).toBe("spawn_sheets");
    expect(cta.labelZh).toBe("生成全部");
    expect(cta.stepTitleZh).toMatch(/角色设定卡/);
    expect(cta.prevPhase).toBe("outline");
  });

  it("分镜步：生成本步内容出静帧", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: true,
      assetsComplete: true,
      episodeSheetCount: 3,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
    });
    expect(cta.kind).toBe("generate_keyarts");
    expect(cta.labelZh).toBe("生成关键静帧");
    expect(cta.targetPhase).toBe("storyboard");
  });

  it("静帧齐后：生成分镜视频 →", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: true,
      assetsComplete: true,
      episodeSheetCount: 3,
      stillsReadyEnough: true,
      videoBurnUnlocked: true,
      hasClip: false,
      factoryBusy: false,
    });
    expect(cta.kind).toBe("generate_all_clips");
    expect(cta.labelZh).toMatch(/生成分镜视频/);
  });
});
