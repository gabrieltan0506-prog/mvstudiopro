import { describe, expect, it, vi } from "vitest";
import { draftCanvasMusicMvPlan, type MusicMvPlanDeps } from "./canvasMusicMv";
import {
  canvasMusicMvStateSchema,
  validateCanvasMusicMvPlan,
} from "../../shared/canvasMusicMv";

const input = {
  requestId: "11111111-1111-4111-8111-111111111111",
  audio: { id: "song-2", url: "https://example.test/a.mp3", durationSec: 20 },
  lyrics: "回家吧",
  creativePrompt: "雨中归途",
  referenceSummaries: ["主角穿蓝外套"],
};
function plan() {
  return {
    version: 1,
    audioId: "song-2",
    audioDurationSec: 20,
    analysisBasis: "lyrics_and_user_description",
    shots: [
      {
        id: "s1",
        startSec: 0,
        endSec: 10,
        visualPrompt: "主角沿雨巷归家",
        cameraPrompt: "低机位缓慢跟拍",
        lyricQuote: "回家吧",
        referenceIndices: [0],
      },
      {
        id: "s2",
        startSec: 10,
        endSec: 20,
        visualPrompt: "主角打开门与家人拥抱",
        cameraPrompt: "缓慢推近面部",
        lyricQuote: "",
        referenceIndices: [],
      },
    ],
  };
}
function fixture(invalid = false) {
  const records = new Map<string, Buffer>();
  const events: string[] = [];
  const d = {
    bucket: () => "test-bucket",
    upload: vi.fn(
      async ({
        objectName,
        buffer,
      }: {
        objectName: string;
        buffer: Buffer;
      }) => {
        if (records.has(objectName)) return { created: false };
        records.set(objectName, buffer);
        events.push(objectName.split("/").at(-1)!);
        return { created: true };
      }
    ),
    download: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
      const buffer = records.get(gcsUri.replace("gs://test-bucket/", ""));
      if (!buffer) throw new Error("missing");
      return { buffer };
    }),
    balance: vi.fn(async () => ({ totalAvailable: 100 })),
    charge: vi.fn(async () => ({ success: true })),
    llm: vi.fn(async (params: Parameters<MusicMvPlanDeps["llm"]>[0]) => {
      const p = plan();
      if (invalid) p.shots[1].startSec = 11;
      await params.onRawResponse!({
        gateway: "evolink_glm",
        model: "test-model",
        httpStatus: 200,
        contentType: "application/json",
        bodyText: JSON.stringify(p),
        bodyComplete: true,
        receivedBytes: 100,
      });
      return {
        choices: [{ message: { content: JSON.stringify(p) } }],
        gateway: "evolink_glm",
        model: "test-model",
        gatewayTrace: [],
      };
    }),
  };
  return { d: d as unknown as MusicMvPlanDeps, mocks: d, events, records };
}
describe("音乐 MV 分镜门禁与持久恢复", () => {
  it("原始和解析证据先于结果及扣费；重试同编号不再调用模型", async () => {
    const f = fixture();
    expect(
      (await draftCanvasMusicMvPlan(7, "user", input, f.d)).plan.shots
    ).toHaveLength(2);
    await draftCanvasMusicMvPlan(7, "user", input, f.d);
    expect(f.mocks.llm).toHaveBeenCalledTimes(1);
    expect(f.events).toEqual([
      "request.json",
      "raw-1.json",
      "parsed.json",
      "result.json",
      "settled.json",
    ]);
    expect(
      f.mocks.charge.mock.calls.every(
        call =>
          (call as unknown[])[4] &&
          ((call as unknown[])[4] as { chargeKey: string }).chargeKey ===
            `canvas-music-mv:7:${input.requestId}`
      )
    ).toBe(true);
  });
  it("拒绝不连续时间轴，永久保存拒绝稿且不扣分", async () => {
    const f = fixture(true);
    await expect(
      draftCanvasMusicMvPlan(7, "user", input, f.d)
    ).rejects.toThrow();
    expect(f.events).toContain("raw-1.json");
    expect(f.events).toContain("parsed.json");
    expect(f.mocks.charge).not.toHaveBeenCalled();
    await expect(
      draftCanvasMusicMvPlan(7, "user", input, f.d)
    ).rejects.toThrow();
    expect(f.mocks.llm).toHaveBeenCalledTimes(1);
  });
  it("改动同编号输入被拒；跨用户身份隔离", async () => {
    const f = fixture();
    await draftCanvasMusicMvPlan(7, "user", input, f.d);
    await expect(
      draftCanvasMusicMvPlan(
        7,
        "user",
        { ...input, creativePrompt: "换稿" },
        f.d
      )
    ).rejects.toThrow();
    await draftCanvasMusicMvPlan(8, "user", input, f.d);
    expect(f.mocks.llm).toHaveBeenCalledTimes(2);
  });
  it("结算失败后仅恢复结算，不重买模型", async () => {
    const f = fixture();
    f.mocks.charge.mockRejectedValueOnce(new Error("db down"));
    await expect(
      draftCanvasMusicMvPlan(7, "user", input, f.d)
    ).rejects.toThrow();
    expect((await draftCanvasMusicMvPlan(7, "user", input, f.d)).status).toBe(
      "succeeded"
    );
    expect(f.mocks.llm).toHaveBeenCalledTimes(1);
  });
  it("不允许长镜、假歌词、空视觉或音乐选择与分镜错配", () => {
    const p = plan();
    p.shots[0].endSec = 16;
    expect(() => validateCanvasMusicMvPlan(p, input)).toThrow();
    const q = plan();
    q.shots[0].lyricQuote = "伪造歌词";
    expect(() => validateCanvasMusicMvPlan(q, input)).toThrow();
    const r = plan();
    r.shots[0].visualPrompt = " ";
    expect(() => validateCanvasMusicMvPlan(r, input)).toThrow();
    expect(
      canvasMusicMvStateSchema.safeParse({
        status: "planned",
        candidates: [input.audio],
        selectedCandidateId: "other",
        plan: plan(),
      }).success
    ).toBe(false);
  });
  it("所有音乐变体完整保留", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      ...input.audio,
      id: `song-${i}`,
    }));
    expect(
      canvasMusicMvStateSchema.parse({ status: "music_ready", candidates })
        .candidates
    ).toHaveLength(5);
  });
});
