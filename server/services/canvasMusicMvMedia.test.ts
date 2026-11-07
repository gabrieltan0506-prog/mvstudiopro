import { describe, expect, it, vi } from "vitest";
import {
  resolveCanvasMusicMvAudio,
  resolveCanvasMusicMvVideo,
} from "./canvasMusicMvMedia";
import {
  extractSystemObjectName,
  resolveRegisteredPostProdMediaSource,
} from "./postProdMediaSource";
import { buildGrowthCampVideoObjectName } from "./gcs";
import { scoringBgmObjectName } from "./manhuaScoringRoom";

const bucket = "test-bucket";
const musicObject = scoringBgmObjectName("7", "ttapi:suno:test-task", 1);
const videoObject = buildGrowthCampVideoObjectName("seedance-result.mp4");
const musicUri = `gs://${bucket}/${musicObject}`;
const audio = {
  id: "bgm_abc:1",
  url: `https://storage.googleapis.com/${bucket}/${musicObject}?signature=new`,
  gcsUri: musicUri,
  durationSec: 20,
};
function fixture(nested = false) {
  const terminal = {
    variants: [
      {
        index: 0,
        gcsUri: `gs://${bucket}/post-prod/7/bgm/first.mp3`,
        bytes: 200,
        durationSec: 21,
      },
      { index: 1, gcsUri: musicUri, bytes: 300, durationSec: 20 },
    ],
  };
  const job = {
    id: "bgm_abc",
    userId: "7",
    type: "audio",
    status: "succeeded",
    input: { action: "manhua_bgm_v55" },
    output: nested ? { terminalOutput: terminal } : terminal,
  };
  const video = {
    taskId: "canvas-task",
    userId: 7,
    status: "succeeded",
    videoUrl: `https://storage.googleapis.com/${bucket}/${videoObject}?signature=old`,
  };
  const d = {
    bucket: () => bucket,
    job: vi.fn(async () => job),
    video: vi.fn(async () => video),
    // 使用真实公共登记解析器，不把权限消费整体替换成恒成功 mock。
    registered: (input: { userId: string; source: string }) =>
      resolveRegisteredPostProdMediaSource(input, {
        getBucket: () => bucket,
        verifyOwnership: async () => false,
        loadSucceededJobOutputObjects: async () => new Set<string>(),
        loadSucceededJobOutputUrls: async () => new Set<string>(),
      }),
  };
  return { d, job, video };
}
describe("MV 按实际音乐/视频生产者授权", () => {
  it("真实音乐对象命名属于本人后期前缀，原resolver确实放行", async () => {
    expect(musicObject.startsWith("post-prod/7/bgm/")).toBe(true);
    expect(
      await fixture().d.registered({ userId: "7", source: musicUri })
    ).toBe(musicUri);
  });
  it.each([false, true])(
    "完整读取第2音乐变体，兼容 terminalOutput=%s",
    async nested => {
      const { d } = fixture(nested);
      expect(
        await resolveCanvasMusicMvAudio(7, audio, undefined, d as any)
      ).toBe(musicUri);
      expect(d.job).toHaveBeenCalledWith("bgm_abc");
    }
  );
  it("自产视频无jobs/登记记录，按本人CanvasVideoTask成功产物闭合", async () => {
    const { d, video } = fixture();
    const clip = {
      taskId: video.taskId,
      url: video.videoUrl.replace("signature=old", "signature=new"),
    };
    await expect(
      d.registered({ userId: "7", source: clip.url })
    ).rejects.toThrow();
    expect(await resolveCanvasMusicMvVideo(7, clip, d as any)).toBe(
      `gs://${bucket}/${videoObject}`
    );
    expect(d.video).toHaveBeenCalledWith("canvas-task", 7);
  });
  it("上传素材继续用真实登记门禁；跨用户上传拒绝", async () => {
    const { d } = fixture();
    expect(
      await resolveCanvasMusicMvVideo(
        7,
        { url: `gs://${bucket}/uploads/u7/uuid.mp4` },
        d as any
      )
    ).toBe(`gs://${bucket}/uploads/u7/uuid.mp4`);
    await expect(
      resolveCanvasMusicMvVideo(
        7,
        { url: `gs://${bucket}/uploads/u8/uuid.mp4` },
        d as any
      )
    ).rejects.toThrow();
  });
  it("拒绝他人、未成功视频、伪造任务URL、跨桶与外部URL", async () => {
    const { d, video } = fixture();
    await expect(
      resolveCanvasMusicMvVideo(
        8,
        { taskId: video.taskId, url: video.videoUrl },
        d as any
      )
    ).rejects.toThrow();
    for (const url of [
      video.videoUrl.replace("result", "other"),
      "http://127.0.0.1/file",
      "https://external.test/file",
      "gs://other/video.mp4",
    ]) {
      await expect(
        resolveCanvasMusicMvVideo(7, { taskId: video.taskId, url }, d as any)
      ).rejects.toThrow();
    }
    video.status = "running";
    await expect(
      resolveCanvasMusicMvVideo(
        7,
        { taskId: video.taskId, url: video.videoUrl },
        d as any
      )
    ).rejects.toThrow();
  });
  it("音乐不允许换变体、偷换时长、空产物、跨用户或别的job", async () => {
    const { d, job } = fixture();
    await expect(
      resolveCanvasMusicMvAudio(8, audio, undefined, d as any)
    ).rejects.toThrow();
    await expect(
      resolveCanvasMusicMvAudio(7, audio, "bgm_other", d as any)
    ).rejects.toThrow();
    await expect(
      resolveCanvasMusicMvAudio(
        7,
        { ...audio, durationSec: 30 },
        undefined,
        d as any
      )
    ).rejects.toThrow();
    await expect(
      resolveCanvasMusicMvAudio(
        7,
        { ...audio, id: "bgm_abc:0" },
        undefined,
        d as any
      )
    ).rejects.toThrow();
    (job.output as any).variants[1].bytes = 0;
    await expect(
      resolveCanvasMusicMvAudio(7, audio, undefined, d as any)
    ).rejects.toThrow();
  });
  it("稳定对象归一不把签名变化视为另一个文件", () => {
    expect(extractSystemObjectName(audio.url, bucket)).toBe(musicObject);
  });
});

describe("MV 图库素材凭本人采用记录授权", () => {
  const assetId = `sf_${"c".repeat(48)}`;
  const gcsUri = `gs://${bucket}/stock-footage/7/${assetId}.mp4`;
  const owned = {
    assetId,
    kind: "video",
    purpose: "mv",
    usage: "insert",
    gcsUri,
    durationSec: 8,
  };
  const withStock = (asset: Record<string, unknown> | Error) => {
    const { d } = fixture();
    const stock = vi.fn(async (userId: number, id: string) => {
      if (asset instanceof Error) throw asset;
      if (userId !== 7 || id !== assetId) throw new Error("not owned");
      return asset;
    });
    return { d: { ...d, stock }, stock };
  };
  it("正向：assetId 查到本人MV入片资产，返回资产gcsUri（签名地址也归一）", async () => {
    const { d, stock } = withStock(owned);
    expect(
      await resolveCanvasMusicMvVideo(7, { url: gcsUri, taskId: assetId, durationSec: 8 }, d as any)
    ).toBe(gcsUri);
    expect(
      await resolveCanvasMusicMvVideo(
        7,
        { url: `https://storage.googleapis.com/${bucket}/stock-footage/7/${assetId}.mp4?sig=1`, taskId: assetId },
        d as any
      )
    ).toBe(gcsUri);
    expect(stock).toHaveBeenCalledWith(7, assetId);
  });
  it("反向：他人/未采用、换URL、改时长、参考用途、非MV、照片均拒绝", async () => {
    await expect(
      resolveCanvasMusicMvVideo(8, { url: gcsUri, taskId: assetId }, withStock(owned).d as any)
    ).rejects.toThrow();
    await expect(
      resolveCanvasMusicMvVideo(7, { url: gcsUri, taskId: assetId }, withStock(new Error("未成功采用")).d as any)
    ).rejects.toThrow("未成功采用");
    for (const url of [`gs://${bucket}/uploads/u7/other.mp4`, "https://videos.pexels.com/x.mp4", `gs://other/stock.mp4`])
      await expect(
        resolveCanvasMusicMvVideo(7, { url, taskId: assetId }, withStock(owned).d as any)
      ).rejects.toThrow();
    await expect(
      resolveCanvasMusicMvVideo(7, { url: gcsUri, taskId: assetId, durationSec: 9 }, withStock(owned).d as any)
    ).rejects.toThrow("时长");
    for (const bad of [{ usage: "reference" }, { purpose: "marketing" }, { kind: "photo" }, { gcsUri: `gs://other/${assetId}.mp4` }])
      await expect(
        resolveCanvasMusicMvVideo(7, { url: gcsUri, taskId: assetId }, withStock({ ...owned, ...bad }).d as any)
      ).rejects.toThrow();
  });
});
