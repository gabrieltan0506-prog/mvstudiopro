import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  draftCanvasMusicMvPlan,
  getCanvasMusicMvPlan,
  type MusicMvPlanDeps,
} from "./canvasMusicMv";
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
      if (!buffer) throw new Error("gcs_stat_failed:404");
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
      "resolution.json",
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

describe("分镜进程中断与迟到回包", () => {
  function request(
    f: ReturnType<typeof fixture>,
    extra: Record<string, unknown> = {}
  ) {
    const root = `canvas-music-mv/evidence/7/${input.requestId}`;
    f.records.set(
      `${root}/request.json`,
      Buffer.from(
        JSON.stringify({
          input,
          inputDigest: createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex"),
          expiresAtMs: Date.now() - 1,
          ...extra,
        })
      )
    );
    return root;
  }
  it("进程消失后 request-only 到期明确失败，原编号不重买；网络读失败不冒充终态", async () => {
    const f = fixture();
    const root = request(f);
    expect((await getCanvasMusicMvPlan(7, input.requestId, f.d)).status).toBe(
      "failed"
    );
    await expect(draftCanvasMusicMvPlan(7, "user", input, f.d)).rejects.toThrow(
      "已确认未交付"
    );
    expect(f.mocks.llm).not.toHaveBeenCalled();
    expect(f.mocks.charge).not.toHaveBeenCalled();
    expect(f.records.has(`${root}/request.json`)).toBe(true);
    const g = fixture();
    request(g);
    g.mocks.download.mockRejectedValue(new Error("gcs_stat_failed:403"));
    await expect(getCanvasMusicMvPlan(7, input.requestId, g.d)).rejects.toThrow(
      "403"
    );
    expect(g.records.has(`${root}/resolution.json`)).toBe(false);
  });
  it("重启后从已保存解析稿恢复原结果，查询不扣费，同编号仅结算", async () => {
    const f = fixture();
    const root = request(f);
    f.records.set(
      `${root}/parsed.json`,
      Buffer.from(
        JSON.stringify({
          parsed: plan(),
          raw: [
            {
              objectName: `${root}/raw-1.json`,
              bytes: 100,
              sha256: "test-sha",
            },
          ],
          gateway: "test",
          model: "test",
        })
      )
    );
    expect((await getCanvasMusicMvPlan(7, input.requestId, f.d)).status).toBe(
      "settlement_pending"
    );
    expect(f.mocks.charge).not.toHaveBeenCalled();
    expect(
      (await draftCanvasMusicMvPlan(7, "user", input, f.d)).plan.shots
    ).toHaveLength(2);
    expect(f.mocks.llm).not.toHaveBeenCalled();
    expect(f.mocks.charge).toHaveBeenCalledTimes(1);
  });
  it("查询确认失败后迟到旧执行仅留证据，不交付、不扣分", async () => {
    const f = fixture();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(r => {
      release = r;
    });
    const ready = new Promise<void>(r => {
      started = r;
    });
    const original = f.mocks.llm.getMockImplementation()!;
    f.mocks.llm.mockImplementation(async params => {
      started();
      await waiting;
      return original(params);
    });
    const running = draftCanvasMusicMvPlan(7, "user", input, f.d);
    const rejected = expect(running).rejects.toThrow();
    await ready;
    const root = `canvas-music-mv/evidence/7/${input.requestId}`;
    const stored = JSON.parse(
      f.records.get(`${root}/request.json`)!.toString()
    );
    // 模拟服务时钟越过既定执行截止时间，不修改任何生产数据。
    const clock = vi.spyOn(Date, "now").mockReturnValue(stored.expiresAtMs + 1);
    try {
      expect((await getCanvasMusicMvPlan(7, input.requestId, f.d)).status).toBe(
        "failed"
      );
      release();
      await rejected;
    } finally {
      clock.mockRestore();
      release();
    }
    expect(f.mocks.charge).not.toHaveBeenCalled();
    expect(f.records.has(`${root}/parsed.json`)).toBe(true);
    expect(f.records.has(`${root}/result.json`)).toBe(false);
  });
});
