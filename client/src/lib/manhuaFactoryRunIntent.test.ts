import { describe, expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { hasFailedManhuaVideoEdit, isPreparedManhuaVideoEditRun } from "./manhuaFactoryRunIntent";

const target = {
  ...defaultCanvasBlock("video", 0, 0),
  id: "clip-e01-g02",
  episodeIndex: 1,
  prompt: "【第2段·10s】",
  videoModel: "seedance-2.5" as const,
  seedance25WorkMode: "video_edit" as const,
  refVideoUrl: "https://test.invalid/source.mp4",
};
const input = {
  episodeIndex: 1,
  fragmentShotIndex: 2,
  preservePreparedTargetBlocks: true,
  targetBlockIds: [target.id],
  preparedTargetBlocks: [target],
};

describe("编辑和续拍的入口分流", () => {
  it("失败编辑不能由通用续跑清成生成任务；其他集与普通生成失败不受影响", () => {
    const failedEdit = { ...target, status: "error" as const };
    const doneClip = {
      ...target, id: "clip-e01-g01", status: "done" as const,
      seedance25WorkMode: undefined, videoModel: "wan-3.0" as const,
      outputUrl: "https://test.invalid/done.mp4",
    };
    expect(hasFailedManhuaVideoEdit([doneClip, failedEdit], [1])).toBe(true);
    expect(hasFailedManhuaVideoEdit([doneClip, failedEdit], [2])).toBe(false);
    expect(hasFailedManhuaVideoEdit([doneClip, { ...doneClip, status: "error" }], [1])).toBe(false);
    expect(hasFailedManhuaVideoEdit([doneClip, { ...failedEdit, status: "done" }], [1])).toBe(false);
  });
  it("第2段的已准备编辑有自己的原片，无须第1段或其他尾帧", () => {
    expect(isPreparedManhuaVideoEditRun(input)).toBe(true);
  });
  it.each([
    { preservePreparedTargetBlocks: false },
    { preparedTargetBlocks: [] },
    { targetBlockIds: [] },
    { targetBlockIds: ["clip-e01-g01"] },
    { targetBlockIds: [target.id, "clip-e01-g01"] },
    { episodeIndex: 2 },
    { fragmentShotIndex: 1 },
    { fragmentShotIndex: undefined },
  ])("不是本次明确单目标时不豁免续拍检查 %j", change => {
    expect(isPreparedManhuaVideoEditRun({ ...input, ...change })).toBe(false);
  });
  it.each([
    { seedance25WorkMode: "video_extend" as const },
    { videoModel: "wan-3.0" as const },
    { refVideoUrl: "" },
    { refVideoUrl: "javascript:alert(1)" },
    { id: "other-video" },
  ])("新生成、真正延长或无原片不能假冒局部编辑 %j", change => {
    const block = { ...target, ...change };
    expect(
      isPreparedManhuaVideoEditRun({
        ...input,
        targetBlockIds: [block.id],
        preparedTargetBlocks: [block],
      })
    ).toBe(false);
  });
});
