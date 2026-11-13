import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_MODEL_PRICES_PER_M,
  NATIVE_DEEP_READ_PRICE_USD_TO_CNY,
  nativeDeepReadModelPrices,
} from "./manhuaNativeDeepReadRunner";
import { resolveStoredManhuaNativeResumeSeriesKey } from "./manhuaTemplateLearnService";

describe("精读成本表汇率口径（1 USD = 7 CNY，kb/billing.md）", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it("汇率锁定为 7，不是 7.2", () => {
    expect(NATIVE_DEEP_READ_PRICE_USD_TO_CNY).toBe(7);
  });

  it("3.8 Flash 单价锁定：$0.30 / $2.50 每百万 token → ¥2.1 / ¥17.5", () => {
    expect(NATIVE_DEEP_READ_MODEL_PRICES_PER_M["gemini-3.8-flash"]).toEqual({ inPerM: 2.1, outPerM: 17.5 });
    expect(nativeDeepReadModelPrices("gemini-3.8-flash")).toEqual({ inPerM: 2.1, outPerM: 17.5, priceKnown: true });
    // 100 万输入 + 100 万输出 = ¥19.6
    const prices = nativeDeepReadModelPrices("gemini-3.8-flash");
    expect(prices.inPerM + prices.outPerM).toBeCloseTo(19.6, 10);
    expect(warn).not.toHaveBeenCalled();
  });

  it("表内其余模型同一汇率：3.1 Pro $1.25/$10、Argon $4/$20", () => {
    expect(NATIVE_DEEP_READ_MODEL_PRICES_PER_M["gemini-3.1-pro-preview"]).toEqual({ inPerM: 8.75, outPerM: 70 });
    expect(NATIVE_DEEP_READ_MODEL_PRICES_PER_M["gemini-4-argon"]).toEqual({ inPerM: 28, outPerM: 140 });
  });

  it("1111 Carbon 升级档：首发价 $2/$10 → ¥14 / ¥70（常量在 shared/geminiCarbon.ts，12-01 起翻倍改常量）", () => {
    expect(NATIVE_DEEP_READ_MODEL_PRICES_PER_M["gemini-4-carbon"]).toEqual({ inPerM: 14, outPerM: 70 });
    expect(nativeDeepReadModelPrices("gemini-4-carbon")).toEqual({ inPerM: 14, outPerM: 70, priceKnown: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("表内没有任何按 7.2 折算的残留单价", () => {
    const usd = { "gemini-3.1-pro-preview": [1.25, 10], "gemini-3.8-flash": [0.3, 2.5], "gemini-4-argon": [4, 20], "gemini-4-carbon": [2, 10], "gemini-4-hydrogen": [1.5, 7.5] } as const;
    expect(Object.keys(NATIVE_DEEP_READ_MODEL_PRICES_PER_M).sort()).toEqual(Object.keys(usd).sort());
    for (const [model, [inUsd, outUsd]] of Object.entries(usd)) {
      const row = NATIVE_DEEP_READ_MODEL_PRICES_PER_M[model]!;
      expect(row.inPerM / inUsd).toBeCloseTo(7, 10);
      expect(row.outPerM / outUsd).toBeCloseTo(7, 10);
    }
  });
});

describe("续学系列的服务端核实（已入库才作数）", () => {
  const read = (status: "found" | "not_found" | "error") =>
    vi.fn(async () => (status === "found" ? { status, value: {} } : { status })) as never;

  it("系列进度已落盘 → 返回系列键，并只读该系列的进度对象", async () => {
    const readProgress = read("found");
    await expect(resolveStoredManhuaNativeResumeSeriesKey({ nativeResumeSeriesKey: "abc-g4a" }, { readProgress })).resolves.toBe("abc-g4a");
    expect(readProgress).toHaveBeenCalledWith("manhua-template-learn/series/abc-g4a/progress.json");
  });
  it("未落盘 = 新系列 → undefined；没带系列键不读存储", async () => {
    await expect(resolveStoredManhuaNativeResumeSeriesKey({ nativeResumeSeriesKey: "abc-g4a" }, { readProgress: read("not_found") })).resolves.toBeUndefined();
    const readProgress = read("found");
    await expect(resolveStoredManhuaNativeResumeSeriesKey({}, { readProgress })).resolves.toBeUndefined();
    expect(readProgress).not.toHaveBeenCalled();
  });
  it("读取异常 fail-closed；非法系列键直接拒绝且不读存储", async () => {
    await expect(resolveStoredManhuaNativeResumeSeriesKey({ nativeResumeSeriesKey: "abc-g4a" }, { readProgress: read("error") })).rejects.toThrow("未建立学习任务");
    const readProgress = read("found");
    await expect(resolveStoredManhuaNativeResumeSeriesKey({ nativeResumeSeriesKey: "../etc" }, { readProgress })).rejects.toThrow("续学系列标识无效");
    expect(readProgress).not.toHaveBeenCalled();
  });
});
