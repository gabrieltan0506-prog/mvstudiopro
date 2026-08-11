import { describe, expect, it } from "vitest";
import {
  buildDouyinMixCandidateUrls,
  buildNetscapeCookiesFromHeader,
  hasManhuaLearnYtdlpCookieSource,
  isDouyinSingleVideoUrl,
  normalizeDouyinVideoUrl,
  isManhuaLearnPermissionDeniedHint,
  listedSingleEpisodeFromUrl,
  mapManhuaLearnFetchError,
  MANHUA_LEARN_FETCH_ERR,
  listDouyinCookieCandidatesFromEnv,
  pickDouyinCookieHeaderFromEnv,
  rotateDouyinCookieCandidates,
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

  it("modal_id 弹层链接按单集识别并归一化成 /video/ 标准形态", () => {
    const modal = "https://www.douyin.com/discover?modal_id=7658227988223380788";
    expect(isDouyinSingleVideoUrl(modal)).toBe(true);
    expect(normalizeDouyinVideoUrl(modal)).toBe(
      "https://www.douyin.com/video/7658227988223380788",
    );
    // 搜索页带 modal_id 同样是单集
    expect(
      isDouyinSingleVideoUrl("https://www.douyin.com/root/search/古装?modal_id=7649000000000000001"),
    ).toBe(true);
    // 非抖音域名不认；已是 /video/ 形态原样返回
    expect(isDouyinSingleVideoUrl("https://example.com/x?modal_id=123456789")).toBe(false);
    expect(normalizeDouyinVideoUrl("https://www.douyin.com/video/111222333")).toBe(
      "https://www.douyin.com/video/111222333",
    );
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

  it("主、备、池凭证去重后可按候选编号轮转", () => {
    const env = {
      DOUYIN_COOKIE: "account-a=1",
      DOUYIN_COOKIE_BACKUP: "account-b=1",
      DOUYIN_COOKIE_POOL: "account-b=1\naccount-c=1",
    };
    const candidates = listDouyinCookieCandidatesFromEnv(env);
    expect(candidates).toEqual(["account-a=1", "account-b=1", "account-c=1"]);
    expect(pickDouyinCookieHeaderFromEnv(env, 1)).toBe("account-b=1");
    expect(pickDouyinCookieHeaderFromEnv(env, 4)).toBe("account-b=1");
    expect(rotateDouyinCookieCandidates(candidates, 1)).toEqual([
      "account-b=1",
      "account-c=1",
      "account-a=1",
    ]);
  });

  it("builds mix candidate urls only for numeric mixId", () => {
    expect(buildDouyinMixCandidateUrls("1234567890123456789")).toEqual([
      "https://www.douyin.com/collection/1234567890123456789",
      "https://www.douyin.com/mix/1234567890123456789",
    ]);
    expect(buildDouyinMixCandidateUrls("重生漫剧开局")).toEqual([]);
  });

  /** cookie 有效却被指着鼻子说过期，用户换几次 cookie 也修不好 */
  it("解析失败不再冒充登录态失效", () => {
    const raw =
      "Command failed: /usr/local/bin/yt-dlp --cookies /tmp/dy.txt --flat-playlist -J\nERROR: [Douyin] 7648258717669918760: Unable to extract webpage data";
    const mapped = mapManhuaLearnFetchError(raw);
    expect(mapped).toBe(MANHUA_LEARN_FETCH_ERR.pageShapeChanged);
    expect(mapped).not.toMatch(/登录态/);
    // 换本机跑同一条命令结果一样，但这不是登录问题，回退仍应放行
    expect(shouldSkipLocalLearnFallback(mapped)).toBe(false);
  });

  it("命令行里带 --cookies 不算登录信号", () => {
    const raw =
      "Command failed: yt-dlp --cookies /tmp/dy.txt https://www.douyin.com/video/1\nERROR: unable to download video data: timed out";
    expect(mapManhuaLearnFetchError(raw)).not.toBe(MANHUA_LEARN_FETCH_ERR.douyinLoginStale);
  });

  /** 视频 id 里带 403 就判登录失效，属于误伤 */
  it("正文里出现 401/403 数字不判登录态", () => {
    const raw = "Command failed: yt-dlp https://www.douyin.com/video/7403000000000000000\nERROR: read timeout";
    expect(mapManhuaLearnFetchError(raw)).toBe(MANHUA_LEARN_FETCH_ERR.downloadFailed);
  });

  it("真的 HTTP 401/403 仍判登录态", () => {
    expect(mapManhuaLearnFetchError("ERROR: unable to download: HTTP Error 403: Forbidden")).toBe(
      MANHUA_LEARN_FETCH_ERR.douyinLoginStale,
    );
  });

  /** 站内会话失效的文案不含「登录态」三字，旧规则漏判，导致照样复制一条同样会失败的本机命令 */
  it("站内会话失效也跳过本机回退", () => {
    expect(
      shouldSkipLocalLearnFallback("登录状态已失效，请刷新页面重新登录后再试（分析任务可能仍在后台运行）"),
    ).toBe(true);
  });

  it("maps paywall-like text to permission denied", () => {
    expect(isManhuaLearnPermissionDeniedHint("该集需付费解锁")).toBe(true);
    expect(mapManhuaLearnFetchError("需要购买后观看")).toBe(
      MANHUA_LEARN_FETCH_ERR.permissionDenied,
    );
  });
});
