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
import { adviseCanvasMontageGrade } from "../routers/canvasMusicMv";
import {
  MONTAGE_GRADE_ADVICE_MODEL,
  MontageGradeAdviceRequestUsedError,
  adviceToGradeSegments,
  adviseMontageGrade,
  buildMontageGradePrompt,
  loadGradeLutOptions,
  validateMontageGradeAdvice,
} from "./montageGradeAdvice";

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
    fetchMock.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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
