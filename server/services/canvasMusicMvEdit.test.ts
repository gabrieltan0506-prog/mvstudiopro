import { describe, it, expect, vi } from "vitest";
import {
  saveMusicMvEdit,
  getMusicMvEdit,
  type MusicMvEditDeps,
} from "./canvasMusicMvEdit";
import { musicMvEditDocumentSchema } from "../../shared/canvasMusicMvEdit";
const base = "11111111-1111-4111-8111-111111111111",
  revision = "22222222-2222-4222-8222-222222222222";
const doc = () =>
  musicMvEditDocumentSchema.parse({
    version: 1,
    fps: 30,
    basePlanRequestId: base,
    audioId: "song",
    audioDurationSec: 5,
    clips: [
      {
        id: "edit-a",
        shotId: "a",
        blockId: "b",
        title: "街道",
        kind: "footage",
        sourceInFrame: 30,
        durationFrames: 150,
        source: { url: "gs://test/footage.mp4", durationSec: 10 },
      },
    ],
  });
function fixture() {
  const store = new Map<string, unknown>();
  const sourceClip = {
    assetId: "f",
    url: "gs://test/footage.mp4",
    durationSec: 10,
    sourceStartSec: 1,
  };
  const audio = {
    id: "song",
    url: "https://example.test/song.mp3",
    durationSec: 5,
  };
  store.set(`canvas-music-mv/evidence/7/${base}/result.json`, {
    input: {
      requestId: base,
      audio,
      lyrics: "",
      creativePrompt: "街道",
      referenceSummaries: [],
    },
    plan: {
      version: 1,
      audioId: "song",
      audioDurationSec: 5,
      analysisBasis: "lyrics_and_user_description",
      shots: [
        {
          id: "a",
          startSec: 0,
          endSec: 5,
          kind: "footage",
          visualPrompt: "街道",
          cameraPrompt: "固定",
          lyricQuote: "",
          referenceIndices: [],
          sourceClip,
        },
      ],
    },
  });
  store.set(`canvas-music-mv/evidence/7/${base}/settled.json`, {
    settled: true,
  });
  const mocks = {
    bucket: () => "test",
    download: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
      const key = gcsUri.replace("gs://test/", "");
      if (!store.has(key)) throw new Error("gcs_download_failed:404");
      return { buffer: Buffer.from(JSON.stringify(store.get(key))) };
    }),
    upload: vi.fn(
      async ({
        objectName,
        buffer,
      }: {
        objectName: string;
        buffer: Buffer;
      }) => {
        if (store.has(objectName)) return { created: false };
        store.set(objectName, JSON.parse(buffer.toString()));
        return { created: true };
      }
    ),
    resolveAudio: vi.fn(async () => "gs://test/song.mp3"),
    resolveVideo: vi.fn(async (_user: number, s: { url: string }) => s.url),
    probe: vi.fn(async () => ({ durationSec: 10, width: 1280, height: 720 })),
  };
  return { store, mocks, d: mocks as unknown as MusicMvEditDeps };
}
describe("剪辑不可变保存与来源核对", () => {
  it("保存原裁点并恢复，同编号重试不重复探测和写入", async () => {
    const { d, mocks } = fixture();
    const r = await saveMusicMvEdit(
      7,
      { revisionId: revision, document: doc() },
      d
    );
    expect(r.document.clips[0].sourceInFrame).toBe(30);
    expect(
      await getMusicMvEdit(
        7,
        { revisionId: revision, basePlanRequestId: base },
        d
      )
    ).toEqual(r);
    expect(
      await saveMusicMvEdit(7, { revisionId: revision, document: doc() }, d)
    ).toEqual(r);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
  it("旧版本不被同编号新裁点覆盖，其他账号不能读取", async () => {
    const { d } = fixture();
    await saveMusicMvEdit(7, { revisionId: revision, document: doc() }, d);
    const changed = doc();
    changed.clips[0].sourceInFrame = 60;
    await expect(
      saveMusicMvEdit(7, { revisionId: revision, document: changed }, d)
    ).rejects.toThrow("另一剪辑内容");
    await expect(
      getMusicMvEdit(8, { revisionId: revision, basePlanRequestId: base }, d)
    ).rejects.toThrow("不属于");
  });
  it("假时长或替换已采用素材在保存前拒绝", async () => {
    const { d, mocks } = fixture();
    mocks.probe.mockResolvedValueOnce({
      durationSec: 3,
      width: 1280,
      height: 720,
    });
    await expect(
      saveMusicMvEdit(7, { revisionId: revision, document: doc() }, d)
    ).rejects.toThrow("时长");
    const wrong = doc();
    wrong.clips[0].source!.url = "gs://test/another.mp4";
    await expect(
      saveMusicMvEdit(7, { revisionId: revision, document: wrong }, d)
    ).rejects.toThrow("身份");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("未采用计划禁止保存，证据被改动禁止恢复", async () => {
    const { d, store } = fixture();
    store.delete(`canvas-music-mv/evidence/7/${base}/settled.json`);
    await expect(
      saveMusicMvEdit(7, { revisionId: revision, document: doc() }, d)
    ).rejects.toThrow("尚未采用");
  });
});
