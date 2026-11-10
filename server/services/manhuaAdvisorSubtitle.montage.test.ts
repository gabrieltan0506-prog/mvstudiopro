import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ created: true })),
}));
vi.mock("./gcs", () => ({
  inspectGcsObjectBounded: async () => ({ header: Buffer.from("0000ftyp0000test"), sha256: "a".repeat(64), byteLength: 16 }),
  uploadBufferToGcsIfAbsent: h.upload,
  signGsUriV4ReadUrl: (u: string) => `https://signed.example/${u.slice(5)}`,
}));
vi.mock("./postProdMediaSource", () => ({
  resolvePostProdInputSources: async ({ input }: any) => input,
}));
vi.mock("./manhuaAdvisorBgmMix", () => ({
  MANHUA_BGM_ADVISOR_MODEL: "gemini-3.8-flash",
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
/** 两跳函数替身：answer 文本由 reply 提供，真实 validate 与 save 都跑。 */
const fakeListen = (reply: () => unknown) => vi.fn(async (input: any) => {
  const decoded = reply();
  const value = input.validate(decoded);
  await input.save("hop-1-vertex-parsed", value);
  return { value, channel: "Vertex", model: input.model, failuresZh: [], payload: {} };
});
const deps = (listen: any) => ({ listen, sign: (u: string) => `https://signed.example/${u.slice(5)}`, upload: h.upload as any, uuid: () => "u1" });
it("完整原片以 gs:// 引用送两跳（gemini-3.8-flash），解析后的剪辑方案单独存档", async () => {
  const listen = fakeListen(() => ({ answer: JSON.stringify(plan) }));
  const result = await askManhuaSubtitleReview(7, { videoUri: "gs://test/clip.mp4", dialogue: "已确认", montageTargetSec: 30 }, deps(listen));
  expect(JSON.parse(JSON.parse(result).answer).plans).toHaveLength(2);
  const call = listen.mock.calls[0][0];
  expect([call.mimeType, call.model, call.media.vertexFileUri, call.audioBase64]).toEqual(["video/mp4", "gemini-3.8-flash", "gs://test/clip.mp4", undefined]);
  expect(call.systemInstruction).toContain("音乐变化");
  expect(h.upload.mock.calls.map((c: any) => c[0].objectName.split("/").at(-1))).toEqual(["request.json", "hop-1-vertex-parsed.json", "montage-plan-parsed.json"]);
  const bad = fakeListen(() => ({ answer: JSON.stringify({ ...plan, sourceDurationSec: 1 }) }));
  await expect(askManhuaSubtitleReview(7, { videoUri: "gs://test/clip.mp4", dialogue: "已确认", montageTargetSec: 30 }, deps(bad))).rejects.toThrow();
  expect(bad).toHaveBeenCalledTimes(1);
});
it("普通字幕核对保留原合同", async () => {
  const listen = fakeListen(() => ({ answer: "原字幕报告" }));
  expect(JSON.parse(await askManhuaSubtitleReview(7, { videoUri: "gs://test/clip.mp4", dialogue: "已确认" }, deps(listen))).answer).toBe("原字幕报告");
  expect(listen.mock.calls.at(-1)![0].systemInstruction).toContain("字幕对齐核对");
});
