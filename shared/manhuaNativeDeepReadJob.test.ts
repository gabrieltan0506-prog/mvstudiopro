import { describe, expect, it, vi } from "vitest";
import {
  hasNativeDeepReadJobFields,
  NATIVE_DEEP_READ_JOB_MAX_CALLS,
  NATIVE_DEEP_READ_JOB_MAX_WALL_MS,
  parseNativeDeepReadSegmentSeconds,
  parseNativeDeepReadVideoFps,
  parseNativeDeepReadJobConfirmation,
  parseNewNativeDeepReadJobConfirmation,
  nativeDeepReadSeriesKeyForModel,
  nativeDeepReadModelForSeriesKey,
  nativeDeepReadAllowedNewReadModels,
  nativeDeepReadSegmentCacheIdentityModel,
  isNativeDeepReadCurrentContractModel,
  parseNativeDeepReadModel,
  resolveManhuaNativeDeepReadModel,
  resolveManhuaNativeDeepReadEscalationModel,
  resolveNativeDeepReadJobTimeoutMs,
  sameNativeDeepReadJobConfirmation,
  MANHUA_NATIVE_NEW_READ_MODEL_OPTIONS,
  MANHUA_NATIVE_CARBON_MODEL,
  NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH,
  parseNativeDeepReadReadTier,
  isNativeDeepReadCarbonLaneModel,
  nativeDeepReadCarbonRoutes,
} from "./manhuaNativeDeepReadJob.js";

describe("原生精读任务墙钟", () => {
  it("采样率独立设置，319秒/12fps不被旧10fps上限截断", () => {
    expect(parseNativeDeepReadVideoFps(undefined)).toBe(12);
    for (const fps of [0.1, 5, 10, 12, 24]) {
      expect(parseNativeDeepReadVideoFps(fps)).toBe(fps);
      expect(parseNativeDeepReadVideoFps(String(fps))).toBe(fps);
    }
    expect(hasNativeDeepReadJobFields({ nativeVideoFps: 12 })).toBe(true);
    expect(parseNativeDeepReadJobConfirmation({
      url: "https://www.douyin.com/video/12345",
      batchSize: 1, nativeDeepReadConfirmed: true, nativeMaxCalls: 200,
      nativePlanLimit: 1, nativeSegmentSeconds: 319, nativeVideoFps: 12,
    })).toMatchObject({ segmentSeconds: 319, videoFps: 12 });
  });

  it.each([null, "", true, [], {}, 0, -1, NaN, Infinity, 24.1])("非法 fps %j 不进入任务", (fps) => {
    expect(() => parseNativeDeepReadVideoFps(fps)).toThrow("fps");
  });

  it("分片秒数默认兼容旧任务，允许超过 300 秒且不截断输入", () => {
    expect(parseNativeDeepReadSegmentSeconds(undefined)).toBe(300);
    for (const seconds of [1, 180, 300, 317, 319, 600, 7200]) {
      expect(parseNativeDeepReadSegmentSeconds(seconds)).toBe(seconds);
      expect(parseNativeDeepReadSegmentSeconds(String(seconds))).toBe(seconds);
    }
    expect(hasNativeDeepReadJobFields({ nativeSegmentSeconds: 319 })).toBe(true);
    const confirmation = parseNativeDeepReadJobConfirmation({
      url: "https://www.douyin.com/video/12345",
      batchSize: 1,
      nativeDeepReadConfirmed: true,
      nativeMaxCalls: 200,
      nativePlanLimit: 1,
      nativeSegmentSeconds: 319,
    });
    expect(confirmation.segmentSeconds).toBe(319);
  });

  it.each([null, "", " ", true, false, [], {}, 0, -1, 1.5, "317.2", NaN, Infinity, 14401])(
    "非法分片输入 %j 在入队和 worker 共用的解析器中拒绝",
    (value) => {
      expect(() => parseNativeDeepReadSegmentSeconds(value)).toThrow("整数秒");
      expect(() => parseNativeDeepReadJobConfirmation({
        url: "https://www.douyin.com/video/12345",
        batchSize: 1,
        nativeDeepReadConfirmed: true,
        nativeMaxCalls: 200,
        nativePlanLimit: 1,
        nativeSegmentSeconds: value,
      })).toThrow("整数秒");
    },
  );


  it("按确认的模型请求数扩展，且不会超过 24 小时", () => {
    expect(resolveNativeDeepReadJobTimeoutMs(2)).toBe(80 * 60_000);
    expect(resolveNativeDeepReadJobTimeoutMs(NATIVE_DEEP_READ_JOB_MAX_CALLS))
      .toBeLessThanOrEqual(NATIVE_DEEP_READ_JOB_MAX_WALL_MS);
  });

  it("非法或过大的调用数关闭式拒绝", () => {
    const validRange = `1–${NATIVE_DEEP_READ_JOB_MAX_CALLS}`;
    expect(() => resolveNativeDeepReadJobTimeoutMs(0)).toThrow(validRange);
    expect(() => resolveNativeDeepReadJobTimeoutMs(NATIVE_DEEP_READ_JOB_MAX_CALLS + 1))
      .toThrow(validRange);
  });

  it("API 与 worker 共用同一份确认契约", () => {
    const params = {
      url: "https://www.douyin.com/video/12345",
      batchSize: 7,
      nativeDeepReadConfirmed: true,
      nativePlanHash: "0123456789abcdef",
      nativeMaxCalls: 9,
      nativePlanLimit: 7,
      nativePlanSeriesKey: "series_native_1",
      learnLlm: "deepseek",
    };
    expect(hasNativeDeepReadJobFields(params)).toBe(true);
    expect(parseNativeDeepReadJobConfirmation(params)).toMatchObject({
      url: params.url,
      maxCalls: 9,
      planLimit: 7,
      seriesKey: "series_native_1",
      learnLlm: "deepseek",
    });
  });

  it("面板可直接入队，worker 在同一真实任务内生成执行计划", () => {
    const params = {
      url: "https://www.douyin.com/video/12345",
      batchSize: 10,
      nativeDeepReadConfirmed: true,
      nativeMaxCalls: NATIVE_DEEP_READ_JOB_MAX_CALLS,
      nativePlanLimit: 10,
    };
    expect(parseNativeDeepReadJobConfirmation(params)).toEqual({
      standaloneSource: false,
      url: params.url,
      planHash: undefined,
      maxCalls: NATIVE_DEEP_READ_JOB_MAX_CALLS,
      planLimit: 10,
      segmentSeconds: 300,
      videoFps: 12,
      readModel: "gemini-3.1-pro-preview",
      structuringModel: "glm-5.3",
      structuringGateway: "openrouter",
      seriesKey: undefined,
      learnLlm: "gpt",
    });
  });

  it("同源 active job 只有整份确认参数一致才可复用", () => {
    const params = {
      url: "https://www.douyin.com/video/12345",
      batchSize: 1,
      nativeDeepReadConfirmed: true,
      nativeMaxCalls: 200,
      nativePlanLimit: 1,
      nativeSegmentSeconds: 281,
      nativeVideoFps: 10,
    };
    const current = parseNativeDeepReadJobConfirmation(params);
    expect(sameNativeDeepReadJobConfirmation(current, { ...current })).toBe(true);
    expect(sameNativeDeepReadJobConfirmation(current, {
      ...current,
      segmentSeconds: 300,
    })).toBe(false);
    expect(sameNativeDeepReadJobConfirmation(current, {
      ...current,
      videoFps: 12,
    })).toBe(false);
  });

  it("显式可信第三方播放页可进同一确认契约，仿冒域仍拒绝", () => {
    const params = {
      url: "https://0996zp.com/vod/play/146259/sid/1311527",
      batchSize: 2,
      nativeDeepReadConfirmed: true,
      nativeMaxCalls: NATIVE_DEEP_READ_JOB_MAX_CALLS,
      nativePlanLimit: 2,
    };
    expect(parseNativeDeepReadJobConfirmation(params).url).toBe(params.url);
    expect(() => parseNativeDeepReadJobConfirmation({
      ...params,
      url: "https://0996zp.com.evil.test/vod/play/146259/sid/1311527",
    })).toThrow("相互冲突");
    const extraHostParams = {
      ...params,
      url: "https://mirror.example.com/vod/play/146259/1/1311527",
    };
    expect(() => parseNativeDeepReadJobConfirmation(extraHostParams)).toThrow("相互冲突");
    expect(parseNativeDeepReadJobConfirmation(extraHostParams, {
      extraSourceHosts: ["mirror.example.com"],
    }).url).toBe(extraHostParams.url);
  });

  it("拒绝本机/GCS 旁路、批次数漂移与只带半套字段", () => {
    const base = {
      url: "https://www.douyin.com/video/12345",
      batchSize: 7,
      nativeDeepReadConfirmed: true,
      nativePlanHash: "0123456789abcdef",
      nativeMaxCalls: 9,
      nativePlanLimit: 7,
      nativePlanSeriesKey: "series_native_1",
    };
    expect(() => parseNativeDeepReadJobConfirmation({ ...base, batchSize: 8 }))
      .toThrow("相互冲突");
    expect(() => parseNativeDeepReadJobConfirmation({ ...base, gcsUri: "gs://bucket/a.mp4" }))
      .toThrow("相互冲突");
    expect(() => parseNativeDeepReadJobConfirmation({
      ...base,
      url: "http://127.0.0.1:3000/probe",
    })).toThrow();
    expect(hasNativeDeepReadJobFields({ nativePlanHash: base.nativePlanHash })).toBe(true);
    expect(() => parseNativeDeepReadJobConfirmation({ nativePlanHash: base.nativePlanHash }))
      .toThrow();
  });
});

describe("nativeStandaloneSource（0901 整支即全集）", () => {
  const base = {
    url: "https://www.douyin.com/video/7676084324495543592",
    nativeDeepReadConfirmed: true,
    nativeMaxCalls: 60, nativePlanLimit: 1, nativeSegmentSeconds: 313, nativeVideoFps: 12,
    batchSize: 1,
  };
  it("布尔与字符串 true 都认；缺省为 false", () => {
    expect(parseNativeDeepReadJobConfirmation({ ...base }).standaloneSource).toBe(false);
    expect(parseNativeDeepReadJobConfirmation({ ...base, nativeStandaloneSource: true }).standaloneSource).toBe(true);
    expect(parseNativeDeepReadJobConfirmation({ ...base, nativeStandaloneSource: "true" }).standaloneSource).toBe(true);
    expect(parseNativeDeepReadJobConfirmation({ ...base, nativeStandaloneSource: false }).standaloneSource).toBe(false);
  });
  it("非布尔值关闭式拒绝；开关不同则确认契约不相同", () => {
    expect(() => parseNativeDeepReadJobConfirmation({ ...base, nativeStandaloneSource: 1 }))
      .toThrow("布尔");
    const on = parseNativeDeepReadJobConfirmation({ ...base, nativeStandaloneSource: true });
    const off = parseNativeDeepReadJobConfirmation({ ...base });
    expect(sameNativeDeepReadJobConfirmation(on, off)).toBe(false);
    expect(sameNativeDeepReadJobConfirmation(on, { ...on })).toBe(true);
  });
});

describe("nativeDeepReadSeriesKeyForModel", () => {
  it("默认/未传模型不加后缀", () => {
    expect(nativeDeepReadSeriesKeyForModel("abc123")).toBe("abc123");
    expect(nativeDeepReadSeriesKeyForModel("abc123", "gemini-3.1-pro-preview")).toBe("abc123");
  });
  it("flash 加 -g38f 且总长不超 40", () => {
    expect(nativeDeepReadSeriesKeyForModel("abc123", "gemini-3.8-flash")).toBe("abc123-g38f");
    const long = "x".repeat(40);
    const out = nativeDeepReadSeriesKeyForModel(long, "gemini-3.8-flash");
    expect(out.endsWith("-g38f")).toBe(true);
    expect(out.length).toBe(40);
  });
  it("已带后缀幂等，不得二次拼接", () => {
    expect(nativeDeepReadSeriesKeyForModel("abc123-g38f", "gemini-3.8-flash")).toBe("abc123-g38f");
  });
});


describe("单集重学确认", () => {
  const params = { url: "https://www.douyin.com/video/12345", batchSize: 1,
    nativeDeepReadConfirmed: true, nativeMaxCalls: 200, nativePlanLimit: 1 };
  const nativeRelearn = { seriesKey: "series_real", episodeIndex: 16, requestId: "11111111-1111-4111-8111-111111111111" };
  it("新旧提交不能互相接管；同次重学恢复保留身份", () => {
    const old = parseNativeDeepReadJobConfirmation(params);
    const current = parseNativeDeepReadJobConfirmation({ ...params, nativeRelearn });
    expect(hasNativeDeepReadJobFields({ nativeRelearn })).toBe(true);
    expect(sameNativeDeepReadJobConfirmation(old, current)).toBe(false);
    expect(sameNativeDeepReadJobConfirmation(current, parseNativeDeepReadJobConfirmation({ ...params, nativeRelearn }))).toBe(true);
    expect(sameNativeDeepReadJobConfirmation(current, { ...current, relearn: { ...nativeRelearn, episodeIndex: 17 } })).toBe(false);
    expect(sameNativeDeepReadJobConfirmation(current, { ...current, relearn: { ...nativeRelearn, requestId: "22222222-2222-4222-8222-222222222222" } })).toBe(false);
  });
  it.each([null, true, {}, { ...nativeRelearn, requestId: "../old" }, { ...nativeRelearn, episodeIndex: "16" }])("拒绝无效重学身份 %j", value => {
    expect(() => parseNativeDeepReadJobConfirmation({ ...params, nativeRelearn: value })).toThrow("重学");
  });
  it("重学不能扩成批量", () => {
    expect(() => parseNativeDeepReadJobConfirmation({ ...params, batchSize: 2, nativePlanLimit: 2, nativeRelearn })).toThrow("单集");
  });
});


describe("新读片唯一Flash入口", () => {
  const params = { url: "https://www.douyin.com/video/12345", batchSize: 1,
    nativeDeepReadConfirmed: true, nativeMaxCalls: 200, nativePlanLimit: 1 };
  it("未选模型的新任务明确使用Flash且保持旧任务身份", () => {
    const current = parseNewNativeDeepReadJobConfirmation(params);
    expect(current.readModel).toBe("gemini-3.8-flash");
    expect(nativeDeepReadSeriesKeyForModel("abc123", current.readModel)).toBe("abc123-g38f");
    expect(parseNativeDeepReadJobConfirmation(params).readModel).toBe("gemini-3.1-pro-preview");
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-3.8-flash" })).toEqual(current);
  });
  it("新请求拒绝旧Pro，而历史Pro只整形仍保留证据身份", () => {
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-3.1-pro-preview" })).toThrow("未在服务端配置中启用");
    const old = { ...params, nativeStructuringModel: "glm-5.3", nativeReadModel: "gemini-3.1-pro-preview",
      nativeStructuringOnly: true, nativeStructuringEpisodeIndex: 1, nativeStructuringPreviousJobId: "old-job-12345" };
    expect(parseNewNativeDeepReadJobConfirmation(old)).toEqual(parseNativeDeepReadJobConfirmation(old));
  });
});


it("指定整形路由冻结进契约，另一页不同路由不得复用同任务", () => {
  const params = { url: "https://www.douyin.com/video/12345", batchSize: 1, nativeDeepReadConfirmed: true,
    nativeMaxCalls: 10, nativePlanLimit: 1, nativeStructuringGateway: "evolink_glm" };
  const selected = parseNativeDeepReadJobConfirmation(params);
  expect(selected.structuringGateway).toBe("evolink_glm");
  expect(sameNativeDeepReadJobConfirmation(selected, { ...selected, structuringGateway: "openrouter" })).toBe(false);
  expect(() => parseNativeDeepReadJobConfirmation({ ...params, nativeStructuringGateway: "qwen" })).toThrow("整形路由");
});


describe("Argon新读片合同与独立系列", () => {
  const params = { url: "https://www.douyin.com/video/12345", batchSize: 1,
    nativeDeepReadConfirmed: true, nativeMaxCalls: 200, nativePlanLimit: 1 };
  it("1110：Argon 按配置决定——未配置时新读片拒收；配置成读片模型后进入真实确认合同，与 Flash 合同不同", () => {
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-4-argon" }, { env: {} }))
      .toThrow("未在服务端配置中启用");
    const env = { MANHUA_DEEP_READ_MODEL: "gemini-4-argon" };
    const argon = parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-4-argon" }, { env });
    expect(argon.readModel).toBe("gemini-4-argon");
    expect(parseNewNativeDeepReadJobConfirmation(params, { env }).readModel).toBe("gemini-4-argon");
    expect(sameNativeDeepReadJobConfirmation(argon, parseNewNativeDeepReadJobConfirmation(params, { env: {} }))).toBe(false);
  });
  it("系列身份不混用历史Pro与Flash缓存，重复解析不加第二个后缀", () => {
    const key = nativeDeepReadSeriesKeyForModel("a".repeat(40), "gemini-4-argon");
    expect(key).toHaveLength(40);
    expect(key.endsWith("-g4a")).toBe(true);
    expect(nativeDeepReadSeriesKeyForModel(key, "gemini-4-argon")).toBe(key);
    expect(nativeDeepReadModelForSeriesKey(key)).toBe("gemini-4-argon");
    expect(nativeDeepReadModelForSeriesKey("abc-g38f")).toBe("gemini-3.8-flash");
    expect(nativeDeepReadModelForSeriesKey("abc")).toBe("gemini-3.1-pro-preview");
  });
});


describe("1110 模板学习读片模型 env 可配（不写死）", () => {
  const params = { url: "https://www.douyin.com/video/12345", batchSize: 1,
    nativeDeepReadConfirmed: true, nativeMaxCalls: 200, nativePlanLimit: 1 };
  it("缺省解析为 gemini-3.8-flash；MANHUA_DEEP_READ_MODEL / GEMINI_DEFAULT_MODEL 覆盖生效，空白回落", () => {
    expect(resolveManhuaNativeDeepReadModel({})).toBe("gemini-3.8-flash");
    expect(parseNewNativeDeepReadJobConfirmation(params, { env: {} }).readModel).toBe("gemini-3.8-flash");
    expect(resolveManhuaNativeDeepReadModel({ GEMINI_DEFAULT_MODEL: "gemini-3.9-flash" })).toBe("gemini-3.9-flash");
    expect(resolveManhuaNativeDeepReadModel({ GEMINI_DEFAULT_MODEL: "gemini-3.9-flash", MANHUA_DEEP_READ_MODEL: " gemini-4.0-flash " })).toBe("gemini-4.0-flash");
    expect(resolveManhuaNativeDeepReadModel({ GEMINI_DEFAULT_MODEL: "gemini-3.9-flash", MANHUA_DEEP_READ_MODEL: "   " })).toBe("gemini-3.9-flash");
    const env = { MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash" };
    const confirmed = parseNewNativeDeepReadJobConfirmation(params, { env });
    expect(confirmed.readModel).toBe("gemini-3.9-flash");
    // 已入队任务按保存的模型恢复（worker 侧不看当前配置）
    expect(parseNativeDeepReadJobConfirmation({ ...params, nativeReadModel: confirmed.readModel }).readModel).toBe("gemini-3.9-flash");
    // 3.8 Flash 旧车道仍可续学；Pro / Argon 未配置即拒收
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-3.8-flash" }, { env }).readModel).toBe("gemini-3.8-flash");
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-3.1-pro-preview" }, { env })).toThrow("未在服务端配置中启用");
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-4-argon" }, { env })).toThrow("未在服务端配置中启用");
    // 1111：加整集精读升级档（缺省 Carbon，站长主动选择才发）
    expect(nativeDeepReadAllowedNewReadModels(env)).toEqual(["gemini-3.9-flash", "gemini-3.8-flash", "gemini-4-hydrogen", "gemini-4-carbon"]);
    expect(nativeDeepReadAllowedNewReadModels({})).toEqual(["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-4-carbon"]);
  });
  it("升级模型按配置：缺省同首读模型（不升级）；可单独覆盖", () => {
    expect(resolveManhuaNativeDeepReadEscalationModel({})).toBe("gemini-3.8-flash");
    expect(resolveManhuaNativeDeepReadEscalationModel({ MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash" })).toBe("gemini-3.9-flash");
    expect(resolveManhuaNativeDeepReadEscalationModel({ MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash", MANHUA_DEEP_READ_ESCALATION_MODEL: "gemini-3.1-pro-preview" })).toBe("gemini-3.1-pro-preview");
  });
  it("配置模型车道：系列键可逆、不与旧车道混用；旧三条车道身份不变", () => {
    const key = nativeDeepReadSeriesKeyForModel("abc123def456", "gemini-3.9-flash");
    expect(key).toBe("abc123def456-gm-3_9-flash");
    expect(key).toMatch(/^[0-9A-Za-z_-]{1,40}$/);
    expect(nativeDeepReadSeriesKeyForModel(key, "gemini-3.9-flash")).toBe(key);
    expect(nativeDeepReadModelForSeriesKey(key)).toBe("gemini-3.9-flash");
    const long = nativeDeepReadSeriesKeyForModel("a".repeat(40), "gemini-2.5-flash-preview-09-2025");
    expect(long).toHaveLength(40);
    expect(nativeDeepReadModelForSeriesKey(long)).toBe("gemini-2.5-flash-preview-09-2025");
    expect(nativeDeepReadSeriesKeyForModel("abc", "gemini-3.8-flash")).toBe("abc-g38f");
    expect(nativeDeepReadSeriesKeyForModel("abc", "gemini-4-argon")).toBe("abc-g4a");
    expect(nativeDeepReadSeriesKeyForModel("abc", "gemini-3.1-pro-preview")).toBe("abc");
    expect(nativeDeepReadModelForSeriesKey("abc-g38f")).toBe("gemini-3.8-flash");
    expect(nativeDeepReadModelForSeriesKey("abc")).toBe("gemini-3.1-pro-preview");
  });
  it("段缓存身份：3.1 Pro / 3.8 Flash 保持历史缺省身份（不写模型），Argon 与配置新模型写入模型", () => {
    expect(nativeDeepReadSegmentCacheIdentityModel("gemini-3.1-pro-preview")).toBeUndefined();
    expect(nativeDeepReadSegmentCacheIdentityModel("gemini-3.8-flash")).toBeUndefined();
    expect(nativeDeepReadSegmentCacheIdentityModel("gemini-4-argon")).toBe("gemini-4-argon");
    expect(nativeDeepReadSegmentCacheIdentityModel("gemini-3.9-flash")).toBe("gemini-3.9-flash");
  });
  it("当前合同（双通道 / EvoLink 不记降级）与配置的缺省模型比较，3.8 Flash 旧车道照旧", () => {
    expect(isNativeDeepReadCurrentContractModel("gemini-3.8-flash", {})).toBe(true);
    expect(isNativeDeepReadCurrentContractModel("gemini-3.9-flash", {})).toBe(false);
    expect(isNativeDeepReadCurrentContractModel("gemini-3.9-flash", { MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash" })).toBe(true);
    expect(isNativeDeepReadCurrentContractModel("gemini-3.8-flash", { MANHUA_DEEP_READ_MODEL: "gemini-3.9-flash" })).toBe(true);
    expect(isNativeDeepReadCurrentContractModel("gemini-3.1-pro-preview", {})).toBe(false);
    expect(isNativeDeepReadCurrentContractModel("gemini-4-argon", {})).toBe(false);
  });
  it("worker 恢复：旧三代与合法 Gemini 标识照认，非法标识拒收（拒因不含模型名）", () => {
    expect(parseNativeDeepReadModel(undefined)).toBe("gemini-3.1-pro-preview");
    expect(parseNativeDeepReadModel("gemini-4-argon")).toBe("gemini-4-argon");
    expect(parseNativeDeepReadModel("gemini-3.9-flash")).toBe("gemini-3.9-flash");
    expect(() => parseNativeDeepReadModel("glm-5.3")).toThrow("读片模型标识无效");
    expect(() => parseNativeDeepReadModel("gemini-x/../y")).toThrow("读片模型标识无效");
  });
});


describe("1111 整集精读升级档：Argon 改 Carbon（新车道 -g4c，旧 -g4a 不变）", () => {
  const params = { url: "https://www.douyin.com/video/12345", batchSize: 1,
    nativeDeepReadConfirmed: true, nativeMaxCalls: 200, nativePlanLimit: 1 };
  it("新学习可选项：标准档 3.8 Flash / Hydrogen（1113 选单）+ 升级档 Carbon，Argon 已退出", () => {
    expect([...MANHUA_NATIVE_NEW_READ_MODEL_OPTIONS]).toEqual(["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-4-carbon"]);
    // Hydrogen 可显式选用，且与 3.8 Flash 一样走双通道并发合同。
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-4-hydrogen" }, { env: {} }).readModel).toBe("gemini-4-hydrogen");
    expect(isNativeDeepReadCurrentContractModel("gemini-4-hydrogen", {})).toBe(true);
    expect(isNativeDeepReadCurrentContractModel("gemini-3.8-flash", {})).toBe(true);
    expect(isNativeDeepReadCurrentContractModel("gemini-4-carbon", {})).toBe(false);
    expect(MANHUA_NATIVE_NEW_READ_MODEL_OPTIONS as readonly string[]).not.toContain("gemini-4-argon");
    expect(MANHUA_NATIVE_CARBON_MODEL).toBe("gemini-4-carbon");
  });
  it("档位：缺省 standard 不变；upgrade 由服务端解析升级模型（env 可改），显式模型与档位冲突拒收", () => {
    expect(parseNewNativeDeepReadJobConfirmation(params, { env: {} }).readModel).toBe("gemini-3.8-flash");
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadTier: "standard" }, { env: {} }).readModel).toBe("gemini-3.8-flash");
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadTier: "upgrade" }, { env: {} }).readModel).toBe("gemini-4-carbon");
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-4-carbon" }, { env: {} }).readModel).toBe("gemini-4-carbon");
    const env = { MANHUA_DEEP_READ_UPGRADE_MODEL: "gemini-4-carbon-0115" };
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadTier: "upgrade" }, { env }).readModel).toBe("gemini-4-carbon-0115");
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadTier: "upgrade", nativeReadModel: "gemini-3.8-flash" }, { env: {} }))
      .toThrow(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadTier: "max" }, { env: {} })).toThrow("精读档位无效");
    expect(parseNativeDeepReadReadTier(undefined)).toBe("standard");
    // Argon 不再可新发（未配置为首读模型时）
    expect(() => parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadModel: "gemini-4-argon" }, { env: {} })).toThrow("未在服务端配置中启用");
  });
  it("续学：已入库 -g4a 系列照旧按 Argon；-g4c 系列按 Carbon；档位不改系列车道", () => {
    expect(parseNewNativeDeepReadJobConfirmation({ ...params, nativeReadTier: "upgrade" }, { env: {}, storedSeriesKey: "abc-g4a" }).readModel).toBe("gemini-4-argon");
    expect(parseNewNativeDeepReadJobConfirmation(params, { env: {}, storedSeriesKey: "abc-g4c" }).readModel).toBe("gemini-4-carbon");
    expect(parseNewNativeDeepReadJobConfirmation(params, { env: {}, storedSeriesKey: "abc-g38f" }).readModel).toBe("gemini-3.8-flash");
  });
  it("车道后缀：Carbon 新增 -g4c（可逆、截长不重复）；旧 -g4a / -g38f / 无后缀身份不变", () => {
    expect(nativeDeepReadSeriesKeyForModel("abc", "gemini-4-carbon")).toBe("abc-g4c");
    const key = nativeDeepReadSeriesKeyForModel("a".repeat(40), "gemini-4-carbon");
    expect(key).toHaveLength(40);
    expect(key.endsWith("-g4c")).toBe(true);
    expect(nativeDeepReadSeriesKeyForModel(key, "gemini-4-carbon")).toBe(key);
    expect(nativeDeepReadModelForSeriesKey(key)).toBe("gemini-4-carbon");
    expect(nativeDeepReadSeriesKeyForModel("abc", "gemini-4-argon")).toBe("abc-g4a");
    expect(nativeDeepReadModelForSeriesKey("abc-g4a")).toBe("gemini-4-argon");
    expect(nativeDeepReadModelForSeriesKey("abc-g38f")).toBe("gemini-3.8-flash");
    expect(nativeDeepReadModelForSeriesKey("abc")).toBe("gemini-3.1-pro-preview");
    // 升级模型换成别的标识时走配置车道 -gm-，不与 -g4c 混卡
    expect(nativeDeepReadSeriesKeyForModel("abc", "gemini-4-carbon-0115")).toBe("abc-gm-4-carbon-0115");
  });
  it("段缓存身份写入 Carbon 模型（不吃其他车道缓存，旧车道身份不变）；车道判定与读片通道顺序", () => {
    expect(nativeDeepReadSegmentCacheIdentityModel("gemini-4-carbon")).toBe("gemini-4-carbon");
    expect(nativeDeepReadSegmentCacheIdentityModel("gemini-3.8-flash")).toBeUndefined();
    expect(isNativeDeepReadCarbonLaneModel("gemini-4-carbon", {})).toBe(true);
    expect(isNativeDeepReadCarbonLaneModel("gemini-4-carbon-0115", { MANHUA_DEEP_READ_UPGRADE_MODEL: "gemini-4-carbon-0115" })).toBe(true);
    expect(isNativeDeepReadCarbonLaneModel("gemini-3.8-flash", { MANHUA_DEEP_READ_UPGRADE_MODEL: "gemini-3.8-flash" })).toBe(false);
    expect(isNativeDeepReadCarbonLaneModel("gemini-4-argon", {})).toBe(false);
    expect(isNativeDeepReadCurrentContractModel("gemini-4-carbon", {})).toBe(false);
    expect(nativeDeepReadCarbonRoutes({})).toEqual(["evolink", "vertex"]);
    expect(nativeDeepReadCarbonRoutes({ MANHUA_DEEP_READ_CARBON_ROUTES: "vertex,evolink" })).toEqual(["vertex", "evolink"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // 精读不走 Gemini API（读视频需 Files API，不做）
    expect(nativeDeepReadCarbonRoutes({ MANHUA_DEEP_READ_CARBON_ROUTES: "gemini_api" })).toEqual(["evolink", "vertex"]);
    warn.mockRestore();
  });
  it("升级重读缺省不改：未设 MANHUA_DEEP_READ_ESCALATION_MODEL 时同首读模型（不自动走贵档）", () => {
    expect(resolveManhuaNativeDeepReadEscalationModel({})).toBe("gemini-3.8-flash");
    expect(resolveManhuaNativeDeepReadEscalationModel({ GEMINI_CARBON_MODEL: "gemini-4-carbon" })).toBe("gemini-3.8-flash");
    expect(resolveManhuaNativeDeepReadEscalationModel({ MANHUA_DEEP_READ_ESCALATION_MODEL: "gemini-4-carbon" })).toBe("gemini-4-carbon");
  });
});
