import { describe, expect, it } from "vitest";
import {
  assertPublicManhuaSourceHost,
  buildManhua0996EpisodeApiRequest,
  readManhuaLearnExtraSourceHosts,
} from "./manhuaLearn0996Source.js";
import { parseManhua0996SourceUrl } from "../../shared/manhuaLearn0996Source.js";

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
