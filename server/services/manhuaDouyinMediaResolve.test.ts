/**
 * PR1325 第一节：抖音进程内解析回归。fixture HTML（伪 RENDER_DATA/_ROUTER_DATA）
 * + 注入 fetchImpl 验证：cookie 只进请求头、解析取 play_addr https url_list 首个、
 * playApi 兜底、fetch 失败/解析失败抛错的 message 与整链序列化后
 * 零泄漏（用 test-cookie-DO-NOT-LEAK 制造泄漏源）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractDouyinVideoId,
  resolveDouyinMediaUrl,
  type DouyinFetchImpl,
} from "./manhuaDouyinMediaResolve";
import { describeErrorChain } from "./manhuaMediaSanitize";

const LEAK = "test-cookie-DO-NOT-LEAK";
const PAGE_URL = "https://www.douyin.com/video/7412345678901234567";

function renderDataHtml(payload: unknown): string {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `<!DOCTYPE html><html><head></head><body>
    <script id="RENDER_DATA" type="application/json">${encoded}</script>
  </body></html>`;
}

const fetchReturning = (html: string, capture?: { url?: string; headers?: Record<string, string> }): DouyinFetchImpl =>
  async (url, init) => {
    if (capture) {
      capture.url = url;
      capture.headers = init.headers;
    }
    return { ok: true, status: 200, text: async () => html };
  };

describe("resolveDouyinMediaUrl", () => {
  const originalEnvCookie = process.env.DOUYIN_COOKIE;
  beforeEach(() => {
    process.env.DOUYIN_COOKIE = LEAK;
  });
  afterEach(() => {
    if (originalEnvCookie === undefined) delete process.env.DOUYIN_COOKIE;
    else process.env.DOUYIN_COOKIE = originalEnvCookie;
  });

  it("extractDouyinVideoId 兼容 /video/<id> 与 modal_id", () => {
    expect(extractDouyinVideoId(PAGE_URL)).toBe("7412345678901234567");
    expect(extractDouyinVideoId("https://www.douyin.com/?modal_id=7412345678901234567")).toBe("7412345678901234567");
    expect(extractDouyinVideoId("https://example.com/none")).toBe("");
  });

  it("cookie 只进本次 fetch 请求头，且请求规范化到 /video/<id>", async () => {
    const capture: { url?: string; headers?: Record<string, string> } = {};
    const html = renderDataHtml({
      app: { videoDetail: { video: { duration: 366000, play_addr: { url_list: ["http://v3-web.douyinvod.com/a.mp4?auth_key=k1"] } } } },
    });
    const resolved = await resolveDouyinMediaUrl(
      "https://www.douyin.com/discover?modal_id=7412345678901234567",
      { fetchImpl: fetchReturning(html, capture) },
    );
    expect(capture.url).toBe(PAGE_URL);
    expect(capture.headers?.Cookie).toBe(LEAK);
    expect(capture.headers?.["User-Agent"]).toContain("Mozilla/5.0");
    expect(resolved.mediaUrl).toBe("https://v3-web.douyinvod.com/a.mp4?auth_key=k1");
    expect(resolved.durationSec).toBeCloseTo(366);
    expect(resolved.videoId).toBe("7412345678901234567");
  });

  it("play_addr url_list 取首个可用 https（http 升级为 https）", async () => {
    const html = renderDataHtml({
      video: { play_addr: { url_list: ["", "http://first.douyinvod.com/v.mp4", "https://second.douyinvod.com/v.mp4"] } },
    });
    const resolved = await resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) });
    expect(resolved.mediaUrl).toBe("https://first.douyinvod.com/v.mp4");
  });

  it("_ROUTER_DATA 内嵌块与 playApi 协议相对地址兜底", async () => {
    const html = `<html><body><script>window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { video_id: { videoInfoRes: { item_list: [{ video: { playApi: "//www.douyin.com/aweme/v1/play/?video_id=v0300" } }] } } },
    })};</script></body></html>`;
    const resolved = await resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) });
    expect(resolved.mediaUrl).toBe("https://www.douyin.com/aweme/v1/play/?video_id=v0300");
  });

  it("页面内嵌多个视频时只返回目标 videoId 的媒体（推荐位排在前面也不误取）", async () => {
    const html = renderDataHtml({
      app: {
        // 推荐位在前：旧实现深搜「第一个 play_addr」会把别人的片子当成本集
        recommend: [
          { aweme_id: "7000000000000000001", video: { play_addr: { url_list: ["https://other.douyinvod.com/other.mp4"] } } },
        ],
        videoDetail: {
          aweme_id: "7412345678901234567",
          video: { duration: 120000, play_addr: { url_list: ["https://v3-web.douyinvod.com/target.mp4"] } },
        },
      },
    });
    const resolved = await resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) });
    expect(resolved.mediaUrl).toBe("https://v3-web.douyinvod.com/target.mp4");
    expect(resolved.durationSec).toBeCloseTo(120);
  });

  it("唯一候选明确属于其他 videoId → 拒绝采纳，抛未解析到媒体地址", async () => {
    const html = renderDataHtml({
      app: {
        videoDetail: {
          aweme_id: "7000000000000000001",
          video: { play_addr: { url_list: ["https://v3-web.douyinvod.com/other.mp4"] } },
        },
      },
    });
    await expect(resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) }))
      .rejects.toThrow("未解析到媒体地址");
  });

  it("身份字段从父节点继承：子树里的 play_addr 也归属父节点的 videoId", async () => {
    const html = renderDataHtml({
      app: { list: [{ item_id: "7000000000000000002", detail: { inner: { video: { play_addr: { url_list: ["https://v3-web.douyinvod.com/nested-other.mp4"] } } } } }] },
    });
    await expect(resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) }))
      .rejects.toThrow("未解析到媒体地址");
  });

  it("白名单外 https 地址一律不采纳（不能把任意出网目标喂给下载器）", async () => {
    const html = renderDataHtml({
      video: { play_addr: { url_list: ["https://evil.example.com/payload.mp4"] } },
    });
    await expect(resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) }))
      .rejects.toThrow("未解析到媒体地址");
  });

  it("playApi 分支同样走白名单：非可信域被拒", async () => {
    const html = `<html><body><script>window._ROUTER_DATA = ${JSON.stringify({
      loaderData: { videoInfoRes: { item_list: [{ video: { playApi: "//evil.example.com/play?video_id=v0300" } }] } },
    })};</script></body></html>`;
    await expect(resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) }))
      .rejects.toThrow("未解析到媒体地址");
  });

  it("非法链接直接抛错，不发起请求", async () => {
    let called = false;
    const fetchImpl: DouyinFetchImpl = async () => {
      called = true;
      return { ok: true, status: 200, text: async () => "" };
    };
    await expect(resolveDouyinMediaUrl("https://example.com/no-id", { fetchImpl })).rejects.toThrow("抖音链接无效");
    expect(called).toBe(false);
  });

  it("fetch 抛错（错误里混入 cookie 与签名 URL）→ 抛错 message 与整链零泄漏", async () => {
    const fetchImpl: DouyinFetchImpl = async () => {
      throw new Error(`ECONNRESET while sending Cookie: ${LEAK} to https://www.douyin.com/video/x?sig=${LEAK}`);
    };
    let caught: unknown;
    try {
      await resolveDouyinMediaUrl(PAGE_URL, { fetchImpl });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("抖音视频页请求失败");
    expect(message).not.toContain(LEAK);
    expect(message).not.toContain("sig=");
    const serializedChain = JSON.stringify(describeErrorChain(caught));
    expect(serializedChain).not.toContain(LEAK);
    expect(serializedChain).not.toContain("sig=");
  });

  it("非 2xx 状态：抛错含 status 但不含 cookie", async () => {
    const fetchImpl: DouyinFetchImpl = async () => ({ ok: false, status: 403, text: async () => "" });
    await expect(resolveDouyinMediaUrl(PAGE_URL, { fetchImpl })).rejects.toThrow(/status=403/);
    try {
      await resolveDouyinMediaUrl(PAGE_URL, { fetchImpl });
    } catch (error) {
      expect(JSON.stringify(describeErrorChain(error))).not.toContain(LEAK);
    }
  });

  it("页面无 RENDER_DATA/_ROUTER_DATA → 解析失败抛脱敏错误，零 cookie 零查询串", async () => {
    const html = `<html><body>页面里只有一个诱导串 Cookie: ${LEAK} 与
      https://v3-web.douyinvod.com/x.mp4?auth_key=${LEAK}</body></html>`;
    let caught: unknown;
    try {
      await resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("未解析到媒体地址");
    expect(message).not.toContain(LEAK);
    expect(JSON.stringify(describeErrorChain(caught))).not.toContain(LEAK);
  });

  it("RENDER_DATA 坏 JSON 不崩溃，落到解析失败的脱敏错误", async () => {
    const html = `<html><body><script id="RENDER_DATA" type="application/json">%7Bbroken%%%</script></body></html>`;
    await expect(resolveDouyinMediaUrl(PAGE_URL, { fetchImpl: fetchReturning(html) }))
      .rejects.toThrow("未解析到媒体地址");
  });
});
