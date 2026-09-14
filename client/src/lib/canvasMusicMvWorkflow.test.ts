import { afterEach, describe, expect, it, vi } from "vitest";
import { createMusicMvShotBlocks } from "./canvasMusicMvWorkflow";
import {
  defaultCanvasBlock,
  collectVisionImages,
  collectUpstreamTexts,
  type CanvasBlock,
} from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import {
  buildLocalCloudDraftSnapshot,
  cloudDraftBlocksToCanvas,
  serializeCloudDraftForUpload,
} from "./manhuaCloudDraftSync";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import type { CanvasMusicMvPlan } from "@shared/canvasMusicMv";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: vi.fn(async () => ({ frames: [] })),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const musicUrl = "https://test.invalid/song.mp3";
const refs = ["hero", "scene"].map(name => ({
  id: name,
  fileName: `${name}.png`,
  url: `https://test.invalid/${name}.png?signature=expired`,
  gcsUri: `gs://test-bucket/${name}.png`,
}));
const plan: CanvasMusicMvPlan = {
  version: 1,
  audioId: "song",
  audioDurationSec: 10.3,
  analysisBasis: "lyrics_and_user_description",
  shots: [
    {
      id: "shot-1",
      startSec: 0,
      endSec: 5.2,
      visualPrompt: "女主穿过雨夜街道",
      cameraPrompt: "侧面跟拍",
      lyricQuote: "",
      referenceIndices: [1],
    },
    {
      id: "shot-2",
      startSec: 5.2,
      endSec: 10.3,
      visualPrompt: "女主在屋檐下停步",
      cameraPrompt: "缓慢推进",
      lyricQuote: "",
      referenceIndices: [0],
    },
  ],
};
function fixture(selectedPlan = plan) {
  const parent: CanvasBlock = {
    ...defaultCanvasBlock("music", 0, 0),
    id: "music-root",
    outputUrl: musicUrl,
    outputUrls: [musicUrl],
    uploadedAssets: refs.map(row => ({
      ...row,
      kind: "image" as const,
      previewUrl: row.url,
    })),
    musicMv: {
      status: "planned",
      candidates: [{ id: "song", url: musicUrl, durationSec: 10.3 }],
      selectedCandidateId: "song",
      plan: selectedPlan,
      referenceImages: refs,
    },
  };
  const shots = createMusicMvShotBlocks(
    parent,
    selectedPlan,
    "00000000-0000-4000-8000-000000000001",
    refs
  );
  return {
    blocks: [parent, ...shots],
    shots,
    edges: shots.map(row => ({ fromId: parent.id, toId: row.id })),
  };
}
function offline(options: { failSign?: boolean } = {}) {
  const requests: Record<string, unknown>[] = [];
  const signed: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const match = /^\/api\/google\?op=materialReadUrl&gcsUri=(.+)$/.exec(url);
      if (match) {
        const identity = decodeURIComponent(match[1]);
        signed.push(identity);
        if (options.failSign)
          return new Response(
            JSON.stringify({ ok: false, error: "无权访问" }),
            { status: 403 }
          );
        return new Response(
          JSON.stringify({
            ok: true,
            url: `https://test.invalid/${identity.split("/").pop()}?signature=fresh`,
          })
        );
      }
      if (url !== "/api/jobs?op=seedanceI2V" || init?.method !== "POST")
        throw new Error(`禁止任何真实网络：${url}`);
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          ok: true,
          videoUrl: "https://test.invalid/result.mp4",
        })
      );
    })
  );
  return { requests, signed };
}
async function execute(
  shot: CanvasBlock,
  blocks: CanvasBlock[],
  edges: Array<{ fromId: string; toId: string }>,
  key: string
) {
  return runCanvasBlock(
    { userRole: "admin", optimizeCopy: async () => "" },
    shot,
    {
      visionImages: collectVisionImages(shot.id, blocks, edges),
      texts: collectUpstreamTexts(shot.id, blocks, edges),
    },
    { videoSubmissionKey: key }
  );
}

describe("MV 分镜编译到真实视频出站请求（全离线）", () => {
  it("5.2秒与5.1秒镜头均提交6秒，只带各自指定图且不带整首音频", async () => {
    const { requests } = offline();
    const { shots, blocks, edges } = fixture();
    for (const [index, shot] of Array.from(shots.entries()))
      await execute(shot, blocks, edges, `mv-operation-${index}`);
    expect(requests.map(row => row.duration)).toEqual([6, 6]);
    expect(String(requests[0].prompt)).toContain(plan.shots[0].visualPrompt);
    expect(String(requests[0].prompt)).not.toContain(
      plan.shots[1].visualPrompt
    );
    expect(String(requests[1].prompt)).toContain(plan.shots[1].visualPrompt);
    expect(String(requests[1].prompt)).not.toContain(
      plan.shots[0].visualPrompt
    );
    expect(requests.map(row => row.imageUrls)).toEqual([
      ["https://test.invalid/scene.png?signature=fresh"],
      ["https://test.invalid/hero.png?signature=fresh"],
    ]);
    expect(requests.map(row => row.idempotencyKey)).toEqual([
      "mv-operation-0",
      "mv-operation-1",
    ]);
    for (const row of requests) {
      expect(row.audioUrls).toBeUndefined();
      expect(row.videoUrls).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain(musicUrl);
    }
  });
  it("未选参考的镜头不会静默采用音乐父节点的任意图片", async () => {
    const { requests } = offline();
    const noRefsPlan = {
      ...plan,
      shots: plan.shots.map(row => ({ ...row, referenceIndices: [] })),
    };
    const { shots, blocks, edges } = fixture(noRefsPlan);
    await execute(shots[0], blocks, edges, "no-ref-operation");
    expect(requests[0].imageUrls).toBeUndefined();
    expect(requests[0].imageUrl).toBeUndefined();
  });
  it("选定参考续签失败会阻断提交，不降级使用旧签名", async () => {
    const { requests } = offline({ failSign: true });
    const { shots, blocks, edges } = fixture();
    await expect(
      execute(shots[0], blocks, edges, "failed-sign-operation")
    ).rejects.toThrow();
    expect(requests).toEqual([]);
  });
  it("完整云恢复后凭选定图的GCS身份续签，过期URL不得进入POST", async () => {
    const { requests, signed } = offline();
    const { blocks, edges } = fixture();
    const snapshot = buildLocalCloudDraftSnapshot({
      writerSession: {},
      blocks,
      edges,
    });
    const restored = cloudDraftBlocksToCanvas(
      parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(snapshot))!
        .canvas.blocks
    );
    const shot = restored[1];
    await execute(shot, restored, edges, "restored-operation");
    expect(signed).toContain(refs[1].gcsUri);
    expect(requests[0].imageUrls).toEqual([
      "https://test.invalid/scene.png?signature=fresh",
    ]);
    expect(JSON.stringify(requests[0])).not.toContain("signature=expired");
  });
});
