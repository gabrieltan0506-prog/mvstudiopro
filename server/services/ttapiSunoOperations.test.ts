import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTtapiSunoOperationRequest, getTtapiSunoOperationTask, submitTtapiSunoOperation, type TtapiSunoOperationRequest } from "./ttapiSunoOperations";
import type { TtapiSunoEvidenceSink } from "./ttapiSunoMusic";
const evidence = vi.fn<TtapiSunoEvidenceSink>();
const opts = { evidence };
const job = "test-job-123456";
const requests: TtapiSunoOperationRequest[] = [
  { operation: "upload_cover", model: "suno-v6", audioUrl: "https://cdn.example/a.mp3", instrumental: false, prompt: "原词", title: "歌", style: "爵士", personaId: "persona-1", audioWeight: 0.6 },
  { operation: "extend", musicId: "music-1", continueAt: 21, prompt: "后半段", duration: 120 },
  { operation: "upload_extend", model: "suno-v6-mini", audioUrl: "https://cdn.example/a.mp3", continueAt: 12, prompt: "继续" },
  { operation: "replace_section", model: "suno-v6", musicId: "music-1", infillStartSec: 3, infillEndSec: 7, prompt: "上下文", infillLyrics: "新词" },
  { operation: "persona", musicId: "music-1", name: "清亮", description: "温柔", vocalStartSec: 2, vocalEndSec: 9, style: "民谣" },
  { operation: "aligned_lyrics", musicId: "music-1" },
  { operation: "stems_all", musicId: "music-1" },
];
let response: unknown;
let httpStatus = 200;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("TTAPI_KEY", "test-key");
  evidence.mockReset().mockResolvedValue(undefined);
  response = { status: "SUCCESS", data: { jobId: job } }; httpStatus = 200;
  fetchMock = vi.fn(async () => new Response(typeof response === "string" ? response : JSON.stringify(response), { status: httpStatus }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("MV歌曲操作供应商契约（离线夹具，不是线上验收）", () => {
  it("七种入口仅发送文档字段，续写不附加模型，局部改词不附加其它生成控制", () => {
    const built = requests.map(buildTtapiSunoOperationRequest);
    expect(built.map(b => b.path)).toEqual(["upload-cover", "extend", "upload-extend", "replace-section", "persona", "alignedLyrics", "stems-all"].map(p => `/suno/v1/${p}`));
    expect(built[0].body).toMatchObject({ mv: "chirp-v6", audio_url: "https://cdn.example/a.mp3", persona_id: "persona-1", audio_weight: 0.6, custom: true, instrumental: false, prompt: "原词", max_mode: false, auto_lyrics: false });
    expect(built[1].body).toMatchObject({ music_id: "music-1", continue_at: 21, duration: 120 });
    expect(built[1].body).not.toHaveProperty("mv");
    expect(built[2].body).toMatchObject({ mv: "chirp-v6-mini", continue_at: 12 });
    expect(built[3].body).toMatchObject({ infill_start_s: 3, infill_end_s: 7, infill_lyrics: "新词", prompt: "上下文" });
    expect(built[3].body).not.toHaveProperty("auto_lyrics");
    expect(built[4].body).toEqual({ music_id: "music-1", name: "清亮", describe: "温柔", vocal_start_s: 2, vocal_end_s: 9, styles: "民谣" });
    expect(built[5].body).toEqual({ music_id: "music-1" });
    expect(built[6].body).toEqual({ music_id: "music-1", audio_format: "mp3" });
  });
  it.each([0, 1, 2, 3, 6])("异步操作 %i 只建单一次并返回原编号", async i => {
    const out = await submitTtapiSunoOperation(requests[i], opts);
    expect(out).toMatchObject({ kind: "task", jobId: job, taskId: `ttapi:${job}` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(evidence.mock.calls.map(c => c[0].kind)).toEqual(["request", "raw", "parsed"]);
    expect(evidence.mock.calls.some(c => c[0].body.includes("test-key"))).toBe(false);
  });
  it("同步persona返回真实ID，不编造任务号", async () => {
    response = { status: "SUCCESS", data: { persona_id: "persona-real", extra: "完整保留" } };
    expect(await submitTtapiSunoOperation(requests[4], opts)).toEqual({ kind: "persona", personaId: "persona-real", rawData: { persona_id: "persona-real", extra: "完整保留" } });
  });
  it("对齐逐项保留超过固定上限的词和质量标记", async () => {
    const alignment = Array.from({ length: 401 }, (_, i) => ({ word: `词${i}`, start_s: i, end_s: i + 0.5, success: i !== 2, p_align: 0.95 }));
    response = { status: "SUCCESS", data: { status: "complete", alignment, waveform_data: [1, 2] } };
    const out = await submitTtapiSunoOperation(requests[5], opts);
    expect(out.kind).toBe("alignment");
    if (out.kind !== "alignment") throw new Error("错误返回类型");
    expect(out.words).toHaveLength(401); expect(out.words[2].success).toBe(false);
    expect(out.rawData.alignment).toEqual(alignment);
    expect(out.words[400]).toEqual({ text: "词400", startSec: 400, endSec: 400.5, success: true });
  });
  it("未完成的同步对齐保留回执，不自动再发POST", async () => {
    response = { status: "SUCCESS", data: { status: "processing" } };
    expect(await submitTtapiSunoOperation(requests[5], opts)).toMatchObject({ kind: "alignment", status: "pending" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([{ alignment: [] }, { alignment: [{ word: "字", start_s: 1, end_s: 0 }] }, { alignment: [{ word: "字", start_s: null, end_s: 2 }] }])("空或错误时间轴不得当成完成：%j", async ({ alignment }) => {
    response = { status: "SUCCESS", data: { status: "complete", alignment } };
    await expect(submitTtapiSunoOperation(requests[5], opts)).rejects.toMatchObject({ code: "invalid_response", submissionUnknown: true });
  });
  it("12轨同URL仍保留全部ID、类型、原数据和配额", async () => {
    const musics = Array.from({ length: 12 }, (_, i) => ({ musicId: `stem-${i}`, audioUrl: "https://cdn.example/shared.mp3", duration: "125.1", title: `轨${i}`, stem_type: `type-${i}`, unknown: i }));
    response = { status: "SUCCESS", data: { musics, quota: "50" } };
    const out = await getTtapiSunoOperationTask(`ttapi:${job}`, opts);
    expect(out.status).toBe("completed"); expect(out.musics).toHaveLength(12);
    expect(out.musics[11]).toMatchObject({ musicId: "stem-11", stemType: "type-11", duration: 125.1, rawData: musics[11] });
    expect(out.rawData.quota).toBe("50");
  });
  it("未就绪条目不被过滤，成功但缺音频不得完成", async () => {
    response = { status: "ON_QUEUE", data: { progress: "50%", musics: [{ musicId: "pending" }] } };
    expect(await getTtapiSunoOperationTask(`ttapi:${job}`, opts)).toMatchObject({ status: "pending", progress: 50, musics: [{ musicId: "pending" }] });
    response = { status: "SUCCESS", data: { musics: [{ musicId: "pending" }] } };
    await expect(getTtapiSunoOperationTask(`ttapi:${job}`, opts)).rejects.toMatchObject({ code: "invalid_response", submissionUnknown: false });
  });
  it("未知提交与归档失败均不重发", async () => {
    fetchMock.mockRejectedValueOnce(new Error("断线"));
    await expect(submitTtapiSunoOperation(requests[0], opts)).rejects.toMatchObject({ submissionUnknown: true });
    evidence.mockImplementation(async e => { if (e.kind === "raw") throw new Error("保存失败"); });
    await expect(submitTtapiSunoOperation(requests[0], opts)).rejects.toMatchObject({ submissionUnknown: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("明确拒绝与5xx未知区分，畸形成功也保留未知", async () => {
    httpStatus = 429;
    await expect(submitTtapiSunoOperation(requests[0], opts)).rejects.toMatchObject({ submissionUnknown: false, httpStatus: 429 });
    httpStatus = 503;
    await expect(submitTtapiSunoOperation(requests[0], opts)).rejects.toMatchObject({ submissionUnknown: true });
    httpStatus = 200; response = { status: "SUCCESS", data: {} };
    await expect(submitTtapiSunoOperation(requests[0], opts)).rejects.toMatchObject({ submissionUnknown: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("无永久归档器或请求归档失败不能发请求", async () => {
    await expect(submitTtapiSunoOperation(requests[0], {} as typeof opts)).rejects.toThrow("归档器");
    evidence.mockRejectedValue(new Error("请求存储失败"));
    await expect(submitTtapiSunoOperation(requests[0], opts)).rejects.toThrow("请求存储失败");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { operation: "upload_cover", model: "suno-v6", audioUrl: "http://example/a", instrumental: true },
    { operation: "upload_cover", model: "suno-v6", audioUrl: "https://example/a", instrumental: false },
    { operation: "upload_extend", model: "suno-v6", audioUrl: "https://example/a", continueAt: 0 },
    { operation: "replace_section", model: "suno-v6", musicId: "m", infillStartSec: 5, infillEndSec: 4 },
    { operation: "extend", musicId: "m", continueAt: 2, duration: 400 },
    { operation: "extend", musicId: "m", continueAt: 2, styleWeight: 2 },
    { operation: "extend", musicId: "m", continueAt: 2, title: "长".repeat(81) },
  ])("非法输入在发请求前拒绝 %j", async req => {
    await expect(submitTtapiSunoOperation(req as TtapiSunoOperationRequest, opts)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// 第二轮只新增衔接与任务身份核对；前24项证据复用13:34:51回执。
describe("衔接与任务身份定向补验", () => {
  it("concat把续写或修歌返回musicId发往免费衔接端点，仍仅建单一次", async () => {
    const req = { operation: "concat" as const, musicId: "extended-version-2" };
    expect(buildTtapiSunoOperationRequest(req)).toEqual({ path: "/suno/v1/concat", body: { music_id: "extended-version-2", audio_format: "mp3" } });
    expect(await submitTtapiSunoOperation(req, opts)).toMatchObject({ kind: "task", jobId: job });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("concat归档失败仍未知且不重发", async () => {
    evidence.mockImplementation(async e => { if (e.kind === "raw") throw new Error("保存失败"); });
    await expect(submitTtapiSunoOperation({ operation: "concat", musicId: "extended-version-2" }, opts)).rejects.toMatchObject({ submissionUnknown: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("查询拒绝异任务回执，带一致编号时保留全部轨道", async () => {
    const musics = [{ musicId: "m1", audioUrl: "https://cdn.example/a.mp3" }];
    response = { status: "SUCCESS", jobId: "other-job", data: { jobId: job, musics } };
    await expect(getTtapiSunoOperationTask(`ttapi:${job}`, opts)).rejects.toMatchObject({ code: "invalid_response" });
    response = { status: "SUCCESS", jobId: job, data: { jobId: job, musics } };
    expect(await getTtapiSunoOperationTask(`ttapi:${job}`, opts)).toMatchObject({ status: "completed", musics: [{ musicId: "m1" }] });
  });
});
