import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isTrustedManhua0996MediaUrl,
  isTrustedManhua0996SiteUrl,
  parseManhua0996PlaybackResponse,
  parseManhua0996SeriesPage,
  parseManhua0996SourceUrl,
} from "./manhuaLearn0996Source.js";

const fixture = (name: string) => readFileSync(
  fileURLToPath(new URL(`../server/services/__fixtures__/${name}`, import.meta.url)),
  "utf8",
);

describe("第三方播放页纯解析", () => {
  it("1007 已鉴权新CDN保留720优先、匿名限制与精确主机边界", () => {
    const payload = { code: 200, data: { list: [1080, 720, 480].map((resolution) => ({ resolution, needLogin: resolution !== 480, flag: resolution === 480, url: `https://ppvod021.zyxsuntech.com/${resolution}.m3u8` })) } };
    expect(parseManhua0996PlaybackResponse(payload, "https://0996zp.com/", true).playbackUrls).toEqual([720, 1080, 480].map(n => `https://ppvod021.zyxsuntech.com/${n}.m3u8`));
    expect(parseManhua0996PlaybackResponse(payload).playbackUrls).toEqual(["https://ppvod021.zyxsuntech.com/480.m3u8"]);
    for (const host of ["zyxsuntech.com", "other.zyxsuntech.com", "ppvod021.zyxsuntech.com.evil.test"]) expect(isTrustedManhua0996MediaUrl(`https://${host}/a.m3u8`)).toBe(false);
    expect(isTrustedManhua0996MediaUrl("http://ppvod021.zyxsuntech.com/a.m3u8")).toBe(false);
    expect(isTrustedManhua0996MediaUrl("https://user:pass@ppvod021.zyxsuntech.com/a.m3u8")).toBe(false);
  });
  it.each(["0996zp.com", "9zhoukj.com", "fntcome.com", "sizhengxt.com", "pumeiduolehuo.com"])("1007 用户指定镜像精确放行且不扩大媒体域：%s", (host) => {
    expect(parseManhua0996SourceUrl(`https://${host}/vod/play/113224/sid/751903`)).toMatchObject({ host });
    expect(isTrustedManhua0996SiteUrl(`https://${host}/api/play`)).toBe(true);
    expect(isTrustedManhua0996SiteUrl(`https://${host}.evil.test/api/play`)).toBe(false);
    expect(isTrustedManhua0996SiteUrl(`https://${host}:443/api/play`)).toBe(false);
    expect(isTrustedManhua0996MediaUrl(`https://${host}/film.m3u8`)).toBe(false);
  });
  it.each([
    ["https://0996zp.com/vod/play/146259/sid/1311527", "0996zp.com"],
    ["https://www.gzcrkt8888.com/vod/play/144970/1/1290958", "www.gzcrkt8888.com"],
  ])("只认显式可信播放路由：%s", (url, host) => {
    expect(parseManhua0996SourceUrl(url)).toMatchObject({ host });
  });

  it.each([
    "http://0996zp.com/vod/play/146259/sid/1311527",
    "https://0996zp.com:443/vod/play/146259/sid/1311527",
    "https://user:pass@0996zp.com/vod/play/146259/sid/1311527",
    "https://0996zp.com.evil.test/vod/play/146259/sid/1311527",
    "https://127.0.0.1/vod/play/146259/sid/1311527",
  ])("关闭式拒绝非可信来源：%s", (url) => {
    expect(parseManhua0996SourceUrl(url)).toBeNull();
  });

  it("额外镜像必须由服务端显式白名单逐个放行，后缀仿冒仍拒绝", () => {
    expect(parseManhua0996SourceUrl(
      "https://mirror.example.com/vod/play/146259/1/1311527",
      ["mirror.example.com"],
    )).toMatchObject({ host: "mirror.example.com" });
    expect(parseManhua0996SourceUrl(
      "https://mirror.example.com.evil.test/vod/play/146259/1/1311527",
      ["mirror.example.com"],
    )).toBeNull();
  });

  it("从 SSR 锚点取同剧目录，并按 nid 锚定真实集号", () => {
    const source = parseManhua0996SourceUrl(
      "https://0996zp.com/vod/play/146259/sid/1311527",
    )!;
    const parsed = parseManhua0996SeriesPage(fixture("manhua-0996-series-page.html"), source);
    expect(parsed.titleZh).toBe("花开锦绣");
    expect(parsed.currentEpisodeIndex).toBe(20);
    expect(parsed.episodes.map((row) => [row.index, row.nid])).toEqual([
      [1, "1309017"],
      [2, "1309013"],
      [20, "1311527"],
      [21, "1311604"],
    ]);
  });

  it("页面宣称的总集数与 SSR 分集目录不一致时关闭式停止", () => {
    const source = parseManhua0996SourceUrl(
      "https://0996zp.com/vod/play/146259/sid/1311527",
    )!;
    const html = fixture("manhua-0996-series-page.html").replace("共4集", "共36集");
    expect(() => parseManhua0996SeriesPage(html, source)).toThrow("分集目录未完整展开");
  });

  it("只选匿名可用媒体档，片头片尾只作为标记返回", () => {
    const parsed = parseManhua0996PlaybackResponse(
      JSON.parse(fixture("manhua-0996-playback.json")),
      "https://0996zp.com/",
    );
    expect(parsed.playbackUrl).toBe("https://ppvod01.kqgfbs.com/free/index.m3u8");
    expect(parsed.playbackUrls).toHaveLength(1);
    expect(parsed.markers).toEqual([
      { kind: "opening", startSec: 0, endSec: 103, origin: "source_api" },
      { kind: "ending", startSec: 2477, origin: "source_api" },
    ]);
  });

  it("拒绝任意外域、私网和非 HTTPS 媒体", () => {
    expect(isTrustedManhua0996MediaUrl("https://ppvod01.kqgfbs.com/a.m3u8")).toBe(true);
    expect(isTrustedManhua0996MediaUrl("https://kqgfbs.com.evil.test/a.m3u8")).toBe(false);
    expect(isTrustedManhua0996MediaUrl("http://ppvod01.kqgfbs.com/a.m3u8")).toBe(false);
    expect(() => parseManhua0996PlaybackResponse({
      code: 200,
      data: { list: [{ flag: true, needLogin: false, url: "https://127.0.0.1/a.m3u8" }] },
    })).toThrow("没有无需登录的可信媒体档");
  });
});

describe("0902 电影单片页豁免", () => {
  it("只有一个播放条目且无「共X集」声明时按单片放行，不再误报目录未展开", () => {
    const source = { host: "0996zp.com", vodId: "113224", nid: "751903" } as any;
    const html = `
      <h1 class="title_name">盗梦空间</h1>
      <a href="/vod/play/113224/sid/751903">HD</a>
    `;
    const page = parseManhua0996SeriesPage(html, source);
    expect(page.episodes).toHaveLength(1);
    expect(page.currentEpisodeIndex).toBe(1);
    expect(page.titleZh).toBe("盗梦空间");
  });
});
