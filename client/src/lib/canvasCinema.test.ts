import { expect, it, vi } from "vitest";
import { defaultCanvasBlock, normalizeCanvasBlock } from "./canvasTypes";
import { sanitizeManhuaCloudDraftBlock } from "@shared/manhuaCloudDraft";
import { cloudDraftBlocksToCanvas } from "./manhuaCloudDraftSync";
import {
  digitalHumanCinemaSchema,
  applyDigitalHumanCinema,
} from "@shared/digitalHumanCinema";
import { canvasVideoTaskInputFingerprint } from "./canvasVideoTaskResume";
import { previewCanvasBlockOutbound, runCanvasBlock } from "./canvasRunBlock";
it("导演设置通过云稿白名单及恢复链，改稿改变任务指纹", () => {
  const block = defaultCanvasBlock("video", 0, 0);
  block.cinema = digitalHumanCinemaSchema.parse({
    movement: "缓推",
    customPalette: ["#112233"],
  });
  block.prompt = applyDigitalHumanCinema("保留原始场景", block.cinema);
  const cloud = sanitizeManhuaCloudDraftBlock(
    JSON.parse(JSON.stringify(block))
  )!;
  const [restored] = cloudDraftBlocksToCanvas([cloud]);
  expect(restored.cinema).toEqual(block.cinema);
  expect(restored.prompt).toBe(block.prompt);
  expect(canvasVideoTaskInputFingerprint(restored)).not.toBe(
    canvasVideoTaskInputFingerprint({
      ...restored,
      cinema: { ...restored.cinema!, movement: "拉远" },
    })
  );
  expect(() =>
    normalizeCanvasBlock({
      ...block,
      cinema: { ...block.cinema!, customPalette: ["invalid"] },
    })
  ).toThrow();
});
it("未采用与图片视频模式不符在网络、任务意图前拒绝", async () => {
  const fetch = vi.fn(() => {
    throw Error("禁止真实网络");
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const block = defaultCanvasBlock("video", 0, 0);
    block.cinema = digitalHumanCinemaSchema.parse({ mode: "image" });
    await expect(runCanvasBlock({} as never, block)).rejects.toThrow("采用");
    block.prompt = applyDigitalHumanCinema("场景", block.cinema);
    await expect(runCanvasBlock({} as never, block)).rejects.toThrow("模式");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("采用后的导演信息通过真实出站编译器，预览不触发网络", async () => {
  const network = vi.fn(() => {
    throw Error("禁止真实网络");
  });
  vi.stubGlobal("fetch", network);
  try {
    const cinema = digitalHumanCinemaSchema.parse({
      movement: "缓推",
      palette: "暖金",
      customLights: [
        { direction: "左侧", color: "#ffffff", brightness: 60, softness: 80 },
      ],
    });
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "cinema-test",
      videoModel: "seedance-2.5" as const,
      refImageUrl: "https://test.invalid/person.png",
      cinema,
      prompt: applyDigitalHumanCinema("人物在窗边看书。目标时长：5秒", cinema),
    };
    const result = await previewCanvasBlockOutbound(
      { userRole: "admin", optimizeCopy: async () => "" },
      block
    );
    expect(result.body.prompt).toContain("运镜：缓推");
    expect(result.body.prompt).toContain("左侧");
    expect(result.body.prompt).toContain("60%");
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
