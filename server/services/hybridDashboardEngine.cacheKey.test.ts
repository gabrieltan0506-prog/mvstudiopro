import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工作台新闻 / 路况：坐标量化到城市级后才做缓存键并送模型，调用方换坐标绕不过缓存；并发未命中只打一次上游。
 * 离线替身：模型客户端与 fetch 全替身，不发真实请求。
 */
const h = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: h.generate };
  },
}));
import {
  executeDashboardNews,
  newsBundleCacheKey,
  normalizeIanaTimeZone,
  quantizeAmbientNewsCoords,
} from "./hybridDashboardEngine";

const fetchMock = vi.fn();
beforeEach(() => {
  h.generate.mockReset().mockRejectedValue(new Error("offline"));
  fetchMock.mockReset().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("坐标量化", () => {
  it("0.5° 粒度：同城附近坐标同一键；无坐标统一键；越界钳位", () => {
    expect(quantizeAmbientNewsCoords(31.2304, 121.4737)).toEqual({ lat: 31, lon: 121.5 });
    expect(newsBundleCacheKey(31.2304, 121.4737)).toBe(newsBundleCacheKey(31.11, 121.61));
    expect(newsBundleCacheKey(31.2304, 121.4737)).not.toBe(newsBundleCacheKey(39.9, 116.4));
    expect(newsBundleCacheKey()).toBe(newsBundleCacheKey(Number.NaN, 1));
    expect(quantizeAmbientNewsCoords(90, 180)).toEqual({ lat: 90, lon: 180 });
  });

  it("时区只收合法 IANA", () => {
    expect(normalizeIanaTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(normalizeIanaTimeZone("Not/AZone-123")).toBeUndefined();
    expect(normalizeIanaTimeZone("x".repeat(80))).toBeUndefined();
  });
});

describe("executeDashboardNews 缓存", () => {
  it("换细小坐标命中同一缓存：第二次不再打上游；并发未命中只打一次", async () => {
    const upstreamCalls = () => h.generate.mock.calls.length + fetchMock.mock.calls.length;
    const [a, b] = await Promise.all([
      executeDashboardNews({ lat: 22.5431, lon: 114.0579 }),
      executeDashboardNews({ lat: 22.5432, lon: 114.0571 }),
    ]);
    expect(a).toEqual(b);
    const afterFirst = upstreamCalls();
    expect(afterFirst).toBeGreaterThan(0);
    await executeDashboardNews({ lat: 22.61, lon: 113.93 });
    await executeDashboardNews({ lat: 22.5, lon: 114.1 });
    expect(upstreamCalls()).toBe(afterFirst);
  });
});
