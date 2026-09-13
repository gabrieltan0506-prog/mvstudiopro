import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../client/src/lib/extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: vi.fn(async () => ({ frames: [] })),
  extractVideoFramesFromUrl: vi.fn(),
}));
vi.mock("../client/src/lib/videoUpscaleApi", () => ({
  probeVideoDurationSec: vi.fn(async () => 5),
}));
vi.mock("../client/src/lib/flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("../client/src/lib/longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
import {
  createManhuaPrevisStudio,
  formatPrevisMotionGuide,
  manhuaPrevisSpecSchema,
} from "./manhuaPrevis";
import {
  normalizeManhuaSegmentReferenceEntry,
  setManhuaSegmentReference,
} from "./manhuaSegmentReference";
import {
  sanitizeManhuaCloudDraftBlock,
  serializeManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";
import {
  defaultCanvasBlock,
  normalizeCanvasBlock,
} from "../client/src/lib/canvasTypes";
import { cloudDraftBlocksToCanvas } from "../client/src/lib/manhuaCloudDraftSync";
import { runCanvasBlock } from "../client/src/lib/canvasRunBlock";

function adoptedFixture() {
  const studio = createManhuaPrevisStudio(
    5,
    "11111111-1111-4111-8111-111111111111"
  );
  const actor = studio.spec.actors[0];
  actor.nameZh = "阿菁";
  actor.assetRef = "character-test";
  actor.riggedModel = {
    sourceJobId: "m3d_TEST_ONLY_saved",
    forwardAxis: "+X",
    targetHeight: 1.7,
    performance: {
      controller: {
        eyeBones: { left: "Eye.L", right: "Eye.R" },
        expressions: {
          calm: { Relax: 1 },
          tense: { Tense: 1 },
          surprised: { Surprise: 1 },
        },
      },
      cues: (["calm", "tense", "surprised"] as const).map(
        (expression, index) => ({
          startSec: index === 0 ? 0 : index === 1 ? 1 : 3,
          endSec: index === 0 ? 1 : index === 1 ? 3 : 5,
          gazeTarget: [3, 1, 1.8],
          headYawDeg: 25,
          headPitchDeg: 10,
          breathAmplitude: 0.025,
          breathHz: 0.5,
          expression,
          intensity: 0.8,
        })
      ),
    },
  };
  studio.spec = manhuaPrevisSpecSchema.parse(studio.spec);
  const take = {
    jobId: "prv_TEST_ONLY",
    requestId: "22222222-2222-4222-8222-222222222222",
    gcsUri: "gs://test-bucket/post-prod/1/previs.mp4",
    url: "https://test.invalid/previs.mp4",
    durationSec: 5,
    createdAt: "2026-09-13",
    spec: structuredClone(studio.spec),
  };
  studio.history.push(take);
  studio.selectedJobId = take.jobId;
  // 使用正式adopt相同的候选快照字段；真实按钮点击由独立浏览器回归覆盖。
  const reference = normalizeManhuaSegmentReferenceEntry({
    url: take.url,
    gcsUri: take.gcsUri,
    durationSec: take.durationSec,
    updatedAt: take.createdAt,
    motionGuideZh: formatPrevisMotionGuide(take.spec),
  })!;
  const block = setManhuaSegmentReference(
    {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01",
      episodeIndex: 1,
      refImageUrl: "https://test.invalid/keyart.png",
      prompt: "【第1段·5s】0–5s：阿菁依次表现平静、紧张和惊讶。",
      previsStudio: studio,
    },
    "previs",
    reference
  );
  return { studio, take, reference, block };
}
const expectedFragments = [
  "阿菁（character-test）",
  "m3d_TEST_ONLY_saved",
  "0—1秒",
  "1—3秒",
  "3—5秒",
  "3，1，1.8",
  "左右25度",
  "俯仰10度",
  "呼吸幅度0.025",
  "每秒0.5周期",
  "平静表情强度0.8",
  "紧张表情强度0.8",
  "惊讶表情强度0.8",
  "不继承测试网格或改变服装",
  "模型接地和双人接触不能按源白模误差推定通过",
];
let requests: Array<Record<string, unknown>>;
beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/google?op=materialReadUrl&gcsUri="))
        return new Response(
          JSON.stringify({
            ok: true,
            url: "https://test.invalid/refreshed-previs.mp4",
          })
        );
      if (
        !["/api/jobs?op=seedanceI2V", "/api/jobs?op=wan30Video"].includes(
          url
        ) ||
        init?.method !== "POST"
      )
        throw new Error(`禁止真实网络：${url}`);
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          ok: true,
          videoUrl: "https://test.invalid/result.mp4",
        })
      );
    })
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("角色表演指引到正式出站请求（全离线）", () => {
  it("24段表演容量边界保留至最后一段，不只保留前几段", async () => {
    const f = adoptedFixture();
    const spec = structuredClone(f.take.spec);
    spec.durationSec = 12;
    spec.cameras[0].endSec = 12;
    spec.actors[0].moveEndSec = 12;
    const performance = spec.actors[0].riggedModel!.performance!;
    performance.cues = Array.from({ length: 24 }, (_, index) => ({
      ...performance.cues[0],
      startSec: index / 2,
      endSec: (index + 1) / 2,
      intensity: (index + 1) / 24,
    }));
    const guide = formatPrevisMotionGuide(manhuaPrevisSpecSchema.parse(spec));
    const block = setManhuaSegmentReference(
      {
        ...f.block,
        videoModel: "wan-3.0" as const,
        prompt: "【第1段·12s】0–12s：阿菁按参考表演。",
      },
      "previs",
      { ...f.reference, durationSec: 12, motionGuideZh: guide }
    );
    await runCanvasBlock(
      { userId: "test-user", userRole: "admin", optimizeCopy: async () => "" },
      block
    );
    expect(requests).toHaveLength(1);
    expect(String(requests[0].prompt)).toContain(guide);
    for (const cue of performance.cues)
      expect(String(requests[0].prompt)).toContain(
        `${cue.startSec}—${cue.endSec}秒`
      );
  });
  it("生成身份、全部cue与未验边界，采用使用候选快照而非当前编辑", () => {
    const f = adoptedFixture(),
      guide = f.reference.motionGuideZh!;
    for (const fragment of expectedFragments) expect(guide).toContain(fragment);
    f.studio.spec.actors[0].riggedModel!.performance!.cues[0].headYawDeg = -35;
    expect(f.reference.motionGuideZh).toBe(guide);
    expect(f.reference.motionGuideZh).not.toContain("左右-35度");
  });
  it.each(["seedance-2.5", "seedance-2.0-mini", "wan-3.0"] as const)(
    "%s经本机/云草稿往返后把完整指引发到构建输入，不静默strip",
    async videoModel => {
      const f = adoptedFixture();
      const block = normalizeCanvasBlock({ ...f.block, videoModel });
      const payload = {
        format: "mv-manhua-cloud-draft-v1",
        clientUpdatedAt: "2026-09-13",
        writerSession: {},
        canvas: { blocks: [sanitizeManhuaCloudDraftBlock(block)!], edges: [] },
      } as unknown as ManhuaCloudDraftPayload;
      const parsed = parseManhuaCloudDraftPayload(
        serializeManhuaCloudDraftPayload(payload)
      )!;
      const restored = cloudDraftBlocksToCanvas(parsed.canvas.blocks)[0];
      expect(restored.manhuaSegmentRefs?.previs?.motionGuideZh).toBe(
        f.reference.motionGuideZh
      );
      expect(
        restored.previsStudio?.history[0].spec.actors[0].riggedModel
      ).toEqual(f.take.spec.actors[0].riggedModel);
      await runCanvasBlock(
        {
          userId: "test-user",
          userRole: "admin",
          optimizeCopy: async () => "",
        },
        restored
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].videoUrls).toEqual([
        "https://test.invalid/refreshed-previs.mp4",
      ]);
      for (const fragment of expectedFragments)
        expect(String(requests[0].prompt)).toContain(fragment);
      expect(String(requests[0].prompt)).not.toContain("/Users/");
    }
  );
});
