import { describe, expect, it } from "vitest";
import {
  NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH,
  NATIVE_DEEP_READ_RESUME_SERIES_MISMATCH_ZH,
  assertNativeDeepReadResumeSeriesPlan,
  hasNativeDeepReadJobFields,
  nativeDeepReadResumeLaneModel,
  nativeDeepReadSeriesKeyForModel,
  parseNativeDeepReadJobConfirmation,
  parseNewNativeDeepReadJobConfirmation,
  readNativeDeepReadResumeSeriesKey,
} from "./manhuaNativeDeepReadJob";

const params = { url: "https://www.douyin.com/video/12345", batchSize: 1,
  nativeDeepReadConfirmed: true, nativeMaxCalls: 200, nativePlanLimit: 1 };
const MODEL_NAME_PATTERN = /gemini|argon|flash|pro\b|3\.8|3\.1|g4a|g38f/i;

describe("已入库系列按原保存模型续学（#1771 回归）", () => {
  it("未配置 Argon 时：已入库的 -g4a 系列照旧按 Argon 续学，不被当前配置拒收", () => {
    const resumed = parseNewNativeDeepReadJobConfirmation(
      { ...params, nativeReadModel: "gemini-4-argon", nativeResumeSeriesKey: "abc123-g4a" },
      { env: {}, storedSeriesKey: "abc123-g4a" },
    );
    expect(resumed.readModel).toBe("gemini-4-argon");
    // 续学落回同一系列车道，段缓存 / 已付费证据身份不变
    expect(nativeDeepReadSeriesKeyForModel("abc123-g4a", resumed.readModel)).toBe("abc123-g4a");
    // worker 侧按保存的模型恢复，与当前配置无关
    expect(parseNativeDeepReadJobConfirmation({ ...params, nativeReadModel: resumed.readModel }).readModel).toBe("gemini-4-argon");
  });

  it("客户端没带模型时，已入库系列仍按系列模型续学，不换成当前配置模型", () => {
    const env = { MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash" };
    expect(parseNewNativeDeepReadJobConfirmation(params, { env, storedSeriesKey: "abc-g4a" }).readModel).toBe("gemini-4-argon");
    expect(parseNewNativeDeepReadJobConfirmation(params, { env, storedSeriesKey: "abc-g38f" }).readModel).toBe("gemini-3.8-flash");
  });

  it("配置换成别的模型后，旧配置模型车道（-gm-）的已入库系列仍按原模型续学", () => {
    const key = nativeDeepReadSeriesKeyForModel("abc123", "gemini-3.9-flash");
    const env = { MANHUA_DEEP_READ_MODEL: "gemini-4.0-flash" };
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-3.9-flash" }, { env }))
      .toThrow(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-3.9-flash" }, { env, storedSeriesKey: key }).readModel)
      .toBe("gemini-3.9-flash");
  });

  it("不拿别的模型去续这个系列：显式模型与系列模型不一致即拒收，哪怕该模型当前可新发", () => {
    expect(() => parseNewNativeDeepReadJobConfirmation(
      { ...params, nativeReadModel: "gemini-3.8-flash" }, { env: {}, storedSeriesKey: "abc-g4a" },
    )).toThrow(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
    expect(() => parseNewNativeDeepReadJobConfirmation(
      { ...params, nativeReadModel: "gemini-4-argon" }, { env: { MANHUA_DEEP_READ_MODEL: "gemini-4-argon" }, storedSeriesKey: "abc-g38f" },
    )).toThrow(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
  });

  it("新系列才用配置模型：没有服务端核实过的系列键，客户端只声明续学不作数", () => {
    // 客户端自带 nativeResumeSeriesKey 但服务端未核实（未传 storedSeriesKey）→ 仍按新任务规则拒收
    expect(() => parseNewNativeDeepReadJobConfirmation(
      { ...params, nativeReadModel: "gemini-4-argon", nativeResumeSeriesKey: "abc-g4a" }, { env: {} },
    )).toThrow(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
    expect(parseNewNativeDeepReadJobConfirmation(params, { env: {} }).readModel).toBe("gemini-3.8-flash");
    expect(parseNewNativeDeepReadJobConfirmation(params, { env: { MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash" } }).readModel).toBe("gemini-3.9-flash");
  });

  it("无后缀的历史车道不因续学重启：仍按配置模型（另起车道），显式要旧模型照旧拒收", () => {
    expect(nativeDeepReadResumeLaneModel("abc123")).toBeUndefined();
    const resumed = parseNewNativeDeepReadJobConfirmation(params, { env: {}, storedSeriesKey: "abc123" });
    expect(resumed.readModel).toBe("gemini-3.8-flash");
    expect(nativeDeepReadSeriesKeyForModel("abc123", resumed.readModel)).toBe("abc123-g38f");
    expect(() => parseNewNativeDeepReadJobConfirmation(
      { ...params, nativeReadModel: "gemini-3.1-pro-preview" }, { env: {}, storedSeriesKey: "abc123" },
    )).toThrow(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
  });

  it("拒收提示不含模型名", () => {
    for (const message of [NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH, NATIVE_DEEP_READ_RESUME_SERIES_MISMATCH_ZH]) {
      expect(message).not.toMatch(MODEL_NAME_PATTERN);
    }
    let thrown = "";
    try {
      parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-4-argon" }, { env: {} });
    } catch (error) { thrown = (error as Error).message; }
    expect(thrown).toBe(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
  });

  it("续学系列键：格式校验、属原生精读字段（无确认的旁路任务关闭式拒绝）", () => {
    expect(readNativeDeepReadResumeSeriesKey({})).toBeUndefined();
    expect(readNativeDeepReadResumeSeriesKey({ nativeResumeSeriesKey: "abc-g4a" })).toBe("abc-g4a");
    for (const bad of ["../x", "a/b", "a".repeat(41), 12, {}]) {
      expect(() => readNativeDeepReadResumeSeriesKey({ nativeResumeSeriesKey: bad })).toThrow("续学系列标识无效");
    }
    expect(hasNativeDeepReadJobFields({ nativeResumeSeriesKey: "abc-g4a" })).toBe(true);
  });
});

describe("worker 续学绑定：非配置模型只能落在被续的那个系列", () => {
  it("计划系列 = 续学系列 → 放行；无续学键 → 不干预", () => {
    expect(() => assertNativeDeepReadResumeSeriesPlan({ resumeSeriesKey: "abc-g4a", readModel: "gemini-4-argon", planSeriesKey: "abc-g4a", env: {} })).not.toThrow();
    expect(() => assertNativeDeepReadResumeSeriesPlan({ readModel: "gemini-4-argon", planSeriesKey: "zzz-g4a", env: {} })).not.toThrow();
  });
  it("计划解析成另一个系列且模型当前不可新发 → 拒收，不用非配置模型另起新系列", () => {
    expect(() => assertNativeDeepReadResumeSeriesPlan({ resumeSeriesKey: "abc-g4a", readModel: "gemini-4-argon", planSeriesKey: "zzz-g4a", env: {} }))
      .toThrow(NATIVE_DEEP_READ_RESUME_SERIES_MISMATCH_ZH);
  });
  it("模型当前可新发（配置模型 / 3.8 Flash 车道）时沿用既有行为，不因系列键不同拒收", () => {
    expect(() => assertNativeDeepReadResumeSeriesPlan({ resumeSeriesKey: "abc-g38f", readModel: "gemini-3.8-flash", planSeriesKey: "zzz-g38f", env: {} })).not.toThrow();
    expect(() => assertNativeDeepReadResumeSeriesPlan({ resumeSeriesKey: "abc-g4a", readModel: "gemini-4-argon", planSeriesKey: "zzz-g4a",
      env: { MANHUA_DEEP_READ_MODEL: "gemini-4-argon" } })).not.toThrow();
  });
});
