/**
 * 原生读片探针的无 I/O 验收契约。
 * 不导入运行器：生产参数由调用方传入，避免探针与生产执行器循环依赖。
 */
export type NativeProbeCheckStatus = "pass" | "fail" | "not_observed";

export type NativeProbeCheck = {
  id: string;
  nameZh: string;
  status: NativeProbeCheckStatus;
  actualZh: string;
};

export type NativeProbeGenerationConfigValidation = NativeProbeCheck & {
  id: "P1";
  errorsZh: string[];
};

export const NATIVE_PROBE_CHECK_IDS = [
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 只排序对象键，保留数组顺序；非 JSON 值及循环引用关闭式报错。 */
function stableJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || value === null) throw new Error("存在非 JSON 值");
  if (ancestors.has(value)) throw new Error("存在循环引用");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, ancestors)).join(",")}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("存在非普通 JSON 对象");
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(object[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function displayScalar(value: unknown): string {
  if (value === undefined) return "未设置";
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return String(value);
  return "非标量";
}

/**
 * actualConfig 必须来自将要发送的请求 JSON，而非再次传入生产常量自证。
 * expectedConfig 传冻结生产常量；缺失时无法核对 Schema，明确失败而不是猜默认值。
 */
export function validateNativeProbeGenerationConfig(
  actualConfig: unknown,
  expectedConfig: unknown = undefined,
  gradient: readonly number[] = [],
): NativeProbeGenerationConfigValidation {
  const errorsZh: string[] = [];
  const cfg = isRecord(actualConfig) ? actualConfig : {};
  const expected = isRecord(expectedConfig) ? expectedConfig : undefined;
  const thinking = isRecord(cfg.thinkingConfig) ? cfg.thinkingConfig : {};
  if (!isRecord(actualConfig)) errorsZh.push("实际 generationConfig 必须是 JSON 对象");
  if (!expected) errorsZh.push("缺少生产冻结配置，无法核对参数与 Schema");
  if (typeof cfg.temperature !== "number" || !Number.isFinite(cfg.temperature)) {
    errorsZh.push("temperature 必须是有限数字");
  }
  if (cfg.maxOutputTokens !== 65_536) errorsZh.push("maxOutputTokens 必须为 65536");
  if (cfg.candidateCount !== 1) errorsZh.push("candidateCount 必须为 1");
  if (cfg.audioTimestamp !== true) errorsZh.push("audioTimestamp 必须为 true");
  if (cfg.responseMimeType !== "application/json") errorsZh.push("responseMimeType 必须为 application/json");
  if (!isRecord(cfg.responseSchema) || Object.keys(cfg.responseSchema).length === 0) {
    errorsZh.push("responseSchema 必须是非空对象");
  }
  /**
   * MEDIUM 首发已复盘，按用户预先指定条件试 LOW；这不是通用的任意档位开关。
   * 这里仍是独立于 generationConfig 的第二道发车闸，候选改档时必须同步；
   * 后面的完整配置与 Schema 比较照旧，不能只改记录文案或透过守卫换参数。
   */
  if (thinking.thinkingLevel !== "LOW") errorsZh.push("thinkingLevel 必须为 LOW");
  // 用户 0831 当面重申：thinkingBudget 与 thinkingLevel 互斥，只能二选一，此处走 thinkingLevel。
  if ("thinkingBudget" in thinking) errorsZh.push("thinkingBudget 不得与现行 thinkingLevel 同传");
  if (thinking.includeThoughts !== false) errorsZh.push("includeThoughts 必须为 false");
  if (!gradient.length || gradient.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    errorsZh.push("重试梯度必须是非空的有限数字数组");
  } else if (cfg.temperature !== gradient[0]) {
    errorsZh.push("首发 temperature 与重试梯度首档不一致");
  }
  try {
    const actualJson = stableJson(actualConfig);
    if (expected && actualJson !== stableJson(expected)) {
      errorsZh.push("实际序列化配置与生产冻结配置不一致（含 Schema 与额外参数）");
    }
  } catch {
    errorsZh.push("实际配置或生产冻结配置含非 JSON 值，无法可靠核对");
  }
  const actualZh = [
    `temperature=${displayScalar(cfg.temperature)}`,
    `maxOutputTokens=${displayScalar(cfg.maxOutputTokens)}`,
    `candidateCount=${displayScalar(cfg.candidateCount)}`,
    `audioTimestamp=${displayScalar(cfg.audioTimestamp)}`,
    `responseMimeType=${displayScalar(cfg.responseMimeType)}`,
    `thinkingLevel=${displayScalar(thinking.thinkingLevel)}`,
    `thinkingBudget=${displayScalar(thinking.thinkingBudget)}`,
    `includeThoughts=${displayScalar(thinking.includeThoughts)}`,
    `mediaResolution=${displayScalar(cfg.mediaResolution)}`,
    `梯度=[${gradient.map(displayScalar).join(", ")}]`,
    `冻结配置核对=${errorsZh.length ? "失败" : "一致"}`,
  ].join(" · ");
  return {
    id: "P1",
    nameZh: "实际请求参数与生产冻结配置一致",
    status: errorsZh.length ? "fail" : "pass",
    actualZh,
    errorsZh,
  };
}

/** 发车前先记录 P1；校验失败不会执行片源解析、模型调用或其他 execute 内的动作。 */
export async function runNativeProbeAfterGenerationConfigCheck<T>(
  input: {
    actualConfig: unknown;
    expectedConfig: unknown;
    gradient: readonly number[];
    onValidation?: (validation: NativeProbeGenerationConfigValidation) => void | Promise<void>;
  },
  execute: (validation: NativeProbeGenerationConfigValidation) => T | Promise<T>,
): Promise<T> {
  const validation = validateNativeProbeGenerationConfig(input.actualConfig, input.expectedConfig, input.gradient);
  // 调用方可以异步保存 P1；证据尚未保存或保存失败时，不能先启动付费动作。
  await input.onValidation?.(validation);
  if (validation.status !== "pass") throw new Error(`探针 P1 未通过：${validation.errorsZh.join("；")}`);
  return execute(validation);
}

/**
 * 只计算结论，不写文件、不设置 process.exitCode。
 * 调用方必须先永久保存完整摘要，再应用 exitCode：通过 0、失败 1、未观察齐全 2。
 */
export function summarizeNativeProbeChecks(
  checks: ReadonlyArray<Pick<NativeProbeCheck, "id" | "status">>,
  options: { expectedIds?: readonly string[]; runFailed?: boolean } = {},
) {
  const expectedIds = options.expectedIds ?? NATIVE_PROBE_CHECK_IDS;
  const expected = new Set(expectedIds);
  const counts = new Map<string, number>();
  for (const check of checks) counts.set(check.id, (counts.get(check.id) ?? 0) + 1);
  const missingIds = Array.from(expected).filter((id) => !counts.has(id));
  const duplicateIds = Array.from(counts).filter(([, count]) => count !== 1).map(([id]) => id);
  const unexpectedIds = Array.from(counts.keys()).filter((id) => !expected.has(id));
  const idsComplete = expectedIds.length > 0
    && expected.size === expectedIds.length
    && missingIds.length === 0 && duplicateIds.length === 0 && unexpectedIds.length === 0;
  const passCount = checks.filter((check) => check.status === "pass").length;
  const failCount = checks.filter((check) => check.status === "fail").length;
  const notObservedCount = checks.filter((check) => check.status === "not_observed").length;
  const invalidStatusCount = checks.length - passCount - failCount - notObservedCount;
  const acceptanceStatus = options.runFailed || failCount > 0 || !idsComplete || invalidStatusCount > 0
    ? "failed" as const : notObservedCount > 0 ? "incomplete" as const : "passed" as const;
  return {
    acceptanceStatus,
    idsComplete,
    passCount,
    failCount,
    notObservedCount,
    invalidStatusCount,
    missingIds,
    duplicateIds,
    unexpectedIds,
    exitCode: acceptanceStatus === "passed" ? 0 : acceptanceStatus === "failed" ? 1 : 2,
  };
}
