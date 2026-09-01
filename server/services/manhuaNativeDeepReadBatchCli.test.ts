import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 整个CLI的文件、对象存储和模型边界均为虚构依赖，测试绝不加载凭证或联网。
const mocks = vi.hoisted(() => ({
  dotenv: vi.fn(), readFile: vi.fn(), isEnabled: vi.fn(), resolveNodes: vi.fn(),
  listIngested: vi.fn(), listClaims: vi.fn(), validate: vi.fn(), runBatch: vi.fn(),
}));
vi.mock("dotenv", () => ({ config: mocks.dotenv }));
vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.readFile } }));
vi.mock("./manhuaNativeDeepReadRunner.ts", () => ({
  isManhuaNativeDeepReadEnabled: mocks.isEnabled,
  resolveNativeDeepReadNodeUrls: mocks.resolveNodes,
  resolveNativeDeepReadRequestFps: (_duration: number, fps?: number) => fps ?? 10,
}));
vi.mock("./manhuaNativeDeepReadIngest.ts", () => ({ listIngestedNativeDeepReadEpisodes: mocks.listIngested }));
vi.mock("./manhuaNativeDeepReadClaim.ts", () => ({
  listNativeDeepReadEpisodeClaimStates: mocks.listClaims,
  isNativeDeepReadClaimReclaimable: () => false,
}));
vi.mock("./manhuaNativeDeepReadExecution.ts", () => ({
  NATIVE_DEEP_READ_BATCH_HARD_CEILING: 100,
  NATIVE_DEEP_READ_DEFAULT_BATCH_EPISODES: 20,
  NATIVE_DEEP_READ_MAX_SEGMENT_SEC: 7200,
  validateNativeDeepReadBatchPlan: mocks.validate,
  runNativeDeepReadBatch: mocks.runBatch,
}));

const originalArgv = process.argv;
function episode(videoFps: unknown = undefined, segmentSeconds: unknown = undefined) {
  return {
    episodeIndex: 1, sourceUrl: "https://example.invalid/test-episode", durationSec: 319,
    segments: [{ startSec: 0, endSec: 319 }],
    ...(videoFps === undefined ? {} : { videoFps }),
    ...(segmentSeconds === undefined ? {} : { segmentSeconds }),
  };
}
async function runCli(args: string[], flyApp = "") {
  vi.stubEnv("FLY_APP_NAME", flyApp);
  process.argv = [process.execPath, "test-batch-cli", "--series=test-series", "--list=/never-read-on-local.json", ...args];
  const entry = await import("../../scripts/manhua-native-deep-read-batch.mts");
  return entry.main();
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.isEnabled.mockReturnValue(true);
  mocks.readFile.mockResolvedValue(JSON.stringify([episode()]));
  mocks.listIngested.mockResolvedValue(new Set());
  mocks.listClaims.mockResolvedValue(new Map());
  mocks.resolveNodes.mockResolvedValue([{ url: "https://example.invalid/media.mp4", referer: "https://example.invalid/" }]);
  mocks.validate.mockReturnValue({
    totalDurationSec: 319, totalSegments: 1, totalVisualCalls: 1, totalModelCalls: 2,
    planHash: "test-confirmation",
  });
  mocks.runBatch.mockRejectedValue(new Error("测试拦截执行，未调用模型"));
  vi.spyOn(process, "exit").mockImplementation((code): never => { throw new Error(`测试退出:${code}`); });
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("原生读片批处理CLI凭证边界与参数投影", () => {
  it("本机只导入模块不触发清单、GCS或模型动作", async () => {
    vi.stubEnv("FLY_APP_NAME", "");
    process.argv = [process.execPath, "test-import-only"];
    const entry = await import("../../scripts/manhua-native-deep-read-batch.mts");
    expect(typeof entry.main).toBe("function");
    for (const boundary of [mocks.dotenv, mocks.readFile, mocks.listIngested, mocks.listClaims, mocks.validate, mocks.runBatch]) {
      expect(boundary).not.toHaveBeenCalled();
    }
    expect(process.exit).not.toHaveBeenCalled();
  });
  it.each(["--dry-run", "--go"])("本机%s在读取清单、GCS与模型调用前拒绝，也不加载dotenv", async (mode) => {
    await expect(runCli([mode])).rejects.toThrow("测试退出:1");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Fly"));
    for (const boundary of [mocks.dotenv, mocks.readFile, mocks.listIngested, mocks.listClaims, mocks.resolveNodes, mocks.validate, mocks.runBatch]) {
      expect(boundary).not.toHaveBeenCalled();
    }
  });

  it.each([undefined, 12, 0.5, 24])("清单fps=%s按共享规则进入预检与正式执行，不被投影丢掉", async (fps) => {
    mocks.readFile.mockResolvedValue(JSON.stringify([episode(fps)]));
    await expect(runCli(["--go", "--confirm=test-confirmation", "--max-calls=2"], "mvstudiopro"))
      .rejects.toThrow("测试拦截执行，未调用模型");
    expect(mocks.dotenv).not.toHaveBeenCalled();
    expect(mocks.validate).toHaveBeenCalledTimes(2);
    for (const [episodes] of mocks.validate.mock.calls) expect(episodes[0].videoFps).toBe(fps ?? 12);
    const submitted = mocks.runBatch.mock.calls[0][0].episodes[0];
    expect(submitted.videoFps).toBe(fps ?? 12);
    expect(submitted.segments).toEqual([{ startSec: 0, endSec: 319 }]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`第1集：${fps ?? 12}fps`));
    await expect(submitted.resolveNodes()).resolves.toEqual([
      { url: "https://example.invalid/media.mp4", referer: "https://example.invalid/" },
    ]);
  });

  it.each([undefined, 281, 300, 7200])("清单分片上限=%s进入两次预检与正式执行，缺省显式锁300", async (segmentSeconds) => {
    mocks.readFile.mockResolvedValue(JSON.stringify([episode(10, segmentSeconds)]));
    await expect(runCli(["--go", "--confirm=test-confirmation", "--max-calls=2"], "mvstudiopro"))
      .rejects.toThrow("测试拦截执行，未调用模型");
    const expected = segmentSeconds ?? 300;
    expect(mocks.validate).toHaveBeenCalledTimes(2);
    for (const [episodes] of mocks.validate.mock.calls) {
      expect(episodes[0].segmentSeconds).toBe(expected);
    }
    expect(mocks.runBatch.mock.calls[0][0].episodes[0].segmentSeconds).toBe(expected);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`第1集：${expected}s上限`));
  });

  it.each([null, "", false, 0, -1, 24.1])("非法fps=%s在列GCS前拒绝，不静默回落缺省值", async (fps) => {
    mocks.readFile.mockResolvedValue(JSON.stringify([episode(fps)]));
    await expect(runCli(["--dry-run"], "mvstudiopro")).rejects.toThrow("测试退出:1");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("fps"));
    expect(mocks.listIngested).not.toHaveBeenCalled();
    expect(mocks.listClaims).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it.each([null, "", false, 0, -1, 1.5, 7201])("非法分片上限=%s在列GCS前拒绝，不绕过到付费入口", async (segmentSeconds) => {
    mocks.readFile.mockResolvedValue(JSON.stringify([episode(10, segmentSeconds)]));
    await expect(runCli(["--dry-run"], "mvstudiopro")).rejects.toThrow("测试退出:1");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("分片时长"));
    expect(mocks.listIngested).not.toHaveBeenCalled();
    expect(mocks.listClaims).not.toHaveBeenCalled();
    expect(mocks.runBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong", 2], ["test-confirmation", 3],
  ])("确认码=%s、调用上限=%s不符时仍然拒绝执行", async (confirmation, maxCalls) => {
    await expect(runCli(["--go", `--confirm=${confirmation}`, `--max-calls=${maxCalls}`], "mvstudiopro")).rejects.toThrow("测试退出:1");
    expect(mocks.runBatch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("真跑必须携带"));
  });

  it("旧批处理入口纳入探针类型检查，避免节点返回形状错误漏检", () => {
    const config = JSON.parse(readFileSync("tsconfig.native-probe.json", "utf8"));
    expect(config.include).toContain("scripts/manhua-native-deep-read-batch.mts");
  });
});
