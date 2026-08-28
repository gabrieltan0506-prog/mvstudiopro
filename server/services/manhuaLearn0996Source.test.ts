import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicManhuaSourceHost,
  buildManhua0996EpisodeApiRequest,
  describeManhuaSourceFetchFailure,
  fetchManhua0996EpisodePlayback,
  MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV,
  MANHUA_MIRROR_SOURCE_COOKIE_ENV,
  readManhuaMirrorSourceAuthHeaders,
  readManhuaLearnExtraSourceHosts,
  sanitizeManhuaSourceErrorText,
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

  it("同源 307 逐跳跟随且不误触 Fly 鉴权兜底", async () => {
    vi.stubEnv(MANHUA_MIRROR_SOURCE_COOKIE_ENV, "session=test-cookie");
    vi.stubEnv(MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV, "Bearer test-token");
    const seenUrls: string[] = [];
    const seenHeaders: Headers[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrls.push(String(input));
      seenHeaders.push(new Headers(init?.headers));
      if (seenUrls.length === 1) {
        return new Response(null, {
          status: 307,
          headers: { location: "/GE/CC/VALIDATOR" },
        });
      }
      return new Response(JSON.stringify(playbackPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await expect(fetchManhua0996EpisodePlayback(sourceUrl, undefined, fetchImpl))
      .resolves.toMatchObject({ playbackUrl: playbackPayload.data.list[0].url });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(seenUrls[1]!).pathname).toBe("/GE/CC/VALIDATOR");
    expect(seenHeaders.every((headers) => !headers.has("cookie"))).toBe(true);
    expect(seenHeaders.every((headers) => !headers.has("authorization"))).toBe(true);
    expect(seenHeaders[1]!.get("sign")).toBe(seenHeaders[0]!.get("sign"));
  });

  it("API 重定向到非可信源站时在第二次请求前关闭式拒绝", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: "https://evil.example/steal" },
    })) as typeof fetch;

    await expect(fetchManhua0996EpisodePlayback(sourceUrl, undefined, fetchImpl))
      .rejects.toThrow("重定向到非可信源站");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("额外站点只从 Fly 服务端逗号白名单读取，丢弃 IP 与坏 host", () => {
    expect(readManhuaLearnExtraSourceHosts(
      "mirror.example.com, 127.0.0.1,localhost,mirror.example.com,bad_host",
    )).toEqual(["mirror.example.com"]);
  });

  it("底层网络失败透出 cause 的 name/code/message，不再吞成统一文案", async () => {
    const cause = Object.assign(new Error("Connect Timeout Error (attempted address: 203.0.113.8:443, timeout: 20000ms)"), {
      name: "ConnectTimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed", { cause });
    }) as unknown as typeof fetch;

    const failure = await fetchManhua0996EpisodePlayback(sourceUrl, undefined, fetchImpl)
      .then(() => null, (error: Error) => error.message);
    expect(failure).toContain("第三方播放页网络请求失败或超时");
    expect(failure).toContain("UND_ERR_CONNECT_TIMEOUT");
    expect(failure).toContain("ConnectTimeoutError");
    expect(failure).toContain("fetch failed");
  });

  it("敏感值（查询串/Cookie/Authorization/sign）绝不进入错误串", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(
        "request to https://www.gzcrkt8888.com/api/mw-movie/anonymous/v2/video/episode/url?clientType=1&id=146259&nid=1309017 failed",
        {
          cause: Object.assign(new Error(
            "socket hang up cookie=SECRET-COOKIE-VALUE authorization=Bearer SECRET-TOKEN sign=deadbeefcafe",
          ), { code: "ECONNRESET" }),
        },
      );
    }) as unknown as typeof fetch;

    const failure = await fetchManhua0996EpisodePlayback(sourceUrl, undefined, fetchImpl)
      .then(() => null, (error: Error) => error.message);
    expect(failure).toContain("第三方播放页网络请求失败或超时");
    expect(failure).toContain("ECONNRESET");
    expect(failure).not.toContain("SECRET-COOKIE-VALUE");
    expect(failure).not.toContain("SECRET-TOKEN");
    expect(failure).not.toContain("clientType=1");
    expect(failure).not.toContain("146259");
    expect(failure).not.toContain("deadbeefcafe");
  });

  it("错误文本清洗：URL 砍到主机、头部值遮蔽、换行与超长收口", () => {
    expect(sanitizeManhuaSourceErrorText(
      "GET https://a.example.com/path/file?sign=abc&t=123 -> cookie: session=SECRET",
    )).toBe("GET https://a.example.com/… -> cookie=<已遮蔽>");
    expect(sanitizeManhuaSourceErrorText("line1\r\nline2\tline3")).toBe("line1 line2 line3");
    expect(sanitizeManhuaSourceErrorText("x".repeat(500))).toHaveLength(200);
    expect(describeManhuaSourceFetchFailure(null)).toBe("");
    expect(describeManhuaSourceFetchFailure("plain failure")).toBe("value=plain failure");
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
