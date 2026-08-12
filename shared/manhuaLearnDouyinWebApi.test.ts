import { describe, expect, it } from "vitest";
import {
  buildDouyinAwemeDetailApiUrl,
  buildDouyinMixAwemeApiUrl,
  extractDouyinMixIdFromUrl,
  extractDouyinVideoIdFromUrl,
  isDouyinWebApiStatusOk,
  mergeDouyinMixEpisodePages,
  parseDouyinAwemeDetailResponse,
  parseDouyinMixAwemeResponse,
  readDouyinPlaybackUrl,
  readDouyinPlaybackUrls,
} from "./manhuaLearnDouyinWebApi";

describe("抖音 web API URL 构造", () => {
  it("mix/aweme 带 mix_id/cursor/count 与 webapp 公共参数", () => {
    const url = new URL(buildDouyinMixAwemeApiUrl("7412345678901234567", 30, 30));
    expect(url.pathname).toBe("/aweme/v1/web/mix/aweme/");
    expect(url.searchParams.get("mix_id")).toBe("7412345678901234567");
    expect(url.searchParams.get("cursor")).toBe("30");
    expect(url.searchParams.get("count")).toBe("30");
    expect(url.searchParams.get("aid")).toBe("6383");
    expect(url.searchParams.get("device_platform")).toBe("webapp");
  });

  it("count 超界收敛到 1–30", () => {
    expect(new URL(buildDouyinMixAwemeApiUrl("123456", 0, 999)).searchParams.get("count")).toBe("30");
    expect(new URL(buildDouyinMixAwemeApiUrl("123456", -5, 0)).searchParams.get("cursor")).toBe("0");
  });

  it("aweme/detail 带 aweme_id", () => {
    const url = new URL(buildDouyinAwemeDetailApiUrl("7400000000000000001"));
    expect(url.pathname).toBe("/aweme/v1/web/aweme/detail/");
    expect(url.searchParams.get("aweme_id")).toBe("7400000000000000001");
  });
});

describe("extractDouyinVideoIdFromUrl", () => {
  it("认 /video/、/note/ 与 modal_id 三形态", () => {
    expect(extractDouyinVideoIdFromUrl("https://www.douyin.com/video/7400000000000000001")).toBe(
      "7400000000000000001",
    );
    expect(extractDouyinVideoIdFromUrl("https://www.douyin.com/note/7400000000000000002")).toBe(
      "7400000000000000002",
    );
    expect(
      extractDouyinVideoIdFromUrl("https://www.douyin.com/root/search/x?modal_id=7400000000000000003"),
    ).toBe("7400000000000000003");
  });

  it("iesdouyin 分享形态 /share/video/ 也认（isDouyinSingleVideoUrl 同口径）", () => {
    expect(
      extractDouyinVideoIdFromUrl("https://www.iesdouyin.com/share/video/7400000000000000004/?x=1"),
    ).toBe("7400000000000000004");
  });

  it("非视频链接返回 null", () => {
    expect(extractDouyinVideoIdFromUrl("https://www.douyin.com/collection/74123456789")).toBeNull();
    expect(extractDouyinVideoIdFromUrl("")).toBeNull();
  });
});

describe("extractDouyinMixIdFromUrl", () => {
  it("collection 与 mix 页（含 /share/ 前缀）都提得出 mixId", () => {
    expect(extractDouyinMixIdFromUrl("https://www.douyin.com/collection/7412345678901234567")).toBe(
      "7412345678901234567",
    );
    expect(extractDouyinMixIdFromUrl("https://www.douyin.com/mix/7412345678901234567?p=1")).toBe(
      "7412345678901234567",
    );
    expect(
      extractDouyinMixIdFromUrl("https://www.iesdouyin.com/share/mix/7412345678901234567"),
    ).toBe("7412345678901234567");
  });

  it("单集/其它链接返回 null", () => {
    expect(extractDouyinMixIdFromUrl("https://www.douyin.com/video/7400000000000000001")).toBeNull();
    expect(extractDouyinMixIdFromUrl("")).toBeNull();
  });
});

function mixItem(awemeId: string, epNo: number | null, desc = "", mixName = "测试短剧") {
  return {
    aweme_id: awemeId,
    desc,
    mix_info: {
      mix_id: "7412345678901234567",
      mix_name: mixName,
      statis: epNo == null ? {} : { current_episode: epNo },
    },
  };
}

describe("parseDouyinMixAwemeResponse", () => {
  it("正常页：集号取 current_episode，标题优先 desc，剧名取 mix_name", () => {
    const parsed = parseDouyinMixAwemeResponse({
      status_code: 0,
      has_more: 1,
      cursor: 2,
      aweme_list: [
        mixItem("7400000000000000001", 1, "第1集 逆袭开场"),
        mixItem("7400000000000000002", 2, ""),
      ],
    });
    expect(parsed.statusCode).toBe(0);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextCursor).toBe(2);
    expect(parsed.mixNameZh).toBe("测试短剧");
    expect(parsed.episodes).toEqual([
      { index: 1, url: "https://www.douyin.com/video/7400000000000000001", title: "第1集 逆袭开场" },
      { index: 2, url: "https://www.douyin.com/video/7400000000000000002", title: "第2集" },
    ]);
  });

  it("缺 current_episode 时按到达顺序补号，跨页续接不重号", () => {
    const parsed = parseDouyinMixAwemeResponse(
      {
        status_code: 0,
        aweme_list: [mixItem("7400000000000000003", null), mixItem("7400000000000000004", null)],
      },
      2,
    );
    expect(parsed.episodes.map((e) => e.index)).toEqual([3, 4]);
  });

  it("status_code 0/200 都算成功（趋势采集器生产口径），其余失败", () => {
    expect(isDouyinWebApiStatusOk(0)).toBe(true);
    expect(isDouyinWebApiStatusOk(200)).toBe(true);
    expect(isDouyinWebApiStatusOk(8)).toBe(false);
    const ok200 = parseDouyinMixAwemeResponse({
      status_code: 200,
      aweme_list: [mixItem("7400000000000000009", 9)],
    });
    expect(ok200.episodes.map((e) => e.index)).toEqual([9]);
    const bad = parseDouyinMixAwemeResponse({ status_code: 8, aweme_list: [mixItem("74000", 1)] });
    expect(bad.statusCode).toBe(8);
    expect(bad.episodes).toHaveLength(0);
  });

  it("aweme_id 不合法的条目丢弃；空 payload 不炸", () => {
    const parsed = parseDouyinMixAwemeResponse({
      status_code: 0,
      aweme_list: [{ aweme_id: "abc", desc: "坏条目" }, null, mixItem("7400000000000000005", 5)],
    });
    expect(parsed.episodes.map((e) => e.index)).toEqual([5]);
    expect(parseDouyinMixAwemeResponse(null).episodes).toHaveLength(0);
    expect(parseDouyinMixAwemeResponse("junk").episodes).toHaveLength(0);
  });
});

describe("parseDouyinAwemeDetailResponse", () => {
  it("单集详情：回填标题/所属合集/集号", () => {
    const parsed = parseDouyinAwemeDetailResponse({
      status_code: 0,
      aweme_detail: {
        desc: "边关翻盘 第7集",
        mix_info: {
          mix_id: "7412345678901234567",
          mix_name: "边关翻盘",
          statis: { current_episode: 7 },
        },
      },
    });
    expect(parsed).toEqual({
      titleZh: "边关翻盘 第7集",
      mixId: "7412345678901234567",
      mixNameZh: "边关翻盘",
      episodeIndex: 7,
    });
  });

  it("无 mix_info 的普通单条也回标题（剧名回填仍有得用）", () => {
    const parsed = parseDouyinAwemeDetailResponse({
      status_code: 0,
      aweme_detail: { desc: "单条成片标题" },
    });
    expect(parsed?.titleZh).toBe("单条成片标题");
    expect(parsed?.mixId).toBeUndefined();
  });

  it("标题与合集字段暂缺时仍保留可信播放地址", () => {
    const parsed = parseDouyinAwemeDetailResponse({
      status_code: 0,
      aweme_detail: {
        video: { play_addr: { url_list: ["https://v9.zjcdn.com/only-playback.mp4"] } },
      },
    });
    expect(parsed?.playbackUrl).toBe("https://v9.zjcdn.com/only-playback.mp4");
  });

  it("status_code 非 0 或空 detail 返回 null", () => {
    expect(parseDouyinAwemeDetailResponse({ status_code: 2, aweme_detail: { desc: "x" } })).toBeNull();
    expect(parseDouyinAwemeDetailResponse({ status_code: 0 })).toBeNull();
    expect(parseDouyinAwemeDetailResponse(null)).toBeNull();
  });
});

describe("mergeDouyinMixEpisodePages", () => {
  it("多页合并：按集号排序、同号保留先到者", () => {
    const merged = mergeDouyinMixEpisodePages([
      [
        { index: 2, url: "u2", title: "第2集" },
        { index: 1, url: "u1", title: "第1集" },
      ],
      [
        { index: 2, url: "u2-dup", title: "第2集重复" },
        { index: 3, url: "u3", title: "第3集" },
      ],
    ]);
    expect(merged.map((e) => e.index)).toEqual([1, 2, 3]);
    expect(merged[1]!.url).toBe("u2");
  });
});

describe("readDouyinPlaybackUrl（官方播放地址提取）", () => {
  it("play_addr.url_list 里首个可信 HTTPS 地址被采纳", () => {
    expect(
      readDouyinPlaybackUrl({
        video: {
          play_addr: {
            url_list: [
              "http://v3-web.douyinvod.com/insecure.mp4",
              "https://v3-web.douyinvod.com/ok.mp4?sig=1",
            ],
          },
        },
      }),
    ).toBe("https://v3-web.douyinvod.com/ok.mp4?sig=1");
  });

  it("白名单外域名与非 HTTPS 一律丢弃", () => {
    expect(
      readDouyinPlaybackUrl({
        video: { play_addr: { url_list: ["https://evil.com/x.mp4", "http://www.douyin.com/a"] } },
      }),
    ).toBeUndefined();
    // 子串伪装域（evildouyinvod.com 不是 *.douyinvod.com）
    expect(
      readDouyinPlaybackUrl({
        video: { play_addr: { url_list: ["https://evildouyinvod.com/x.mp4"] } },
      }),
    ).toBeUndefined();
  });

  it("兼容 playAddr.urlList 驼峰变体与 aweme_info 包壳", () => {
    expect(
      readDouyinPlaybackUrl({
        aweme_info: { video: { playAddr: { urlList: ["https://www.douyin.com/aweme/v1/play/x"] } } },
      }),
    ).toBe("https://www.douyin.com/aweme/v1/play/x");
  });

  it("缺 video/play_addr/url_list 时返回 undefined 不抛错", () => {
    expect(readDouyinPlaybackUrl(null)).toBeUndefined();
    expect(readDouyinPlaybackUrl({})).toBeUndefined();
    expect(readDouyinPlaybackUrl({ video: {} })).toBeUndefined();
    expect(readDouyinPlaybackUrl({ video: { play_addr: { url_list: "not-array" } } })).toBeUndefined();
  });

  it("收齐主播放、下载地址与多码率候选并去重", () => {
    expect(readDouyinPlaybackUrls({
      video: {
        play_addr: { url_list: ["https://v1.douyinvod.com/main.mp4"] },
        download_addr: { url_list: ["https://v2.douyinvod.com/download.mp4"] },
        bit_rate: [
          { play_addr: { url_list: ["https://v3.douyinvod.com/hd.mp4"] } },
          { play_addr: { url_list: ["https://v1.douyinvod.com/main.mp4"] } },
        ],
      },
    })).toEqual([
      "https://v1.douyinvod.com/main.mp4",
      "https://v2.douyinvod.com/download.mp4",
      "https://v3.douyinvod.com/hd.mp4",
    ]);
  });

  it("mix 分页解析把 playbackUrl 带进分集", () => {
    const parsed = parseDouyinMixAwemeResponse({
      status_code: 0,
      has_more: 0,
      aweme_list: [
        {
          aweme_id: "7400000000000000001",
          desc: "第1集",
          mix_info: { mix_name: "测试剧", statis: { current_episode: 1 } },
          video: { play_addr: { url_list: ["https://v5.douyinvod.com/e1.mp4?sig=a"] } },
        },
        {
          aweme_id: "7400000000000000002",
          desc: "第2集",
          mix_info: { statis: { current_episode: 2 } },
        },
      ],
    });
    expect(parsed.episodes[0]?.playbackUrl).toBe("https://v5.douyinvod.com/e1.mp4?sig=a");
    expect(parsed.episodes[1]?.playbackUrl).toBeUndefined();
  });

  it("aweme/detail 解析带 playbackUrl", () => {
    const parsed = parseDouyinAwemeDetailResponse({
      status_code: 0,
      aweme_detail: {
        desc: "第3集",
        mix_info: { mix_id: "7412345678901234567", mix_name: "测试剧", statis: { current_episode: 3 } },
        video: { play_addr: { url_list: ["https://v9.zjcdn.com/e3.mp4?sig=c"] } },
      },
    });
    expect(parsed?.playbackUrl).toBe("https://v9.zjcdn.com/e3.mp4?sig=c");
    expect(parsed?.episodeIndex).toBe(3);
  });
});
