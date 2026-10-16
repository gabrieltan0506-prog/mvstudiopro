import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ get: vi.fn(), touch: vi.fn(), patch: vi.fn(), run: vi.fn() }));
vi.mock("../routers", () => ({ appRouter: {}, buildPlatformContent: vi.fn(), slimBuildPlatformContentDiagnosticsForJob: vi.fn() }));
vi.mock("./repository", async load => ({ ...(await load<Record<string, unknown>>()), getJobByIdStrict: mocks.get, touchJobRunningUpdatedAt: mocks.touch, patchJobRunningProgressStrict: mocks.patch }));
vi.mock("../services/songOperations.js", () => ({ runSongOperationJob: mocks.run }));
import { abortRunningSongOperationJob, processSongOperationJob } from "./runner";
const input = { action: "song_operation", params: { requestId: "request-1" } };
const params = { input, timeoutMs: 8 * 60_000, userId: "42", jobId: "song-job-1" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ id: params.jobId, type: "audio", status: "running", userId: "42", input });
  mocks.touch.mockResolvedValue(true); mocks.patch.mockResolvedValue(true);
  mocks.run.mockResolvedValue({ status: "succeeded", requestId: "request-1", variants: [] });
});
afterEach(() => { vi.useRealTimers(); });
describe("歌曲操作runner接线（模拟服务，不代表正式任务验收）", () => {
  it("只让succeeded成功并先保存terminalOutput；参数带当前账号和原requestId", async () => {
    const result = await processSongOperationJob(params);
    expect(result).toEqual({ output: { status: "succeeded", requestId: "request-1", variants: [], audioUrls: [] }, provider: "song-operation" });
    expect(mocks.run).toHaveBeenCalledWith(42, "request-1", expect.objectContaining({ signal: expect.any(AbortSignal), onHeartbeat: expect.any(Function) }));
    expect(mocks.patch).toHaveBeenCalledWith("song-job-1", { songOperationRequestId: "request-1", songOperationStatus: "succeeded", terminalOutput: result.output });
    expect(abortRunningSongOperationJob(params.jobId)).toBe(false);
  });
  it.each(["failed", "reconcile_required", "payment_pending", "pending"])("%s保存真实回执但不误报job成功", async status => {
    mocks.run.mockResolvedValue({ status, requestId: "request-1" });
    await expect(processSongOperationJob(params)).rejects.toThrow();
    expect(mocks.patch).toHaveBeenCalledWith(params.jobId, expect.objectContaining({ songOperationStatus: status, terminalOutput: { status, requestId: "request-1", variants: [] } }));
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("异账号或异requestId在服务调用前拒绝", async () => {
    mocks.get.mockResolvedValue({ type: "audio", status: "running", userId: "43", input });
    await expect(processSongOperationJob(params)).rejects.toThrow("归属");
    mocks.get.mockResolvedValue({ type: "audio", status: "running", userId: "42", input: { ...input, params: { requestId: "other" } } });
    await expect(processSongOperationJob(params)).rejects.toThrow("归属");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("数据库心跳失败不续期也不虚报成功", async () => {
    mocks.touch.mockResolvedValue(false);
    mocks.run.mockImplementation(async (_u, _r, options) => { await options.onHeartbeat(); return { status: "succeeded" }; });
    await expect(processSongOperationJob(params)).rejects.toThrow("心跳");
    expect(mocks.patch).not.toHaveBeenCalled();
  });
  it("有效业务心跳超过原8分钟仍继续；显式中止贯通signal", async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    let captured: { signal: AbortSignal; onHeartbeat: () => Promise<void> } | undefined;
    mocks.run.mockImplementation((_u, _r, options) => {
      captured = options;
      ready();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    });
    const work = processSongOperationJob(params);
    const assertion = expect(work).rejects.toThrow("中止");
    await started;
    for (let n = 0; n < 12; n++) { await captured!.onHeartbeat(); await vi.advanceTimersByTimeAsync(60_000); }
    expect(captured!.signal.aborted).toBe(false);
    expect(mocks.touch).toHaveBeenCalledTimes(12);
    expect(abortRunningSongOperationJob(params.jobId)).toBe(true);
    await assertion;
  });
  it("8分钟无真实心跳会abort，不允许孤儿服务继续提交", async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    let signal: AbortSignal | undefined;
    mocks.run.mockImplementation((_u, _r, options) => {
      signal = options.signal;
      ready();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    });
    const assertion = expect(processSongOperationJob(params)).rejects.toThrow("心跳");
    await started;
    await vi.advanceTimersByTimeAsync(8 * 60_000 + 15_000);
    await assertion;
    expect(signal?.aborted).toBe(true); expect(mocks.touch).not.toHaveBeenCalled();
  });
  it("runner对该action不启用空转心跳、不进通用重排且外层超时abort", () => {
    const source = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    expect(source).toContain("if (!distillHeartbeat && !songOperationJob) stopWorkerHeartbeat");
    expect(source).toContain("onTimeout: () => { abortRunningSongOperationJob(job.id); }");
    const branch = source.slice(source.indexOf('if (job.type === "audio" && isRecord(job.input) && job.input.action === "song_operation")'));
    expect(branch.slice(0, branch.indexOf("// 结算已登记时"))).toContain("await markJobFailed");
    expect(branch.slice(0, branch.indexOf("// 结算已登记时"))).not.toContain("requeueJob");
  });
});

describe("歌曲运行前中止与状态补验", () => {
  it("数据库读取中已中止，读取恢复后也不能进入供应商业务", async () => {
    let finish!: (value: unknown) => void;
    mocks.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const work = processSongOperationJob(params);
    const assertion = expect(work).rejects.toThrow("中止");
    expect(abortRunningSongOperationJob(params.jobId)).toBe(true);
    finish({ type: "audio", status: "running", userId: "42", input });
    await assertion;
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("非运行任务拒绝进入业务，正常运行可继续", async () => {
    mocks.get.mockResolvedValueOnce({ type: "audio", status: "failed", userId: "42", input });
    await expect(processSongOperationJob(params)).rejects.toThrow("运行状态");
    expect(mocks.run).not.toHaveBeenCalled();
    await expect(processSongOperationJob(params)).resolves.toMatchObject({ provider: "song-operation" });
  });
});

describe("R1结算产物公开边界", () => {
  it("成功后登记全部音频供succeeded job验主，不丢变体", async () => {
    const variants = [0, 1].map(index => ({ index, gcsUri: `gs://bucket/song-operation-media/42/request-1/concat/${index}.mp3` }));
    mocks.run.mockResolvedValue({ status: "succeeded", requestId: "request-1", variants });
    const result = await processSongOperationJob(params);
    expect(result.output).toEqual({ status: "succeeded", requestId: "request-1", variants, audioUrls: variants.map(v => v.gcsUri) });
    expect(mocks.patch.mock.calls[0][1].terminalOutput).toEqual(result.output);
  });
  it("payment_pending即使误带产物，checkpoint也不公开音频风格或字幕", async () => {
    mocks.run.mockResolvedValue({ status: "payment_pending", requestId: "request-1", variants: [{gcsUri: "gs://bucket/private.mp3"}], persona: {id: "private-persona"}, alignment: {words: [{text: "秘密"}], srt: "secret"} });
    await expect(processSongOperationJob(params)).rejects.toThrow("结算");
    const output = mocks.patch.mock.calls[0][1].terminalOutput;
    expect(output).toEqual({ status: "payment_pending", requestId: "request-1", variants: [] });
    expect(output).not.toHaveProperty("audioUrls");
  });
});
