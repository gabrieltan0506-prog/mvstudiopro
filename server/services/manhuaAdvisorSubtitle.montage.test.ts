import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  generate: vi.fn(),
  upload: vi.fn(async () => ({})),
}));
vi.mock("./gcs", () => ({
  inspectGcsObjectBounded: async ({ onChunk }: any) =>
    onChunk(Buffer.from("0000ftyp0000test")),
  uploadBufferToGcs: h.upload,
}));
vi.mock("./postProdMediaSource", () => ({
  resolvePostProdInputSources: async ({ input }: any) => input,
}));
vi.mock("./manhuaAdvisorBgmMix", () => ({
  generateGeminiBgmAnalysis: h.generate,
  MANHUA_BGM_ADVISOR_MODEL: "test-model",
}));
import { askManhuaSubtitleReview } from "./manhuaAdvisorSubtitle";
const plan = {
  sourceDurationSec: 5,
  summary: "原片结构",
  sourceSrt: "",
  uncertainties: [],
  plans: ["预告", "短版"].map(title => ({
    title,
    kind: "short",
    rationale: "保留完整动作",
    cuts: [
      { startSec: 0, endSec: 5, reason: "动作完成", evidence: "放下杯子" },
    ],
  })),
  creativeDirections: ["回望", "观察"].map(title => ({
    title,
    evidence: "放下杯子",
    difference: "改变讲述主体",
  })),
};
it("完整原片送现有模型，保存原始回执并校验返回方案", async () => {
  h.generate.mockResolvedValue({
    text: JSON.stringify({ answer: JSON.stringify(plan) }),
  });
  const result = await askManhuaSubtitleReview(7, {
    videoUri: "gs://test/clip.mp4",
    dialogue: "已确认",
    montageTargetSec: 30,
  });
  expect(JSON.parse(JSON.parse(result).answer).plans).toHaveLength(2);
  expect(
    h.generate.mock.calls[0][0].contents[0].parts[1].inlineData.mimeType
  ).toBe("video/mp4");
  expect(h.generate.mock.calls[0][0].config.systemInstruction).toContain(
    "音乐变化"
  );
  expect(h.upload).toHaveBeenCalledTimes(1);
  h.generate.mockResolvedValue({
    text: JSON.stringify({
      answer: JSON.stringify({ ...plan, sourceDurationSec: 1 }),
    }),
  });
  await expect(
    askManhuaSubtitleReview(7, {
      videoUri: "gs://test/clip.mp4",
      dialogue: "已确认",
      montageTargetSec: 30,
    })
  ).rejects.toThrow();
  expect(h.generate).toHaveBeenCalledTimes(2);
});
it("普通字幕核对保留原合同", async () => {
  h.generate.mockResolvedValue({
    text: JSON.stringify({ answer: "原字幕报告" }),
  });
  expect(
    JSON.parse(
      await askManhuaSubtitleReview(7, {
        videoUri: "gs://test/clip.mp4",
        dialogue: "已确认",
      })
    ).answer
  ).toBe("原字幕报告");
  expect(h.generate.mock.calls.at(-1)![0].config.systemInstruction).toContain(
    "字幕对齐核对"
  );
});
