import { describe, expect, it } from "vitest";
import { buildManhuaFinalReviewChecklist } from "./manhuaFinalReviewChecklist";

const base = {
  plannedSegments: 2,
  readyClips: 2,
  keyartTotal: 5,
  keyartPixelLocked: 5,
  qualityPassedClips: 2,
  finalCutVerified: true,
  segmentsWithAudio: 2,
  subtitleRequired: true,
  subtitleReady: true,
  finalCutStale: false,
  hasFinalVideo: true,
};

describe("终审检查清单", () => {
  it("全部有据可查且通过时：5/5，无阻断，可终审", () => {
    const out = buildManhuaFinalReviewChecklist(base);
    expect(out.summaryZh).toBe("5/5 项通过");
    expect(out.blockingZh).toBe("");
    expect(out.readyForFinal).toBe(true);
  });

  it("没有证据的项写「未检」，绝不写成通过；未检时不算可终审", () => {
    const out = buildManhuaFinalReviewChecklist({
      ...base,
      keyartTotal: 0,
      keyartPixelLocked: 0,
      qualityPassedClips: 0,
      segmentsWithAudio: 0,
      hasFinalVideo: false,
    });
    const byId = Object.fromEntries(out.items.map((i) => [i.id, i]));
    expect(byId.picture.state).toBe("unknown");
    expect(byId.audio.state).toBe("unknown");
    expect(byId.cut_fresh.state).toBe("unknown");
    expect(out.summaryZh).toContain("未检");
    expect(out.readyForFinal).toBe(false);
    // 反例对照：有证据时同样这几项必须变成 pass
    expect(buildManhuaFinalReviewChecklist(base).readyForFinal).toBe(true);
  });

  it("缺段、静帧没过垫图锁、长片是旧料 —— 逐条报不通过并数出阻断数", () => {
    const out = buildManhuaFinalReviewChecklist({
      ...base,
      readyClips: 1,
      keyartPixelLocked: 3,
      qualityFailedClips: 1,
      finalCutStale: true,
    });
    const byId = Object.fromEntries(out.items.map((i) => [i.id, i]));
    expect(byId.content.detailZh).toContain("缺 1 段");
    expect(byId.picture.detailZh).toContain("1 段成片质检未通过");
    expect(byId.cut_fresh.detailZh).toContain("旧料");
    expect(out.failCount).toBe(3);
    expect(out.blockingZh).toBe("存在 3 处需处理的问题，才能通过终审");
  });

  it("没要求字幕时字幕项是「未检」而不是「通过」，也不算阻断", () => {
    const out = buildManhuaFinalReviewChecklist({ ...base, subtitleRequired: false, subtitleReady: false });
    const subtitle = out.items.find((i) => i.id === "subtitle")!;
    expect(subtitle.state).toBe("not_required");
    expect(out.failCount).toBe(0);
    // 要求了字幕却没时间轴 → 必须是不通过
    const required = buildManhuaFinalReviewChecklist({ ...base, subtitleReady: false });
    expect(required.items.find((i) => i.id === "subtitle")!.state).toBe("fail");
  });

  it("还没有段表时内容完整性是未检，不拿 0/0 冒充通过", () => {
    const out = buildManhuaFinalReviewChecklist({ ...base, plannedSegments: 0, readyClips: 0 });
    expect(out.items.find((i) => i.id === "content")!.state).toBe("unknown");
    expect(out.readyForFinal).toBe(false);
  });
});

it("只有图片锁和视频地址不证明终审；缺用料记录不能通过", () => {
 const out = buildManhuaFinalReviewChecklist({ ...base, qualityPassedClips: undefined, finalCutVerified: false });
 expect(out.readyForFinal).toBe(false);
 expect(out.items.find(x => x.id === "picture")?.state).toBe("unknown");
 expect(out.items.find(x => x.id === "cut_fresh")?.state).toBe("unknown");
 expect(out.blockingZh).toContain("未检");
});
it("没有要求字幕不应永久卡住终审，只有部分段有音轨不能全片通过", () => {
 expect(buildManhuaFinalReviewChecklist({ ...base, subtitleRequired: false }).readyForFinal).toBe(true);
 expect(buildManhuaFinalReviewChecklist({ ...base, segmentsWithAudio: 1 }).readyForFinal).toBe(false);
});
