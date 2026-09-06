import { describe, it, expect } from "vitest";
import {
  buildBoundaryEvidenceBundle,
  auditBoundaryEvidenceOutput,
  applyBoundaryExperimentOrder,
  groundBoundaryFrameTimes,
  type BoundaryAttempt,
} from "./manhuaNativeBoundaryExperiment";
import {
  buildGeminiNativeDeepReadSegmentRequest,
  buildGeminiNativeDeepReadSegmentPrompt,
} from "./manhuaNativeDeepReadRunner";
const shot = (startSec = 0, endSec = 2, hintZh = "男子开门") => ({
  startSec,
  endSec,
  evidenceRole: "story",
  detailLevel: "brief",
  hintZh,
  actionZh: "开门",
});
const attempt = (n: number, raw: Record<string, unknown>): BoundaryAttempt => ({
  sourceDigest: "test-source",
  segmentIndex: 0,
  attemptNumber: n,
  startSec: 0,
  endSec: 10,
  rawObjectName: `test-only/${n}.json`,
  raw,
  gate: {
    status: n === 1 ? "rejected" : "accepted",
    reasonZh: n === 1 ? "其他区间有缺口" : undefined,
  },
});
describe("全片实验的多稿来源与留存", () => {
  it("三份完全重复原稿合为一条，独立证据分母仍是一，不误判丢失", () => {
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot()] }),
      attempt(2, { shots: [shot()] }),
      attempt(3, { shots: [shot()] }),
    ]);
    const r = auditBoundaryEvidenceOutput(b, {
      shots: [{ ...shot(), _sourceIds: b.evidence.map(e => e.id) }],
    });
    expect(r).toMatchObject({
      exactUniqueEvidence: 1,
      retainedUniqueEvidence: 1,
      retainedRatio: 1,
      fullyResolved: true,
    });
  });
  it("旧失败稿独有的观察不能被新通过稿静默替代", () => {
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot(0, 2, "女子举杯")] }),
      attempt(2, { shots: [shot(3, 5)] }),
    ]);
    expect(
      auditBoundaryEvidenceOutput(b, { shots: b.annotated[1]!.shots })
        .missingSourceIds
    ).toEqual([b.evidence[0]!.id]);
  });
  it("不同时间的相同观察是两条独立证据，不能跨时合并", () => {
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot(0, 2), shot(3, 5)] }),
    ]);
    const r = auditBoundaryEvidenceOutput(b, {
      shots: [{ ...shot(0, 5), _sourceIds: b.evidence.map(e => e.id) }],
    });
    expect(r.exactUniqueEvidence).toBe(2);
    expect(r.errors.some(e => e.includes("时间区间"))).toBe(true);
    expect(r.fullyResolved).toBe(false);
  });
  it("同镜不同字段可保留为来源原文，而不是制造统一假描述", () => {
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot()] }),
      attempt(2, { shots: [shot(0, 2, "男子右手推开门")] }),
    ]);
    const r = auditBoundaryEvidenceOutput(b, {
      shots: [
        {
          ...shot(),
          _sourceIds: b.evidence.map(e => e.id),
          _sourceAlternatives: [
            {
              sourceId: b.evidence[1]!.id,
              fields: { hintZh: "男子右手推开门" },
            },
          ],
        },
      ],
    });
    expect(r.fullyResolved).toBe(true);
  });
  it("挂上来源ID却丢掉不同观察仍判丢失", () => {
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot()] }),
      attempt(2, { shots: [shot(0, 2, "女子举杯")] }),
    ]);
    const r = auditBoundaryEvidenceOutput(b, {
      shots: [{ ...shot(), _sourceIds: b.evidence.map(e => e.id) }],
    });
    expect(r.lostFields).toEqual([
      { id: b.evidence[1]!.id, fields: ["hintZh"] },
    ]);
  });
  it("冲突显式保留只代表对账完整，不算问题解决", () => {
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot()] }),
      attempt(2, { shots: [shot(0, 2, "女子举杯")] }),
    ]);
    const r = auditBoundaryEvidenceOutput(b, {
      shots: b.annotated[0]!.shots,
      _unresolvedEvidence: [
        {
          sourceIds: [b.evidence[1]!.id],
          reasonZh: "同秒人物动作冲突，需回看原片",
        },
      ],
    });
    expect(r.traceabilityPassed).toBe(true);
    expect(r.fullyResolved).toBe(false);
    expect(r.unresolvedSourceIds).toBe(1);
  });
  it("拒绝伪造来源和整形新增剧情", () => {
    const b = buildBoundaryEvidenceBundle([attempt(1, { shots: [shot()] })]);
    const r = auditBoundaryEvidenceOutput(b, {
      shots: [
        {
          ...shot(0, 2, "男子杀死女子"),
          _sourceIds: [b.evidence[0]!.id, "fake-id"],
        },
      ],
    });
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    expect(r.fullyResolved).toBe(false);
  });
  it("音轨事件分别追踪，遗漏事件不能靠保留父音轨过关", () => {
    const raw = {
      shots: [shot()],
      audioResolution: [
        {
          chunkIndex: 0,
          analysis: {
            audioTrack: [
              {
                fromSec: 0,
                toSec: 10,
                toneZh: "低声",
                cues: [{ atSec: 3, kind: "sfx", detailZh: "敲门" }],
              },
            ],
          },
        },
      ],
    };
    const b = buildBoundaryEvidenceBundle([attempt(1, raw)]);
    const out = JSON.parse(JSON.stringify(b.annotated[0]));
    out.audioResolution[0].analysis.audioTrack[0].cues = [];
    const r = auditBoundaryEvidenceOutput(b, out);
    expect(r.missingSourceIds).toEqual([
      b.evidence.find(e => e.kind === "audioCue")!.id,
    ]);
  });
  it("音轨错误段号与越界事件逐条标注，保留原始值", () => {
    const original = {
      audioResolution: [
        {
          chunkIndex: 99,
          analysis: {
            audioTrack: [
              {
                fromSec: 0,
                toSec: 2,
                cues: [{ atSec: 5, kind: "sfx", detailZh: "敲门" }],
              },
            ],
          },
        },
      ],
    };
    const b = buildBoundaryEvidenceBundle([attempt(1, original)]);
    expect(b.evidence.find(e => e.kind === "audioCue")!.issues).toHaveLength(2);
    expect(original.audioResolution[0]!.chunkIndex).toBe(99);
  });
  it("不同影片和同一尝试重复入包直接拒绝", () => {
    expect(() =>
      buildBoundaryEvidenceBundle([
        attempt(1, {}),
        { ...attempt(2, {}), sourceDigest: "another" },
      ])
    ).toThrow();
    expect(() =>
      buildBoundaryEvidenceBundle([attempt(1, {}), attempt(1, {})])
    ).toThrow();
  });
});
describe("全片时间标注实验", () => {
  const ctx = { startSec: 0, endSec: 10, segmentIndex: 0, hasAudio: true };
  const body = () =>
    buildGeminiNativeDeepReadSegmentRequest({
      fileUri: "gs://test-only/unused.mp4",
      fps: 10,
      segmentContext: ctx,
      prompt: buildGeminiNativeDeepReadSegmentPrompt({
        ...ctx,
        episodeDurationSec: 10,
        segmentCount: 1,
      }),
      attemptIndex: 0,
    });
  it("B同时更改真实schema和提示词顺序，数值参数不变", () => {
    const a: any = body(),
      b: any = applyBoundaryExperimentOrder(a, "B");
    expect(a.generationConfig.responseSchema.propertyOrdering[0]).toBe(
      "keyMoments"
    );
    expect(b.generationConfig.responseSchema.propertyOrdering[0]).toBe("shots");
    expect(b.contents[0].parts[1].text).toContain("先沿时间顺序完整记录 shots");
    for (const k of ["maxOutputTokens", "temperature", "thinkingConfig"])
      expect(b.generationConfig[k]).toEqual(a.generationConfig[k]);
    expect(b.contents[0].parts[0]).toEqual(a.contents[0].parts[0]);
  });
  it("A完全保留原请求，C用整数秒和真实画面编号", () => {
    const a: any = body();
    expect(applyBoundaryExperimentOrder(a, "A")).toEqual(a);
    const c: any = applyBoundaryExperimentOrder(a, "C");
    for (const branch of c.generationConfig.responseSchema.properties.shots
      .items.anyOf) {
      expect(branch.properties.startSec.type).toBe("INTEGER");
      expect(branch.required).toEqual(
        expect.arrayContaining([
          "startFrame",
          "endFrame",
          "observedFrame",
          "observedAtSec",
        ])
      );
    }
  });
  it("同一秒两个短镜仍分别按原帧保留，原始JSON不被覆盖", () => {
    const raw = {
      shots: [
        {
          ...shot(0, 0),
          observedAtSec: 0,
          startFrame: 0,
          endFrame: 1,
          observedFrame: 0,
        },
        {
          ...shot(0, 1),
          observedAtSec: 0,
          startFrame: 1,
          endFrame: 2,
          observedFrame: 1,
        },
      ],
    };
    const r = groundBoundaryFrameTimes(raw, {
      offset: 0,
      actualDurationSec: 0.8,
      frames: [
        { frame: 0, localSec: 0 },
        { frame: 1, localSec: 0.4 },
      ],
    });
    expect(r.issues).toEqual([]);
    expect((r.raw.shots as any[]).map(s => [s.startSec, s.endSec])).toEqual([
      [0, 0.4],
      [0.4, 0.8],
    ]);
    expect(raw.shots[0]!.endSec).toBe(0);
  });
  it("错秒、无效帧号和镜外落点不能假装被修好", () => {
    const clock = {
      offset: 100,
      actualDurationSec: 1,
      frames: [
        { frame: 0, localSec: 0 },
        { frame: 1, localSec: 0.5 },
      ],
    };
    for (const row of [
      {
        ...shot(90, 91),
        observedAtSec: 90,
        startFrame: 0,
        endFrame: 2,
        observedFrame: 1,
      },
      {
        ...shot(100, 101),
        observedAtSec: 100,
        startFrame: 0,
        endFrame: 99,
        observedFrame: 1,
      },
      {
        ...shot(100, 101),
        observedAtSec: 100,
        startFrame: 0,
        endFrame: 1,
        observedFrame: 1,
      },
    ])
      expect(
        groundBoundaryFrameTimes({ shots: [row] }, clock).issues
      ).toHaveLength(1);
  });
});

describe("函数去重接入原有GLM整形", () => {
  it("同位置互补字段纯函数合并，不编写新描述", async () => {
    const { deduplicateBoundaryEvidence } = await import(
      "./manhuaNativeBoundaryExperiment"
    );
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot()] }),
      attempt(2, { shots: [{ ...shot(), cameraMoveZh: "固定机位" }] }),
    ]);
    const r = deduplicateBoundaryEvidence(b);
    expect(r.units).toHaveLength(1);
    expect(r.units[0]!.row).toEqual({ ...shot(), cameraMoveZh: "固定机位" });
    expect(r.stats).toMatchObject({
      inputRecords: 2,
      outputUnits: 1,
      mergedRecords: 1,
      conflictUnits: 0,
    });
    expect(r.units[0]!.sourceIds).toHaveLength(2);
  });
  it("同一时间人物冲突保留两版，不按通过状态压掉旧稿", async () => {
    const { deduplicateBoundaryEvidence } = await import(
      "./manhuaNativeBoundaryExperiment"
    );
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot()] }),
      attempt(2, { shots: [shot(0, 2, "女子举杯")] }),
    ]);
    const r = deduplicateBoundaryEvidence(b);
    expect(r.units).toHaveLength(2);
    expect(r.units.every(u => u.status === "conflict")).toBe(true);
    expect(r.stats.missingSourceIds).toEqual([]);
  });
  it("不同时间重复动作保留，两稿交叉错位标记而不改秒", async () => {
    const { deduplicateBoundaryEvidence } = await import(
      "./manhuaNativeBoundaryExperiment"
    );
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot(0, 2), shot(4, 6)] }),
      attempt(2, { shots: [shot(1, 3)] }),
    ]);
    const r = deduplicateBoundaryEvidence(b);
    expect(r.units).toHaveLength(3);
    expect(r.units.filter(u => u.status === "conflict")).toHaveLength(2);
    expect(r.units.find(u => u.row.startSec === 4)!.status).toBe("consistent");
  });
  it("保持原有GLM整形输入，冲突旁存且每条来源可对账", async () => {
    const { deduplicateBoundaryEvidence, buildBoundaryCleanStructuringInput } =
      await import("./manhuaNativeBoundaryExperiment");
    const b = buildBoundaryEvidenceBundle([
      attempt(1, { shots: [shot(0, 2), shot(4, 6)] }),
      attempt(2, { shots: [shot(0, 2), shot(4, 6, "女子举杯")] }),
    ]);
    const result = buildBoundaryCleanStructuringInput(
      b,
      deduplicateBoundaryEvidence(b)
    );
    expect(result.raw.shots).toHaveLength(1);
    expect(result.raw._unresolvedEvidence).toHaveLength(2);
    expect(result.audit.missingSourceIds).toEqual([]);
    expect(result.audit.lostFields).toEqual([]);
    expect(result.audit.traceabilityPassed).toBe(true);
  });
});
