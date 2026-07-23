import { describe, expect, it } from "vitest";
import { resolveManhuaWorkbenchNextCta } from "./manhuaWorkbenchNextCta";

describe("resolveManhuaWorkbenchNextCta (阿硕步进)", () => {
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
