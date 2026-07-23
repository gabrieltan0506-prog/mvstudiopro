import { describe, expect, it } from "vitest";
import {
  buildDouyinMixCandidateUrls,
  buildNetscapeCookiesFromHeader,
  hasManhuaLearnYtdlpCookieSource,
  isDouyinSingleVideoUrl,
  isManhuaLearnPermissionDeniedHint,
  listedSingleEpisodeFromUrl,
  mapManhuaLearnFetchError,
  MANHUA_LEARN_FETCH_ERR,
  shouldSkipLocalLearnFallback,
} from "./manhuaLearnYtdlp";

describe("manhuaLearnYtdlp", () => {
  it("detects douyin single video urls", () => {
    expect(
      isDouyinSingleVideoUrl("https://www.douyin.com/video/7658227988223380788"),
    ).toBe(true);
    expect(isDouyinSingleVideoUrl("https://www.douyin.com/search/foo")).toBe(false);
    expect(isDouyinSingleVideoUrl("https://www.kuaishou.com/short-video/x")).toBe(false);
  });

  it("builds netscape cookies from header", () => {
    const body = buildNetscapeCookiesFromHeader("sessionid=abc; ttwid=xyz");
    expect(body).toContain("sessionid\tabc");
    expect(body).toContain("ttwid\txyz");
    expect(body).toContain(".douyin.com");
  });

  it("maps fresh-cookies stderr to login stale message", () => {
    const raw =
      "Command failed: /usr/local/bin/yt-dlp --flat-playlist -J --no-warnings\nERROR: [Douyin] Fresh cookies (not necessarily logged in) are needed";
    const mapped = mapManhuaLearnFetchError(raw);
    expect(mapped).toBe(MANHUA_LEARN_FETCH_ERR.douyinLoginStale);
    expect(mapped).toMatch(/趋势采集共用/);
    expect(shouldSkipLocalLearnFallback(mapped)).toBe(true);
  });

  it("lists single episode without remote call shape", () => {
    const listed = listedSingleEpisodeFromUrl(
      "https://www.douyin.com/video/1",
      "我攤牌了",
    );
    expect(listed).toEqual([
      { index: 1, url: "https://www.douyin.com/video/1", title: "我攤牌了" },
    ]);
  });

  it("detects cookie source from env", () => {
    expect(hasManhuaLearnYtdlpCookieSource({})).toBe(false);
    expect(hasManhuaLearnYtdlpCookieSource({ DOUYIN_COOKIE: "a=1" })).toBe(true);
    expect(
      hasManhuaLearnYtdlpCookieSource({ MANHUA_LEARN_YTDLP_COOKIES_FILE: "/tmp/c.txt" }),
    ).toBe(true);
  });

  it("builds mix candidate urls only for numeric mixId", () => {
    expect(buildDouyinMixCandidateUrls("1234567890123456789")).toEqual([
      "https://www.douyin.com/collection/1234567890123456789",
      "https://www.douyin.com/mix/1234567890123456789",
    ]);
    expect(buildDouyinMixCandidateUrls("重生漫剧开局")).toEqual([]);
  });

  it("maps paywall-like text to permission denied", () => {
    expect(isManhuaLearnPermissionDeniedHint("该集需付费解锁")).toBe(true);
    expect(mapManhuaLearnFetchError("需要购买后观看")).toBe(
      MANHUA_LEARN_FETCH_ERR.permissionDenied,
    );
  });
});
