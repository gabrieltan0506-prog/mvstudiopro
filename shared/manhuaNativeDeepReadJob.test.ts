import { describe, expect, it } from "vitest";
import {
  hasNativeDeepReadJobFields,
  NATIVE_DEEP_READ_JOB_MAX_CALLS,
  NATIVE_DEEP_READ_JOB_MAX_WALL_MS,
  parseNativeDeepReadSegmentSeconds,
  parseNativeDeepReadVideoFps,
  parseNativeDeepReadJobConfirmation,
  resolveNativeDeepReadJobTimeoutMs,
  sameNativeDeepReadJobConfirmation,
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

  it.each(["", " ", true, false, [], {}, 0, -1, 1.5, "317.2", NaN, Infinity, 14401])(
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

  it("缺省/null 分片秒数＝按集自动配平（0902），确认契约保留 undefined 不折成 300", () => {
    for (const value of [undefined, null]) {
      const confirmation = parseNativeDeepReadJobConfirmation({
        url: "https://www.douyin.com/video/12345",
        batchSize: 1,
        nativeDeepReadConfirmed: true,
        nativeMaxCalls: 200,
        nativePlanLimit: 1,
        ...(value === undefined ? {} : { nativeSegmentSeconds: value }),
      });
      expect(confirmation.segmentSeconds).toBeUndefined();
    }
  });

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
      // 0902：缺省分片＝自动配平，契约保留 undefined
      segmentSeconds: undefined,
      videoFps: 12,
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
