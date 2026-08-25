import { describe, expect, it } from "vitest";
import {
  hasNativeDeepReadJobFields,
  NATIVE_DEEP_READ_JOB_MAX_CALLS,
  NATIVE_DEEP_READ_JOB_MAX_WALL_MS,
  parseNativeDeepReadJobConfirmation,
  resolveNativeDeepReadJobTimeoutMs,
} from "./manhuaNativeDeepReadJob.js";

describe("原生精读任务墙钟", () => {
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
      url: params.url,
      planHash: undefined,
      maxCalls: NATIVE_DEEP_READ_JOB_MAX_CALLS,
      planLimit: 10,
      seriesKey: undefined,
      learnLlm: "gpt",
    });
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
