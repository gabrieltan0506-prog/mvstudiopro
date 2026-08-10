import { describe, expect, it } from "vitest";
import {
  MANHUA_LEARN_SEGMENT_MAX_BYTES,
  buildManhuaLearnYtdlpMetadataArgs,
  buildManhuaLearnYtdlpSection,
  buildManhuaLearnYtdlpSegmentArgs,
  isOwnedManhuaLearnImportGcsUri,
  nextManhuaLearnVideoSegment,
  parseManhuaLearnRemoteDurationSec,
} from "./manhuaLearnVideoSegments";
import { normalizeDouyinVideoUrl } from "./manhuaLearnYtdlp";

describe("长视频分段学习规则", () => {
  it("从断点按十分钟取下一段并自然收尾", () => {
    expect(nextManhuaLearnVideoSegment({ cursorSec: 0, durationSec: 1_250, segmentSec: 600 })).toEqual({
      startSec: 0,
      endSec: 600,
    });
    expect(nextManhuaLearnVideoSegment({ cursorSec: 1_200, durationSec: 1_250, segmentSec: 600 })).toEqual({
      startSec: 1_200,
      endSec: 1_250,
    });
    expect(nextManhuaLearnVideoSegment({ cursorSec: 1_250, durationSec: 1_250, segmentSec: 600 })).toBeNull();
  });

  it("解析 yt-dlp 秒数并兼容 duration_ms", () => {
    expect(parseManhuaLearnRemoteDurationSec({ duration: 7_199.5 })).toBe(7_199.5);
    expect(parseManhuaLearnRemoteDurationSec({ duration_ms: 90_000 })).toBe(90);
    expect(parseManhuaLearnRemoteDurationSec({ duration: "" })).toBe(0);
  });

  it("构造 yt-dlp 时间裁切参数", () => {
    expect(buildManhuaLearnYtdlpSection(600, 1_200.1254)).toBe("*600-1200.125");
    expect(() => buildManhuaLearnYtdlpSection(10, 10)).toThrow("结束时间");
  });

  it("元数据探测不下载媒体", () => {
    const args = buildManhuaLearnYtdlpMetadataArgs({
      url: "https://www.douyin.com/video/123",
      cookieArgs: ["--cookies", "/tmp/cookies.txt"],
    });
    expect(args).toContain("--dump-single-json");
    expect(args).toContain("--skip-download");
    expect(args[args.length - 1]).toBe("https://www.douyin.com/video/123");
  });

  it("分段下载限 720p、强制切点，且不再用整片 max-filesize", () => {
    const args = buildManhuaLearnYtdlpSegmentArgs({
      url: "https://www.douyin.com/video/123",
      outputTemplate: "/tmp/source.%(ext)s",
      startSec: 600,
      endSec: 1_200,
    });
    expect(args).toContain("*600-1200");
    expect(args).toContain("--force-keyframes-at-cuts");
    expect(args.join(" ")).toContain("height<=720");
    expect(args).not.toContain("--max-filesize");
    expect(MANHUA_LEARN_SEGMENT_MAX_BYTES).toBe(800 * 1024 * 1024);
  });

  it("手动导入对象必须同时匹配配置桶与本人上传前缀", () => {
    expect(isOwnedManhuaLearnImportGcsUri({
      gcsUri: "gs://bucket-a/uploads/u42/abc.mp4",
      bucket: "bucket-a",
      userId: 42,
    })).toBe(true);
    expect(isOwnedManhuaLearnImportGcsUri({
      gcsUri: "gs://other/uploads/u42/abc.mp4",
      bucket: "bucket-a",
      userId: 42,
    })).toBe(false);
    expect(isOwnedManhuaLearnImportGcsUri({
      gcsUri: "gs://bucket-a/uploads/u7/abc.mp4",
      bucket: "bucket-a",
      userId: 42,
    })).toBe(false);
  });

  it("把搜索结果外壳里的真实 modal_id 转成可下载单片链接", () => {
    const pasted = "https://www.douyin.com/video/7658227988223380788/search/%E8%81%9A%E5%AF%B6%E4%BB%99%E7%9B%86?aid=adbd5b87-80c9-4a18-96e5-0b170417b97b&modal_id=7617289323125263666&type=general";
    expect(normalizeDouyinVideoUrl(pasted)).toBe(
      "https://www.douyin.com/video/7617289323125263666",
    );
  });
});
