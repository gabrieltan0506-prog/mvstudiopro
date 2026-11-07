import { beforeEach, describe, expect, it } from "vitest";
import { StockFootageError, clearStockSearchCache, getPexelsApiKey, pickBestVideoFile, searchPexels, type PexelsVideoFile } from "./pexelsClient";

const files: PexelsVideoFile[] = [
  { id: 1, file_type: "video/mp4", width: 3840, height: 2160, link: "https://videos.pexels.com/4k.mp4" },
  { id: 2, file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.pexels.com/1080.mp4" },
  { id: 3, file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/360.mp4" },
  { id: 4, file_type: "application/x-mpegURL", width: 1920, height: 1080, link: "https://videos.pexels.com/x.m3u8" },
];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("pexelsClient", () => {
  beforeEach(() => clearStockSearchCache());

  it("没有密钥时明确报未启用，不发请求（反向）", () => {
    expect(() => getPexelsApiKey({} as NodeJS.ProcessEnv)).toThrow(StockFootageError);
  });

  it("入片文件选短边≤1080 的最大 mp4，跳过 hls", () => {
    expect(pickBestVideoFile(files)?.id).toBe(2);
    expect(pickBestVideoFile(files, "portrait")?.id).toBe(2); // 无竖屏文件时退回全部 mp4
    expect(pickBestVideoFile([files[0]])?.id).toBe(1); // 全部超限时取最小
    expect(pickBestVideoFile([files[3]])).toBeUndefined();
  });

  it("搜索：密钥只放 Authorization 头，结果按时长过滤并缓存", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(
        { page: 1, per_page: 2, total_results: 2, next_page: "x", videos: [
          { id: 10, width: 1920, height: 1080, url: "https://www.pexels.com/video/10/", image: "https://images.pexels.com/v10.jpg", duration: 12, user: { name: "A", url: "https://www.pexels.com/@a" }, video_files: files },
          { id: 11, width: 1920, height: 1080, url: "https://www.pexels.com/video/11/", image: "https://images.pexels.com/v11.jpg", duration: 3, video_files: files },
        ] },
        200,
        { "x-ratelimit-remaining": "199" }
      );
    };
    const params = { query: "rain", kind: "video" as const, page: 1, perPage: 2, purpose: "mv" as const, minDurationSec: 5 };
    const r1 = await searchPexels(params, { fetch: fake, apiKey: "test-key" });
    expect(calls[0].url).toContain("/videos/search?");
    expect(calls[0].url).not.toContain("test-key");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("test-key");
    expect(r1.candidates.map(c => c.providerAssetId)).toEqual(["10"]);
    expect(r1.candidates[0].previewVideoUrl).toBe("https://videos.pexels.com/360.mp4");
    expect(r1.rateLimitRemaining).toBe(199);
    expect(r1.hasMore).toBe(true);
    const r2 = await searchPexels(params, { fetch: fake, apiKey: "test-key" });
    expect(r2.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("429 / 401 映射为限流与密钥未激活", async () => {
    const p = { query: "x", kind: "photo" as const, page: 1, perPage: 1, purpose: "marketing" as const };
    await expect(searchPexels(p, { fetch: async () => jsonResponse({}, 429), apiKey: "k" })).rejects.toMatchObject({ kind: "rate_limited" });
    clearStockSearchCache();
    await expect(searchPexels(p, { fetch: async () => jsonResponse({}, 401), apiKey: "k" })).rejects.toMatchObject({ kind: "not_configured" });
  });
});
