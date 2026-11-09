import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer vertex-test-token" })),
  getVertexProjectId: () => "test-project",
}));

import { geminiAudioJsonWithFallback } from "../gemini-audio";
import {
  MONTAGE_GRADE_ADVICE_MODEL,
  adviceToGradeSegments,
  adviseMontageGrade,
  buildMontageGradePrompt,
  loadGradeLutOptions,
  validateMontageGradeAdvice,
} from "./montageGradeAdvice";

const LUTS = new Set(["golden_hour_subtle", "neo_noir_standard"]);
const ok = () => ({
  segmentsNow: [{ fromSec: 0, toSec: 10, storyZh: "晴", exposureZh: "正常", colorTempZh: "偏暖", saturationZh: "适中", contrastZh: "略平", moodMatch: "match", moodMatchZh: "吻合" }],
  seams: [{ atSec: 6, jump: true, beforeZh: "暖", afterZh: "冷", fixZh: "后段升色温" }],
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
      { startSec: 6, endSec: 10, saturation: 0.8, color_temperature: 7200, curves: { master: "0/0 0.5/0.45 1/1" } },
    ]);
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
