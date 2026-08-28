import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicManhuaSourceHost,
  buildManhua0996EpisodeApiRequest,
  fetchManhua0996EpisodePlayback,
  MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV,
  MANHUA_MIRROR_SOURCE_COOKIE_ENV,
  readManhuaMirrorSourceAuthHeaders,
  readManhuaLearnExtraSourceHosts,
} from "./manhuaLearn0996Source.js";
import { parseManhua0996SourceUrl } from "../../shared/manhuaLearn0996Source.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "203.0.113.8", family: 4 }]),
}));

const sourceUrl = "https://0996zp.com/vod/play/146259/sid/1311527";
const playbackPayload = {
  code: 200,
  data: {
    list: [{
      flag: true,
      needLogin: false,
      resolution: 480,
      url: "https://ppvod01.kqgfbs.com/free/index.m3u8",
    }],
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("第三方播放页服务端安全边界", () => {
  it("公开前端签名与真实请求已验证向量一致", () => {
    const source = parseManhua0996SourceUrl(
      "https://0996zp.com/vod/play/146259/sid/1311527",
    )!;
    const request = buildManhua0996EpisodeApiRequest(
      source,
      1787864930727,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(request.headers.sign).toBe("70b0084b8f11a69d8c375c5d10e15eb5944bb940");
    expect(request.headers).not.toHaveProperty("authorization");
    expect(new URL(request.url).hostname).toBe("0996zp.com");
  });

  it("API Host 跟随已验证的源站，不硬切另一个镜像", () => {
    const source = parseManhua0996SourceUrl(
      "https://www.gzcrkt8888.com/vod/play/144970/1/1290958",
    )!;
    const request = buildManhua0996EpisodeApiRequest(source, 1787864930727);
    expect(new URL(request.url).hostname).toBe("www.gzcrkt8888.com");
    expect(request.headers.referer).toBe("https://www.gzcrkt8888.com/");
  });

  it("Fly 凭证只生成受信源站请求可用的兜底头，拒绝换行注入", () => {
    expect(readManhuaMirrorSourceAuthHeaders({
      cookie: "session=test-cookie",
      authorization: "Bearer test-token",
    })).toEqual({ cookie: "session=test-cookie", authorization: "Bearer test-token" });
    expect(readManhuaMirrorSourceAuthHeaders({
      cookie: "bad\r\nheader",
      authorization: "bad\nheader",
    })).toEqual({});
  });

  it("匿名媒体接口成功时只请求一次，绝不预先发送 Fly Cookie 或 Authorization", async () => {
    vi.stubEnv(MANHUA_MIRROR_SOURCE_COOKIE_ENV, "session=test-cookie");
    vi.stubEnv(MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV, "Bearer test-token");
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("cookie")).toBe(false);
      expect(headers.has("authorization")).toBe(false);
      return new Response(JSON.stringify(playbackPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(fetchManhua0996EpisodePlayback(sourceUrl, undefined, fetchImpl))
      .resolves.toMatchObject({ playbackUrl: playbackPayload.data.list[0].url });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("匿名媒体接口失败后才用 Fly-only 鉴权重试，且不产生第三次请求", async () => {
    vi.stubEnv(MANHUA_MIRROR_SOURCE_COOKIE_ENV, "session=test-cookie");
    vi.stubEnv(MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV, "Bearer test-token");
    const seenHeaders: Headers[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers));
      if (seenHeaders.length === 1) return new Response(null, { status: 503 });
      return new Response(JSON.stringify(playbackPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(fetchManhua0996EpisodePlayback(sourceUrl, undefined, fetchImpl))
      .resolves.toMatchObject({ playbackUrl: playbackPayload.data.list[0].url });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(seenHeaders[0]!.has("cookie")).toBe(false);
    expect(seenHeaders[0]!.has("authorization")).toBe(false);
    expect(seenHeaders[1]!.get("cookie")).toBe("session=test-cookie");
    expect(seenHeaders[1]!.get("authorization")).toBe("Bearer test-token");
  });

  it("额外站点只从 Fly 服务端逗号白名单读取，丢弃 IP 与坏 host", () => {
    expect(readManhuaLearnExtraSourceHosts(
      "mirror.example.com, 127.0.0.1,localhost,mirror.example.com,bad_host",
    )).toEqual(["mirror.example.com"]);
  });

  it("DNS 任一结果为私网即关闭式拒绝", async () => {
    await expect(assertPublicManhuaSourceHost("mirror.example.com", async () => [
      { address: "203.0.113.8", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ] as never)).rejects.toThrow("非公网地址");
    await expect(assertPublicManhuaSourceHost("mirror.example.com", async () => [
      { address: "::ffff:127.0.0.1", family: 6 },
    ] as never)).rejects.toThrow("非公网地址");
  });
});
