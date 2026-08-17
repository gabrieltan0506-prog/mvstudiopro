import { describe, expect, it } from "vitest";
import {
  orderEpisodeMediaFallbackUrls,
  readMuxedPlaybackUrlsFromYtdlpInfo,
} from "./manhuaTemplateLearnService";

describe("manhua template learn media source policy", () => {
  it("优先采用清晰度更高的 yt-dlp muxed format，最后才回退 root url", () => {
    const root = "https://v3-dy-o.zjcdn.com/web-api-default.mp4";
    const url480 = "https://v3-dy-o.zjcdn.com/ytdlp-480.mp4";
    const url720 = "https://v3-dy-o.zjcdn.com/ytdlp-720.mp4";
    expect(readMuxedPlaybackUrlsFromYtdlpInfo({
      url: root,
      formats: [
        { url: url480, acodec: "aac", vcodec: "h264", height: 480, tbr: 1700 },
        { url: "https://v3-dy-o.zjcdn.com/audio-only.m4a", acodec: "aac", vcodec: "none" },
        { url: url720, acodec: "aac", vcodec: "h264", height: 720, tbr: 1850 },
      ],
    })).toEqual([url720, url480, root]);
  });

  it("恢复时先换到 yt-dlp 来源家族，再尝试其余 Web API 镜像", () => {
    expect(orderEpisodeMediaFallbackUrls(
      ["https://v3-dy-o.zjcdn.com/web-1.mp4", "https://v5-dy-o.zjcdn.com/web-2.mp4"],
      ["https://v3-dy-o.zjcdn.com/ytdlp-720.mp4", "https://v3-dy-o.zjcdn.com/web-1.mp4"],
    )).toEqual([
      "https://v3-dy-o.zjcdn.com/ytdlp-720.mp4",
      "https://v3-dy-o.zjcdn.com/web-1.mp4",
      "https://v5-dy-o.zjcdn.com/web-2.mp4",
    ]);
  });
});
