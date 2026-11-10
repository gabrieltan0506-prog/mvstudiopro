import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer vertex-test-token" })),
  getVertexProjectId: () => "test-project",
}));

import { geminiAudioJsonWithFallback } from "../gemini-audio";
import { readFileSync } from "node:fs";
import { CREDIT_COSTS as SHARED_CREDIT_COSTS } from "../../shared/plans";
import { CREDIT_COSTS as SERVER_CREDIT_COSTS } from "../plans";
import { adviseCanvasMontageGrade, adviseMontageGradeInputSchema } from "../routers/canvasMusicMv";
import { gradeSegmentSchema } from "../../shared/colorGrade";
import {
  GRADE_CROSSFADE_MAX_SEC,
  GRADE_TRANSITION_YIELD_SEC,
  MontageGradeAdviceRequestUsedError,
  adviceToGradeSegments,
  adviseMontageGrade,
  buildMontageGradePrompt,
  loadGradeLutOptions,
  resolveMontageGradeAdviceModel,
  snapGradeBoundaries,
  validateMontageGradeAdvice,
} from "./montageGradeAdvice";

/** 1110：模型走配置，未设 env 时缺省 gemini-3.8-flash（测试替身直接用该值）。 */
const MONTAGE_GRADE_ADVICE_MODEL = "gemini-3.8-flash";

const LUTS = new Set(["golden_hour_subtle", "neo_noir_standard"]);
const ok = () => ({
  segmentsNow: [{ fromSec: 0, toSec: 10, storyZh: "晴", exposureZh: "正常", colorTempZh: "偏暖", saturationZh: "适中", contrastZh: "略平", moodMatch: "match", moodMatchZh: "吻合" }],
  seams: [{ atSec: 6, jump: true, intent: "intended" as "intended" | "unwanted", beforeZh: "暖", afterZh: "冷", fixZh: "后段升色温" }],
  grades: [
    { fromSec: 0, toSec: 6, correction: { lutId: "golden_hour_subtle", exposure: 0.1 }, reasonZh: "暖金期待" },
    { fromSec: 6, toSec: 10, correction: { saturation: 0.8, color_temperature: 7200, curves: { master: "0/0 0.5/0.45 1/1" } }, reasonZh: "转冷" },
  ],
  arcZh: "由暖入冷",
});

describe("成片调色建议 · schema 校验", () => {
  it("合法输出通过并转为 grade.segments", () => {
    const v = validateMontageGradeAdvice(ok(), { durationSec: 10, lutIds: LUTS });
    expect(adviceToGradeSegments(v, 10)).toEqual([
      { startSec: 0, endSec: 6, lutId: "golden_hour_subtle", exposure: 0.1 },
      { startSec: 6, endSec: 10, junctionIntent: "intended", saturation: 0.8, color_temperature: 7200, curves: { master: "0/0 0.5/0.45 1/1" } },
    ]);
  });
  it("seams 须标 intent；就近（±0.6s）透传为段的 junctionIntent，对不上不填", () => {
    const missing = ok() as { seams: Array<Record<string, unknown>> };
    delete missing.seams[0]!.intent;
    expect(() => validateMontageGradeAdvice(missing, { durationSec: 10, lutIds: LUTS })).toThrow();
    const unwanted = ok(); unwanted.seams[0]!.intent = "unwanted"; unwanted.seams[0]!.atSec = 6.4;
    expect(adviceToGradeSegments(validateMontageGradeAdvice(unwanted, { durationSec: 10, lutIds: LUTS }), 10)[1]).toMatchObject({ startSec: 6, junctionIntent: "unwanted" });
    const far = ok(); far.seams[0]!.atSec = 7;
    expect(adviceToGradeSegments(validateMontageGradeAdvice(far, { durationSec: 10, lutIds: LUTS }), 10)[1]).not.toHaveProperty("junctionIntent");
    const p = buildMontageGradePrompt({ durationSec: 10, luts: [] });
    expect(p).toContain('"intent": "intended"|"unwanted"');
    expect(p).toContain("剧情意图的转变");
    expect(p).toContain("不该有的跳色");
  });
  it("参数越界被 colorCorrectionSchema 拒收", () => {
    const bad = ok(); (bad.grades[0]!.correction as Record<string, unknown>).exposure = 5;
    expect(() => validateMontageGradeAdvice(bad, { durationSec: 10, lutIds: LUTS })).toThrow();
    const extra = ok(); (extra.grades[0]!.correction as Record<string, unknown>).hue = 3;
    expect(() => validateMontageGradeAdvice(extra, { durationSec: 10, lutIds: LUTS })).toThrow();
  });
  it("非法 LUT（不在 manifest）拒收", () => {
    const bad = ok(); bad.grades[0]!.correction.lutId = "teal_orange_pro";
    expect(() => validateMontageGradeAdvice(bad, { durationSec: 10, lutIds: LUTS })).toThrow(/不在预设清单/);
  });
  it("区间留空/未覆盖片尾拒收", () => {
    const gap = ok(); gap.grades[1]!.fromSec = 7;
    expect(() => validateMontageGradeAdvice(gap, { durationSec: 10, lutIds: LUTS })).toThrow(/不连续/);
    expect(() => validateMontageGradeAdvice(ok(), { durationSec: 12, lutIds: LUTS })).toThrow(/未覆盖到片尾/);
  });
  it("真实 manifest 读得到 20 个 LUT，prompt 列出全部并含时长", async () => {
    const luts = await loadGradeLutOptions();
    expect(luts.length).toBe(20);
    const p = buildMontageGradePrompt({ durationSec: 59.333, luts, seamSecs: [29.6] });
    for (const l of luts) expect(p).toContain(`- ${l.id}：`);
    expect(p).toContain("0.0–59.3");
    expect(p).toContain("29.6 秒");
  });
});

describe("成片调色建议 · 两跳 fallback（替身，不真调模型）", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"type\":\"test\"}");
    vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
    vi.stubEnv("EVOLINK_API_KEY", "test-key");
    vi.stubEnv("MANHUA_AUDIO_VERTEX_LOCATION", "global");
    vi.stubEnv("MANHUA_AUDIO_EVOLINK_BASE_URL", "https://evolink.test");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
    vi.stubEnv("MONTAGE_GRADE_ADVICE_MODEL", "");
    fetchMock.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("1110 模型不写死：缺省 3.8 Flash；设 MONTAGE_GRADE_ADVICE_MODEL 后两跳 URL 与 request 证据都用配置模型；空白回落", async () => {
    expect(resolveMontageGradeAdviceModel()).toBe("gemini-3.8-flash");
    vi.stubEnv("MONTAGE_GRADE_ADVICE_MODEL", "gemini-3.9-flash");
    expect(resolveMontageGradeAdviceModel()).toBe("gemini-3.9-flash");
    fetchMock.mockResolvedValueOnce(gem("{not json")).mockResolvedValueOnce(gem(JSON.stringify(ok())));
    const uploads: Array<{ name: string; body: Record<string, unknown> }> = [];
    const res = await adviseMontageGrade(7, { requestId: "r-cfg", videoGsUri: "gs://b/post-prod/7/final.mp4", durationSec: 10 }, {
      bucket: () => "b",
      sign: () => "https://signed.test/v.mp4?X-Goog-Signature=abc",
      luts: async () => Array.from(LUTS).map(id => ({ id, labelZh: id })),
      upload: (async (p: { objectName: string; buffer: Buffer }) => {
        uploads.push({ name: p.objectName.replace("canvas-montage/grade-advice/7/r-cfg/", ""), body: JSON.parse(p.buffer.toString("utf8")) });
        return { created: true };
      }) as never,
      download: (async () => { throw new Error("gcs_stat_failed:404"); }) as never,
    });
    expect(res.usedBy.model).toBe("gemini-3.9-flash");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/models/gemini-3.9-flash:generateContent");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://evolink.test/v1beta/models/gemini-3.9-flash:generateContent");
    expect(uploads.find(u => u.name === "request.json")!.body.model).toBe("gemini-3.9-flash");
    vi.stubEnv("MONTAGE_GRADE_ADVICE_MODEL", " ");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "gemini-4.0-flash");
    expect(resolveMontageGradeAdviceModel()).toBe("gemini-4.0-flash");
  });

  const gem = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

  it("Vertex 写坏 → EvoLink 成功；Vertex 用 gs://、EvoLink 用签名 URL，均为 3.8 Flash；原始与解析分别落档且顺序正确", async () => {
    fetchMock.mockResolvedValueOnce(gem("{not json")).mockResolvedValueOnce(gem(JSON.stringify(ok())));
    const saved: string[] = [];
    const uploads: Array<{ objectName: string; body: unknown }> = [];
    const sign = vi.fn(() => "https://signed.test/v.mp4?X-Goog-Signature=abc");
    const res = await adviseMontageGrade(7, { requestId: "r1", videoGsUri: "gs://b/post-prod/7/final.mp4", durationSec: 10 }, {
      bucket: () => "b",
      sign,
      luts: async () => Array.from(LUTS).map(id => ({ id, labelZh: id })),
      upload: (async (p: { objectName: string; buffer: Buffer }) => {
        saved.push(p.objectName.replace("canvas-montage/grade-advice/7/r1/", ""));
        uploads.push({ objectName: p.objectName, body: JSON.parse(p.buffer.toString("utf8")) });
        return { created: true };
      }) as never,
      download: (async () => { throw new Error("gcs_stat_failed:404"); }) as never,
    });
    expect(res.usedBy.channel).toBe("EvoLink");
    expect(res.usedBy.model).toBe(MONTAGE_GRADE_ADVICE_MODEL);
    expect(res.usedBy.failuresZh[0]).toMatch(/Vertex（写坏/);
    expect(res.segments).toHaveLength(2);
    const [vUrl, vInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [eUrl, eInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(vUrl).toContain("/models/gemini-3.8-flash:generateContent");
    expect(vUrl).toContain("aiplatform.googleapis.com");
    expect(eUrl).toBe("https://evolink.test/v1beta/models/gemini-3.8-flash:generateContent");
    expect(JSON.parse(String(vInit.body)).contents[0].parts[0].fileData).toEqual({ mimeType: "video/mp4", fileUri: "gs://b/post-prod/7/final.mp4" });
    expect(JSON.parse(String(eInit.body)).contents[0].parts[0].fileData.fileUri).toBe("https://signed.test/v.mp4?X-Goog-Signature=abc");
    expect(sign).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([
      "request.json",
      "hop-1-vertex-request.json", "hop-1-vertex-raw.json", "hop-1-vertex-rejected.json",
      "hop-2-evolink-request.json", "hop-2-evolink-raw.json", "hop-2-evolink-decoded.json", "hop-2-evolink-parsed.json",
      "hop-used.json", "segments.json",
    ]);
    // 签名 URL 不落证据
    expect(JSON.stringify(uploads)).not.toContain("X-Goog-Signature");
  });

  it("Vertex 超时/断线 → EvoLink；两跳都空回则整体失败且留 hop-exhausted", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" })).mockResolvedValueOnce(gem(""));
    const names: string[] = [];
    const save = async (n: string) => { names.push(n); };
    await expect(geminiAudioJsonWithFallback({
      media: { vertexFileUri: "gs://b/x.mp4", evolinkFileUri: () => "https://signed.test/x" },
      mimeType: "video/mp4", model: MONTAGE_GRADE_ADVICE_MODEL, prompt: "p", schemaName: "s",
      validate: v => v, save,
    })).rejects.toThrow(/全部通道失败/);
    expect(names).toEqual(["hop-1-vertex-request", "hop-1-vertex-error", "hop-2-evolink-request", "hop-2-evolink-raw", "hop-2-evolink-rejected", "hop-exhausted"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Vertex 成功则不签 URL、不调 EvoLink", async () => {
    fetchMock.mockResolvedValueOnce(gem(JSON.stringify(ok())));
    const sign = vi.fn(() => "https://signed.test/x");
    const r = await geminiAudioJsonWithFallback({
      media: { vertexFileUri: "gs://b/x.mp4", evolinkFileUri: sign },
      mimeType: "video/mp4", model: MONTAGE_GRADE_ADVICE_MODEL, prompt: "p", schemaName: "s",
      validate: v => validateMontageGradeAdvice(v, { durationSec: 10, lutIds: LUTS }), save: async () => {},
    });
    expect(r.channel).toBe("Vertex");
    expect(sign).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/** GCS 替身：upload 照 ifGenerationMatch=0 只增不覆盖；download 缺对象抛 404。 */
function memGcs() {
  const objects = new Map<string, Buffer>();
  const writes: string[] = [];
  return {
    objects,
    writes,
    upload: (async (p: { objectName: string; buffer: Buffer }) => {
      writes.push(p.objectName);
      if (objects.has(p.objectName)) return { created: false };
      objects.set(p.objectName, p.buffer);
      return { created: true };
    }) as never,
    download: (async ({ gcsUri }: { gcsUri: string }) => {
      const name = gcsUri.replace(/^gs:\/\/b\//, "");
      const buffer = objects.get(name);
      if (!buffer) throw new Error("gcs_stat_failed:404");
      return { buffer, bucket: "b", objectName: name, generation: "1" };
    }) as never,
  };
}
const RID = "22222222-2222-4222-8222-222222222222";
const baseInput = { requestId: RID, videoGsUri: "gs://b/post-prod/7/final.mp4", durationSec: 10 };
const okCall = () => vi.fn(async (o: { validate: (v: unknown) => unknown; save: (n: string, v: unknown) => Promise<unknown> }) => {
  const value = o.validate(ok());
  await o.save("hop-1-vertex-raw", { payload: "raw" });
  await o.save("hop-1-vertex-parsed", value);
  return { value, channel: "Vertex", model: MONTAGE_GRADE_ADVICE_MODEL, failuresZh: [] };
});
const svcDeps = (gcs: ReturnType<typeof memGcs>, call: ReturnType<typeof vi.fn>) => ({
  bucket: () => "b",
  sign: () => "https://signed.test/x",
  luts: async () => Array.from(LUTS).map(id => ({ id, labelZh: id })),
  upload: gcs.upload,
  download: gcs.download,
  call: call as never,
});

describe("成片调色建议 · 防重放（替身，不真调模型）", () => {
  it("同 requestId 第二次不调用模型，返回同一已存结果；证据只写一次", async () => {
    const gcs = memGcs();
    const call = okCall();
    const first = await adviseMontageGrade(7, baseInput, svcDeps(gcs, call));
    const writesAfterFirst = gcs.writes.length;
    const second = await adviseMontageGrade(7, baseInput, svcDeps(gcs, call), { beforeModelCall: async () => { throw new Error("不应预检"); } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(second.replayed).toBe(true);
    expect(second.segments).toEqual(first.segments);
    expect(second.advice).toEqual(first.advice);
    expect(second.usedBy).toEqual(first.usedBy);
    expect(gcs.writes.length).toBe(writesAfterFirst);
    expect(Array.from(gcs.objects.keys()).map(k => k.split("/").pop())).toEqual(["request.json", "hop-1-vertex-raw.json", "hop-1-vertex-parsed.json", "segments.json"]);
  });

  it("失败的 requestId 不可复用：再次调用拒绝且不调模型", async () => {
    const gcs = memGcs();
    const call = vi.fn(async () => { throw new Error("全部通道失败"); });
    await expect(adviseMontageGrade(7, baseInput, svcDeps(gcs, call))).rejects.toThrow(/全部通道失败/);
    await expect(adviseMontageGrade(7, baseInput, svcDeps(gcs, okCall()))).rejects.toBeInstanceOf(MontageGradeAdviceRequestUsedError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(gcs.objects.has(`canvas-montage/grade-advice/7/${RID}/segments.json`)).toBe(false);
  });

  it("余额预检不过：什么都不写、不调模型，同编号之后仍可正常发起", async () => {
    const gcs = memGcs();
    const call = okCall();
    await expect(adviseMontageGrade(7, baseInput, svcDeps(gcs, call), { beforeModelCall: async () => { throw new Error("余额不足"); } })).rejects.toThrow(/余额不足/);
    expect(gcs.objects.size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("成片调色建议 · 分段边界吸附（1110 实测切点，替身，不真调模型）", () => {
  const CUTS = [8.5, 12.5, 16.5, 20.6, 23.7, 26.9, 27.2, 29.7, 33.1];
  const DUR = 40;
  /** 溶解中点 29.6、时长 3.0 → 区间 28.1–31.1，连同前后 3 秒让位范围覆盖 25.1–34.1。 */
  const DISSOLVE = { atSec: 29.6, durationSec: 3 };
  /** 模型原始分段（未校验）：correction 可带任意调色参数，不能按首个样例推断成只有 saturation。 */
  type RawGradeRow = { fromSec: number; toSec: number; correction: Record<string, unknown>; reasonZh: string };
  const row = (fromSec: number, toSec: number, extra: Record<string, unknown> = {}): RawGradeRow => ({ fromSec, toSec, correction: { saturation: 1, ...extra }, reasonZh: "理由" });
  const advice1110 = (grades: RawGradeRow[], seams = [{ atSec: 26.9, jump: true, intent: "intended" as const, beforeZh: "暖", afterZh: "冷", fixZh: "保留" }]) => ({ ...ok(), seams, grades });
  const lutCtx = { durationSec: DUR, lutIds: LUTS };

  it("26.9 的冷色段起点被吸到 29.6 转场中点，建议过渡时长 = 转场时长（3 秒超上限，截到 2 秒）；吸附后校验通过", () => {
    const grades = [row(0, 12.4), row(12.4, 26.9, { color_temperature: 5600 }), row(26.9, DUR, { color_temperature: 7600 })];
    const s = snapGradeBoundaries(grades, { durationSec: DUR, seamSecs: CUTS, transitions: [DISSOLVE] });
    expect(s.boundaries).toEqual([
      { gradeIndex: 1, originalSec: 12.4, snappedSec: 12.5, snappedTo: "cut", segmentIndex: 1 },
      { gradeIndex: 2, originalSec: 26.9, snappedSec: 29.6, snappedTo: "transition", suggestedCrossfadeSec: 2, segmentIndex: 2 },
    ]);
    expect(s.grades.map(g => [g.fromSec, g.toSec])).toEqual([[0, 12.5], [12.5, 29.6], [29.6, DUR]]);
    expect(s.mergedGradeIndexes).toEqual([]);
    const after = validateMontageGradeAdvice(advice1110(s.grades), lutCtx);
    // 模型在原处（26.9）标的接点意图跟着边界走
    expect(adviceToGradeSegments(after, DUR, s.originalFromSecs.map(t => [t]))[2]).toMatchObject({ startSec: 29.6, endSec: DUR, junctionIntent: "intended", color_temperature: 7600 });
  });

  it("没给转场时 26.9 本身是切点，原地不动；超容差的边界保留原值并标 unsnapped", () => {
    const grades = [row(0, 4), row(4, 26.9), row(26.9, 36.5), row(36.5, DUR)];
    const s = snapGradeBoundaries(grades, { durationSec: DUR, seamSecs: CUTS });
    expect(s.boundaries).toEqual([
      { gradeIndex: 1, originalSec: 4, snappedSec: 4, snappedTo: "none", unsnapped: true, segmentIndex: 1 },
      { gradeIndex: 2, originalSec: 26.9, snappedSec: 26.9, snappedTo: "cut", segmentIndex: 2 },
      { gradeIndex: 3, originalSec: 36.5, snappedSec: 36.5, snappedTo: "none", unsnapped: true, segmentIndex: 3 },
    ]);
    expect(s.grades).toEqual(grades);
    validateMontageGradeAdvice(advice1110(s.grades), lutCtx);
  });

  it("1110 实例：0.4 秒转场（中点 29.6），模型边界 26.9 本身是切点、离中点 2.7 秒，仍让位吸到 29.6", () => {
    const real = { atSec: 29.6, durationSec: 0.4 };
    const s = snapGradeBoundaries([row(0, 26.9), row(26.9, DUR, { color_temperature: 7600 })], { durationSec: DUR, seamSecs: CUTS, transitions: [real] });
    expect(s.boundaries).toEqual([{ gradeIndex: 1, originalSec: 26.9, snappedSec: 29.6, snappedTo: "transition", suggestedCrossfadeSec: 0.4, segmentIndex: 1 }]);
    expect(s.grades.map(g => [g.fromSec, g.toSec])).toEqual([[0, 29.6], [29.6, DUR]]);
    validateMontageGradeAdvice(advice1110(s.grades), lutCtx);
  });

  it("让位范围按 转场区间前后 3 秒 计（0.4 秒转场 → 26.4–32.8）：范围外仍按切点规则，范围内的切点边界也让位", () => {
    const real = { atSec: 29.6, durationSec: 0.4 };
    const snap1 = (b: number) => snapGradeBoundaries([row(0, b), row(b, DUR)], { durationSec: DUR, seamSecs: CUTS, transitions: [real] }).boundaries[0];
    expect(GRADE_TRANSITION_YIELD_SEC).toBe(3);
    expect(snap1(23.7)).toMatchObject({ snappedSec: 23.7, snappedTo: "cut" });
    expect(snap1(26.3)).toMatchObject({ snappedSec: 26.9, snappedTo: "cut" });
    expect(snap1(26.4)).toMatchObject({ snappedSec: 29.6, snappedTo: "transition" });
    expect(snap1(33.1)).toMatchObject({ snappedSec: 33.1, snappedTo: "cut" });
    expect(snap1(32.8)).toMatchObject({ snappedSec: 29.6, snappedTo: "transition" });
    expect(snap1(36.5)).toMatchObject({ snappedSec: 36.5, snappedTo: "none", unsnapped: true });
  });

  it("建议过渡时长上限与 shared/colorGrade 的 crossfadeSec 上限一致，超出截断", () => {
    expect(gradeSegmentSchema.safeParse({ startSec: 0, endSec: 1, crossfadeSec: GRADE_CROSSFADE_MAX_SEC }).success).toBe(true);
    expect(gradeSegmentSchema.safeParse({ startSec: 0, endSec: 1, crossfadeSec: GRADE_CROSSFADE_MAX_SEC + 0.1 }).success).toBe(false);
    const s = snapGradeBoundaries([row(0, 29), row(29, DUR)], { durationSec: DUR, transitions: [{ atSec: 29.6, durationSec: 5 }] });
    expect(s.boundaries[0]).toMatchObject({ snappedTo: "transition", suggestedCrossfadeSec: GRADE_CROSSFADE_MAX_SEC });
  });

  it("路由 schema：放行可选 transitions，越界/多余字段/超量拒收", () => {
    const base = { requestId: RID, videoGsUri: "gs://b/post-prod/a.mp4", durationSec: DUR };
    expect(adviseMontageGradeInputSchema.parse({ ...base, transitions: [{ atSec: 29.6, durationSec: 0.4 }] }).transitions).toEqual([{ atSec: 29.6, durationSec: 0.4 }]);
    expect(adviseMontageGradeInputSchema.safeParse(base).success).toBe(true);
    for (const bad of [[{ atSec: -1, durationSec: 0.4 }], [{ atSec: 601, durationSec: 0.4 }], [{ atSec: 5, durationSec: 11 }], [{ atSec: 5, durationSec: -0.1 }], [{ atSec: 5 }], [{ atSec: 5, durationSec: 1, kind: "fade" }], Array.from({ length: 41 }, () => ({ atSec: 5, durationSec: 1 }))])
      expect(adviseMontageGradeInputSchema.safeParse({ ...base, transitions: bad }).success).toBe(false);
  });

  it("两个边界吸到同一点：中间段并入相邻段，结果仍首尾相接覆盖全片且过校验", () => {
    const grades = [row(0, 26.9), row(26.9, 27.2, { saturation: 0.5 }), row(27.2, DUR, { color_temperature: 7600 })];
    const s = snapGradeBoundaries(grades, { durationSec: DUR, seamSecs: CUTS, transitions: [DISSOLVE] });
    expect(s.mergedGradeIndexes).toEqual([1]);
    expect(s.grades.map(g => [g.fromSec, g.toSec])).toEqual([[0, 29.6], [29.6, DUR]]);
    expect(s.boundaries.map(b => b.segmentIndex)).toEqual([null, 1]);
    expect(s.grades[1]!.correction).toMatchObject({ color_temperature: 7600 });
    validateMontageGradeAdvice(advice1110(s.grades), lutCtx);
  });

  it("提示词：给了切点/转场才出现硬约束；都不给时逐字不变", () => {
    const base = buildMontageGradePrompt({ durationSec: DUR, luts: [] });
    expect(base).not.toContain("分段边界硬约束");
    expect(buildMontageGradePrompt({ durationSec: DUR, luts: [], seamSecs: [], transitions: [] })).toBe(base);
    const p = buildMontageGradePrompt({ durationSec: DUR, luts: [], seamSecs: CUTS, transitions: [DISSOLVE] });
    expect(p).toContain("分段边界只能落在给定切点或转场中点上");
    expect(p).toContain("切点：8.5 秒、12.5 秒");
    expect(p).toContain("转场（中点／时长）：29.6 秒／3.0 秒");
    expect(p).toContain("专门检查 8.5 秒");
    expect(buildMontageGradePrompt({ durationSec: DUR, luts: [], transitions: [DISSOLVE] })).not.toContain("切点：");
  });

  const snapCall = () => vi.fn(async (o: { prompt: string; validate: (v: unknown) => unknown; save: (n: string, v: unknown) => Promise<unknown> }) => {
    const value = o.validate(advice1110([row(0, 26.9), row(26.9, DUR, { color_temperature: 7600 })]));
    await o.save("hop-1-vertex-raw", { payload: "raw" });
    await o.save("hop-1-vertex-parsed", value);
    return { value, channel: "Vertex", model: MONTAGE_GRADE_ADVICE_MODEL, failuresZh: [] };
  });

  it("服务：传切点+转场 → segments 为吸附后、advice 保持模型原样；吸附前后分段各落一份证据；重放带回 snap", async () => {
    const gcs = memGcs();
    const call = snapCall();
    const input = { ...baseInput, durationSec: DUR, seamSecs: CUTS, transitions: [DISSOLVE] };
    const res = await adviseMontageGrade(7, input, svcDeps(gcs, call));
    expect((call.mock.calls[0]![0] as { prompt: string }).prompt).toContain("分段边界硬约束");
    expect(res.advice.grades.map(g => g.fromSec)).toEqual([0, 26.9]);
    expect(res.segments.map(s => [s.startSec, s.endSec])).toEqual([[0, 29.6], [29.6, DUR]]);
    expect(res.segments[1]).toMatchObject({ junctionIntent: "intended", color_temperature: 7600 });
    expect(res.snap!.boundaries).toEqual([{ gradeIndex: 1, originalSec: 26.9, snappedSec: 29.6, snappedTo: "transition", suggestedCrossfadeSec: 2, segmentIndex: 1 }]);
    expect(res.snap!.fallbackZh).toBeUndefined();
    expect(Array.from(gcs.objects.keys()).map(k => k.split("/").pop())).toEqual(["request.json", "hop-1-vertex-raw.json", "hop-1-vertex-parsed.json", "snap-before.json", "snap-after.json", "segments.json"]);
    const read = (n: string) => JSON.parse(gcs.objects.get(`canvas-montage/grade-advice/7/${RID}/${n}.json`)!.toString("utf8"));
    expect(read("request").transitions).toEqual([DISSOLVE]);
    expect(read("snap-before").segments.map((s: { startSec: number }) => s.startSec)).toEqual([0, 26.9]);
    expect(read("snap-after").segments.map((s: { startSec: number }) => s.startSec)).toEqual([0, 29.6]);
    expect(read("hop-1-vertex-parsed").grades.map((g: { fromSec: number }) => g.fromSec)).toEqual([0, 26.9]);
    const again = await adviseMontageGrade(7, input, svcDeps(gcs, call));
    expect(call).toHaveBeenCalledTimes(1);
    expect(again.replayed).toBe(true);
    expect(again.snap).toEqual(res.snap);
    expect(again.segments).toEqual(res.segments);
  });

  it("服务：不传 seamSecs/transitions（或传空数组）时不吸附、无 snap 字段、落档清单与原来一致", async () => {
    for (const extra of [{}, { seamSecs: [], transitions: [] }]) {
      const gcs = memGcs();
      const res = await adviseMontageGrade(7, { ...baseInput, durationSec: DUR, ...extra }, svcDeps(gcs, snapCall()));
      expect(res).not.toHaveProperty("snap");
      expect(res.segments.map(s => [s.startSec, s.endSec])).toEqual([[0, 26.9], [26.9, DUR]]);
      expect(Array.from(gcs.objects.keys()).map(k => k.split("/").pop())).toEqual(["request.json", "hop-1-vertex-raw.json", "hop-1-vertex-parsed.json", "segments.json"]);
      expect(JSON.parse(gcs.objects.get(`canvas-montage/grade-advice/7/${RID}/segments.json`)!.toString("utf8"))).not.toHaveProperty("snap");
    }
  });
});

describe("成片调色建议 · 计费 20 积分（router，替身）", () => {
  const user = { id: 7, role: "user" };
  const routerDeps = () => ({
    bucket: () => "b",
    balance: vi.fn(async () => ({ totalAvailable: 100 })) as never,
    charge: vi.fn(async (_u: number, amount: number) => ({ success: true, cost: amount })) as never,
  });
  /** 登记核验替身：本人成功任务产物 = canvas/jobs/7/out.mp4；画布归属一律否。 */
  const media = () => ({
    getBucket: () => "b",
    verifyOwnership: vi.fn(async () => false),
    loadSucceededJobOutputObjects: vi.fn(async (uid: string) => new Set(uid === "7" ? ["video-jobs/7/out.mp4"] : [])),
  });

  it("普通用户扣 20、action/说明/chargeKey 正确；同 requestId 重放不调模型、按同 chargeKey 补扣（幂等）", async () => {
    const gcs = memGcs();
    const call = okCall();
    const d = routerDeps();
    const r1 = await adviseCanvasMontageGrade(user, baseInput, d, svcDeps(gcs, call), media());
    expect(r1.creditsCost).toBe(20);
    const chargeKey = `canvas-montage-grade:7:${RID}`;
    expect(d.charge).toHaveBeenCalledWith(7, 20, "montageGradeAdvice", "成片调色建议", { chargeKey });
    const r2 = await adviseCanvasMontageGrade(user, baseInput, d, svcDeps(gcs, call), media());
    expect(call).toHaveBeenCalledTimes(1);
    expect(r2.segments).toEqual(r1.segments);
    expect(d.charge).toHaveBeenCalledTimes(2);
    expect((d.charge as unknown as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([7, 20, "montageGradeAdvice", "成片调色建议", { chargeKey }]);
  });

  it("管理员：跳过余额预检，扣费返回 0 则交付 creditsCost 0", async () => {
    const gcs = memGcs();
    const d = { ...routerDeps(), charge: vi.fn(async () => ({ success: true, cost: 0 })) as never };
    const r = await adviseCanvasMontageGrade({ id: 9, role: "admin" }, baseInput, d, svcDeps(gcs, okCall()));
    expect(r.creditsCost).toBe(0);
    expect(d.balance).not.toHaveBeenCalled();
  });

  it("失败编号重放 → CONFLICT 提示重新发起，不扣费", async () => {
    const gcs = memGcs();
    const d = routerDeps();
    await expect(adviseCanvasMontageGrade(user, baseInput, d, svcDeps(gcs, vi.fn(async () => { throw new Error("x"); })), media())).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    await expect(adviseCanvasMontageGrade(user, baseInput, d, svcDeps(gcs, okCall()), media())).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/请重新发起/) });
    expect(d.charge).not.toHaveBeenCalled();
  });

  it("余额不足 → PAYMENT_REQUIRED，不调模型、不落档", async () => {
    const gcs = memGcs();
    const call = okCall();
    const d = { ...routerDeps(), balance: vi.fn(async () => ({ totalAvailable: 19 })) as never };
    await expect(adviseCanvasMontageGrade(user, baseInput, d, svcDeps(gcs, call), media())).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(call).not.toHaveBeenCalled();
    expect(gcs.objects.size).toBe(0);
  });

  it("来源登记核验：他人对象被拒（不调模型、不扣费）；本人成功任务产物通过；管理员豁免", async () => {
    const gcs = memGcs();
    const call = okCall();
    const d = routerDeps();
    const other = { ...baseInput, videoGsUri: "gs://b/post-prod/8/final.mp4" };
    await expect(adviseCanvasMontageGrade(user, other, d, svcDeps(gcs, call), media())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 路径第二段伪装成本人 id 但不在任何登记源
    const fake = { ...baseInput, videoGsUri: "gs://b/video-jobs/7/not-mine.mp4" };
    await expect(adviseCanvasMontageGrade(user, fake, d, svcDeps(gcs, call), media())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(call).not.toHaveBeenCalled();
    expect(d.charge).not.toHaveBeenCalled();
    const job = { ...baseInput, videoGsUri: "gs://b/video-jobs/7/out.mp4" };
    const r = await adviseCanvasMontageGrade(user, job, d, svcDeps(gcs, call), media());
    expect(r.creditsCost).toBe(20);
    expect((call.mock.calls[0]![0] as unknown as { media: { vertexFileUri: string } }).media.vertexFileUri).toBe("gs://b/video-jobs/7/out.mp4");
    const adminMedia = media();
    const RID2 = "33333333-3333-4333-8333-333333333333";
    await adviseCanvasMontageGrade({ id: 9, role: "admin" }, { ...other, requestId: RID2 }, d, svcDeps(gcs, call), adminMedia);
    expect(adminMedia.loadSucceededJobOutputObjects).not.toHaveBeenCalled();
  });

  it("单价常量双源同为 20，且前端按钮读同一常量", () => {
    expect(SHARED_CREDIT_COSTS.montageGradeAdvice).toBe(20);
    expect(SERVER_CREDIT_COSTS.montageGradeAdvice).toBe(20);
    const src = readFileSync(new URL("../../client/src/components/canvas/MontageGradeAdvice.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/import \{ CREDIT_COSTS \} from "@shared\/plans"/);
    expect(src).toMatch(/CREDIT_COSTS\.montageGradeAdvice/);
    expect(src).not.toMatch(/mvAnalysis/);
    // 按钮与费用确认框文案都只引用常量，不写死数字
    expect(src).toMatch(/MONTAGE_GRADE_ADVICE_COST_ZH = `每次 \$\{MONTAGE_GRADE_ADVICE_PRICE\} 积分/);
    expect(src).not.toMatch(/\d+\s*积分/);
  });
});
