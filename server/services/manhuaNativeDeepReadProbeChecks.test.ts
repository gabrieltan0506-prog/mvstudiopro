import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_PROBE_CHECK_IDS,
  runNativeProbeAfterGenerationConfigCheck,
  summarizeNativeProbeChecks,
  validateNativeProbeGenerationConfig,
  type NativeProbeCheckStatus,
} from "./manhuaNativeDeepReadProbeChecks";

const gradient = [0.7, 0.6, 0.55] as const;
function config(): Record<string, unknown> {
  return {
    temperature: 0.7,
    maxOutputTokens: 65_536,
    candidateCount: 1,
    audioTimestamp: true,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT", properties: { shots: { type: "ARRAY", items: { type: "OBJECT" } } }, required: ["shots"],
    },
    thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: false },
    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
  };
}

describe("探针 P1 实际请求契约", () => {
  it("实际请求经 JSON 序列化后匹配现行 HIGH 配置，并打印实际参数", () => {
    const expected = config();
    const request = JSON.parse(JSON.stringify({ generationConfig: expected }));
    const result = validateNativeProbeGenerationConfig(request.generationConfig, expected, gradient);
    expect(result).toMatchObject({ id: "P1", status: "pass", errorsZh: [] });
    expect(result.actualZh).toContain("thinkingLevel=HIGH");
    expect(result.actualZh).toContain("thinkingBudget=未设置");
    expect(result.actualZh).toContain("mediaResolution=MEDIA_RESOLUTION_MEDIUM");
    expect(result.actualZh).not.toContain("存在（不合规）");
  });

  it.each([
    ["旧 budget-only", { thinkingBudget: 12_000, includeThoughts: false }],
    ["level 与 budget 同传", { thinkingLevel: "HIGH", thinkingBudget: 12_000, includeThoughts: false }],
    ["预算字段即使 undefined 也不是实际 JSON", { thinkingLevel: "HIGH", thinkingBudget: undefined, includeThoughts: false }],
    ["思考摘要开启", { thinkingLevel: "HIGH", includeThoughts: true }],
    // 0831 基准回到 HIGH，故守卫反转：擅自降档到 MEDIUM 才是要拦的那个。
    // 这条守卫的意义始终是「档位不得被 agent 擅自改动」，不是偏爱某一档。
    ["擅自降档 MEDIUM", { thinkingLevel: "MEDIUM", includeThoughts: false }],
  ])("拒绝%s", (_name, thinkingConfig) => {
    expect(validateNativeProbeGenerationConfig({ ...config(), thinkingConfig }, config(), gradient).status).toBe("fail");
  });

  it.each([
    { field: "temperature", value: Number.NaN },
    { field: "temperature", value: Infinity },
    { field: "temperature", value: "0.7" },
    { field: "maxOutputTokens", value: 32_768 },
    { field: "candidateCount", value: 2 },
    { field: "audioTimestamp", value: false },
    { field: "responseMimeType", value: "text/plain" },
    { field: "responseSchema", value: undefined },
    { field: "responseSchema", value: {} },
  ])("拒绝 $field=$value，即使错误值同时出现在期望配置", ({ field, value }) => {
    const actual = { ...config(), [field]: value };
    expect(validateNativeProbeGenerationConfig(actual, actual, gradient).status).toBe("fail");
  });

  it("缺少冻结配置时不能把自己与自己比较冒充已验 Schema", () => {
    const result = validateNativeProbeGenerationConfig(config(), undefined, gradient);
    expect(result.status).toBe("fail");
    expect(result.errorsZh).toContain("缺少生产冻结配置，无法核对参数与 Schema");
  });

  it.each([{ actualGradient: [] }, { actualGradient: [0.7, Number.NaN] }, { actualGradient: [0.6, 0.55] }])("拒绝空、非法或首档错位的梯度 $actualGradient", ({ actualGradient }) => {
    expect(validateNativeProbeGenerationConfig(config(), config(), actualGradient).status).toBe("fail");
  });

  it("对象键顺序变化不误报，Schema 内容及额外参数漂移仍失败", () => {
    const expected = config();
    const reordered = Object.fromEntries(Object.entries(expected).reverse());
    reordered.responseSchema = { required: ["shots"], properties: { shots: { items: { type: "OBJECT" }, type: "ARRAY" } }, type: "OBJECT" };
    expect(validateNativeProbeGenerationConfig(reordered, expected, gradient).status).toBe("pass");
    expect(validateNativeProbeGenerationConfig({ ...reordered, responseSchema: { type: "OBJECT" } }, expected, gradient).status).toBe("fail");
    expect(validateNativeProbeGenerationConfig({ ...reordered, topP: 0.9 }, expected, gradient).status).toBe("fail");
    expect(validateNativeProbeGenerationConfig({ ...reordered, mediaResolution: "MEDIA_RESOLUTION_HIGH" }, expected, gradient).status).toBe("fail");
  });

  it("Schema 数组顺序仍参与冻结比较", () => {
    const expected = { ...config(), responseSchema: { type: "OBJECT", required: ["shots", "subtitles"] } };
    const actual = { ...expected, responseSchema: { type: "OBJECT", required: ["subtitles", "shots"] } };
    expect(validateNativeProbeGenerationConfig(actual, expected, gradient).status).toBe("fail");
  });

  it("循环配置关闭式失败，不抛出失控异常或改写输入", () => {
    const actual = config();
    actual.self = actual;
    const result = validateNativeProbeGenerationConfig(actual, config(), gradient);
    expect(result.status).toBe("fail");
    expect(result.errorsZh).toContain("实际配置或生产冻结配置含非 JSON 值，无法可靠核对");
    expect(actual.self).toBe(actual);
  });

  it("P1 失败先记录，片源解析及付费执行均为零次", async () => {
    const resolveSource = vi.fn();
    const paidRun = vi.fn();
    const execute = vi.fn(async () => { resolveSource(); paidRun(); });
    const onValidation = vi.fn();
    await expect(runNativeProbeAfterGenerationConfigCheck({
      actualConfig: { ...config(), thinkingConfig: { thinkingBudget: 12_000 } },
      expectedConfig: config(), gradient, onValidation,
    }, execute)).rejects.toThrow("探针 P1 未通过");
    expect(onValidation).toHaveBeenCalledWith(expect.objectContaining({ status: "fail" }));
    expect(execute).not.toHaveBeenCalled();
    expect(resolveSource).not.toHaveBeenCalled();
    expect(paidRun).not.toHaveBeenCalled();
  });

  it("P1 通过后才执行一次；执行错误不重试、不吞掉", async () => {
    const order: string[] = [];
    const failure = new Error("实际执行失败");
    const execute = vi.fn(async () => { order.push("execute"); throw failure; });
    await expect(runNativeProbeAfterGenerationConfigCheck({
      actualConfig: config(), expectedConfig: config(), gradient,
      onValidation: () => { order.push("validated"); },
    }, execute)).rejects.toBe(failure);
    expect(order).toEqual(["validated", "execute"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("异步 P1 审计落盘未结束前不得发车", async () => {
    let releaseWrite!: () => void;
    const write = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const execute = vi.fn(() => "执行完成");
    const pending = runNativeProbeAfterGenerationConfigCheck({
      actualConfig: config(), expectedConfig: config(), gradient,
      onValidation: () => write,
    }, execute);
    await Promise.resolve();
    const callsBeforeSaved = execute.mock.calls.length;
    releaseWrite();
    await expect(pending).resolves.toBe("执行完成");
    expect(callsBeforeSaved).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("异步 P1 审计落盘失败时原样报错且零执行", async () => {
    const failure = new Error("P1 审计保存失败");
    const write = Promise.reject(failure);
    // 红测阶段也显式处理此 Promise，避免未等待的旧实现产生无关的未处理拒绝。
    void write.catch(() => undefined);
    const execute = vi.fn(() => "不应执行");
    await expect(runNativeProbeAfterGenerationConfigCheck({
      actualConfig: config(), expectedConfig: config(), gradient,
      onValidation: () => write,
    }, execute)).rejects.toBe(failure);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("探针验收汇总与退出语义", () => {
  const checks = (overrides: Record<string, NativeProbeCheckStatus> = {}) =>
    NATIVE_PROBE_CHECK_IDS.map((id) => ({ id, status: overrides[id] ?? "pass" as NativeProbeCheckStatus }));

  it("十项明确通过才返回 passed 和 0", () => {
    expect(summarizeNativeProbeChecks(checks())).toMatchObject({
      acceptanceStatus: "passed", idsComplete: true, passCount: 10, failCount: 0, notObservedCount: 0, exitCode: 0,
    });
  });

  it("任意 FAIL 返回 failed 和 1，即使运行器完成", () => {
    expect(summarizeNativeProbeChecks(checks({ P6: "fail" }))).toMatchObject({
      acceptanceStatus: "failed", passCount: 9, failCount: 1, exitCode: 1,
    });
  });

  it("未观察不算通过，返回 incomplete 和 2", () => {
    expect(summarizeNativeProbeChecks(checks({ P4: "not_observed" }))).toMatchObject({
      acceptanceStatus: "incomplete", passCount: 9, failCount: 0, notObservedCount: 1, exitCode: 2,
    });
  });

  it("运行失败优先于全部通过或未观察", () => {
    expect(summarizeNativeProbeChecks(checks(), { runFailed: true })).toMatchObject({ acceptanceStatus: "failed", exitCode: 1 });
    expect(summarizeNativeProbeChecks(checks({ P4: "not_observed" }), { runFailed: true }).exitCode).toBe(1);
  });

  it("遗漏、重复、未知 ID 均不得冒充完整验收", () => {
    expect(summarizeNativeProbeChecks(checks().filter((row) => row.id !== "P6"))).toMatchObject({
      acceptanceStatus: "failed", missingIds: ["P6"], idsComplete: false, exitCode: 1,
    });
    expect(summarizeNativeProbeChecks([...checks(), { id: "P1", status: "pass" }])).toMatchObject({ duplicateIds: ["P1"], exitCode: 1 });
    expect(summarizeNativeProbeChecks([...checks(), { id: "P99", status: "pass" }])).toMatchObject({ unexpectedIds: ["P99"], exitCode: 1 });
    expect(summarizeNativeProbeChecks([]).acceptanceStatus).toBe("failed");
    expect(summarizeNativeProbeChecks([], { expectedIds: [] }).acceptanceStatus).toBe("failed");
  });

  it("自定义检查集可复用；汇总不改写输入、不操作退出状态或存储", () => {
    const input = Object.freeze([Object.freeze({ id: "P1", status: "pass" as const })]);
    const oldExitCode = process.exitCode;
    expect(summarizeNativeProbeChecks(input, { expectedIds: ["P1"] })).toMatchObject({ acceptanceStatus: "passed", exitCode: 0 });
    expect(input).toEqual([{ id: "P1", status: "pass" }]);
    expect(process.exitCode).toBe(oldExitCode);
  });
});
