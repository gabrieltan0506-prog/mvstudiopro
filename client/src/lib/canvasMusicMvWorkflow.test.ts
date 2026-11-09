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
    refs,
    parent.musicMv!.candidates[0]
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
  it("无任何参考的镜头拒发（不静默退回文生、不采用父节点任意图片）", async () => {
    const { requests } = offline();
    const noRefsPlan = {
      ...plan,
      shots: plan.shots.map(row => ({ ...row, referenceIndices: [] })),
    };
    const { shots, blocks, edges } = fixture(noRefsPlan);
    expect(shots[0].seedance25WorkMode).toBe("reference_to_video");
    expect(shots[0].error).toContain("请先为本镜选参考素材");
    await expect(execute(shots[0], blocks, edges, "no-ref-operation")).rejects.toThrow("缺少参考素材");
    expect(requests).toEqual([]);
  });
  it("旧参考图路径同样硬锁 reference_to_video 并带 MV 镜头身份", async () => {
    const { requests } = offline();
    const { shots, blocks, edges } = fixture();
    await execute(shots[0], blocks, edges, "legacy-ref-mode");
    expect(requests[0].workMode).toBe("reference_to_video");
    expect(requests[0].mvShot).toMatchObject({ planRequestId: "00000000-0000-4000-8000-000000000001", shotId: "shot-1" });
    expect(requests[0].version).toBe("2.0-mini");
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


describe("混合MV镜头消费（离线出站）",()=>{
  it("演唱镜头只发送对应唱段，缺少裁段时阻断",async()=>{
    const {requests}=offline();
    const singing={...plan,shots:plan.shots.map(s=>({...s,kind:"singing" as const}))};
    const {shots,blocks,edges}=fixture(singing);
    const shot=shots[0];shot.videoModel="seedance-2.5";
    await expect(execute(shot,blocks,edges,"sing-no-audio")).rejects.toThrow("准备并试听");
    expect(requests).toHaveLength(0);
    shot.musicMvShot!.singingAudio={jobId:"trim-test",gcsUri:"gs://test-bucket/singing.wav",startSec:0,endSec:5.2};
    await execute(shot,blocks,edges,"sing-ready");
    expect(requests).toHaveLength(1);
    expect(requests[0].audioUrls).toEqual(["https://test.invalid/singing.wav?signature=fresh"]);
    expect(JSON.stringify(requests[0])).not.toContain(musicUrl);
  });
  it("素材切片直接保留源视频，不能误点成付费生成",async()=>{
    const {requests}=offline();
    const sourceClip={assetId:"footage",url:"https://test.invalid/source.mp4",durationSec:30,sourceStartSec:8};
    const {shots,blocks,edges}=fixture({...plan,shots:plan.shots.map(s=>({...s,kind:"footage" as const,sourceClip}))});
    expect(shots[0].status).toBe("done");expect(shots[0].outputUrl).toBe(sourceClip.url);
    await expect(execute(shots[0],blocks,edges,"footage-no-gen")).rejects.toThrow("已有素材切片");
    expect(requests).toHaveLength(0);
  });
});


describe("1109 参考生视频：主锚图+场景图+动作参考片+歌曲切片（离线出站）", () => {
  const sf = (n: number) => `sf_${n.toString(16).padStart(48, "0")}`;
  const references = {
    "shot-1": {
      anchorImage: { assetId: sf(1), gcsUri: "gs://test-bucket/stock-footage/1/anchor.jpg" },
      sceneImages: [
        { assetId: sf(2), gcsUri: "gs://test-bucket/stock-footage/1/scene-a.jpg" },
        { assetId: sf(3), gcsUri: "gs://test-bucket/stock-footage/1/scene-b.jpg", hasRealPerson: true },
      ],
      motionVideos: [{ source: "stock" as const, assetId: sf(4), gcsUri: "gs://test-bucket/stock-footage/1/motion.mp4", inSec: 0, outSec: 5, durationSec: 12 }],
      songSlice: { jobId: "mv_slice_1", gcsUri: "gs://test-bucket/slices/shot-1.wav", startSec: 0, endSec: 5.2 },
    },
    "shot-2": {
      anchorImage: { assetId: sf(1), gcsUri: "gs://test-bucket/stock-footage/1/anchor.jpg" },
      sceneImages: [],
      motionVideos: [],
      songSlice: { jobId: "mv_slice_2", gcsUri: "gs://test-bucket/slices/shot-2.wav", startSec: 5.2, endSec: 10.3 },
    },
  };
  function fixtureWithRefs() {
    const { blocks, edges } = fixture();
    const parent = blocks[0];
    const shots = createMusicMvShotBlocks(parent, plan, "00000000-0000-4000-8000-000000000001", refs, parent.musicMv!.candidates[0], references);
    return { shots, blocks: [parent, ...shots], edges: shots.map(row => ({ fromId: parent.id, toId: row.id })) };
  }
  it("完整参考：@图片1 主锚图在首位，视频/音频进各自数组，workMode=reference_to_video，含真人标记上送", async () => {
    const { requests } = offline();
    const { shots, blocks, edges } = fixtureWithRefs();
    expect(shots[0].error).toBeUndefined();
    expect(shots[0].musicMvShot?.references?.anchorImage?.assetId).toBe(sf(1));
    await execute(shots[0], blocks, edges, "ref-full");
    expect(requests).toHaveLength(1);
    const body = requests[0];
    expect(body.workMode).toBe("reference_to_video");
    expect(body.imageUrls).toEqual([
      "https://test.invalid/anchor.jpg?signature=fresh",
      "https://test.invalid/scene-a.jpg?signature=fresh",
      "https://test.invalid/scene-b.jpg?signature=fresh",
    ]);
    expect(body.videoUrls).toEqual(["https://test.invalid/motion.mp4?signature=fresh"]);
    expect(body.audioUrls).toEqual(["https://test.invalid/shot-1.wav?signature=fresh"]);
    expect(String(body.prompt)).toContain(plan.shots[0].visualPrompt);
    expect(String(body.prompt)).toMatch(/@图片1定义全片/);
    expect(String(body.prompt)).toMatch(/@视频1是运镜参考片/);
    expect(String(body.prompt)).toMatch(/@音频1是本镜 0–5.2 秒的歌曲切片/);
    expect(body.mvShot).toEqual({
      planRequestId: "00000000-0000-4000-8000-000000000001",
      shotId: "shot-1",
      hasRealPerson: true,
      referenceCounts: { image: 3, video: 1, audio: 1 },
    });
    expect(JSON.stringify(body)).not.toContain(musicUrl);
  });
  it("只有主锚图+切片、没有场景图也没有参考片 → 铺镜头标缺项，出片拒发", async () => {
    const { requests } = offline();
    const { shots, blocks, edges } = fixtureWithRefs();
    expect(shots[1].error).toContain("缺本镜场景图或动作参考片");
    await expect(execute(shots[1], blocks, edges, "ref-gap")).rejects.toThrow("参考素材不完整");
    expect(requests).toEqual([]);
  });
});
