import { describe, expect, it } from "vitest";
import {
  XYQ_SEEDANCE_25_MODEL,
  XYQ_VIDEO_PART_AGENT,
} from "../../shared/xyqSeedanceModels";
import {
  __xyqSeedanceTest,
  buildXyqEraseSubtitleBody,
  buildXyqGenerateVideoBody,
  buildXyqNestEditBody,
  buildXyqSuperResolutionBody,
} from "./xyqSeedanceVideo";

describe("buildXyqGenerateVideoBody", () => {
  it("builds text-only Seedance_2.5 body", () => {
    const body = buildXyqGenerateVideoBody({
      prompt: "夜雨雁门",
      durationSec: 8,
      ratio: "9:16",
      resolution: "720p",
    });
    expect(body.agent_name).toBe(XYQ_VIDEO_PART_AGENT);
    expect(body.message).toBe("夜雨雁门");
    const param = body.video_part_tool_param as Record<string, unknown>;
    expect(param.model).toBe(XYQ_SEEDANCE_25_MODEL);
    expect(param.prompt).toBe("夜雨雁门");
    expect(param.duration_sec).toBe(8);
    expect(param.ratio).toBe("9:16");
    expect(param.resolution).toBe("720p");
    expect(param.generate_type).toBeUndefined();
  });

  it("auto sets generate_type=1 for first-last two images", () => {
    const body = buildXyqGenerateVideoBody({
      prompt: "从首帧到尾帧",
      imageAssetIds: ["a1", "a2"],
    });
    const param = body.video_part_tool_param as Record<string, unknown>;
    expect(param.generate_type).toBe(1);
    expect(param.images).toEqual([{ pippit_asset_id: "a1" }, { pippit_asset_id: "a2" }]);
  });

  it("does not force first-last when video refs present", () => {
    const body = buildXyqGenerateVideoBody({
      prompt: "改片",
      imageAssetIds: ["a1", "a2"],
      videoAssetIds: ["v1"],
    });
    const param = body.video_part_tool_param as Record<string, unknown>;
    expect(param.generate_type).toBeUndefined();
    expect(param.videos).toEqual([{ pippit_asset_id: "v1" }]);
  });

  it("extend mode never sets generate_type=1 even with two images", () => {
    const body = buildXyqGenerateVideoBody({
      prompt: "续写",
      imageAssetIds: ["a1", "a2"],
      videoAssetIds: ["v1"],
      generateType: 1,
      workMode: "extend",
    });
    const param = body.video_part_tool_param as Record<string, unknown>;
    expect(param.generate_type).toBeUndefined();
    expect(param.videos).toEqual([{ pippit_asset_id: "v1" }]);
    expect(body.agent_name).toBe(XYQ_VIDEO_PART_AGENT);
  });
});

describe("buildXyqNestEditBody", () => {
  it("builds nest message+asset_ids without video_part_tool_param", () => {
    const body = buildXyqNestEditBody({
      message: "【局部重拍】仅重做 2-5 秒",
      assetIds: ["vid_1", "img_1"],
      threadId: "thr_prev",
    });
    expect(body.message).toContain("局部重拍");
    expect(body.asset_ids).toEqual(["vid_1", "img_1"]);
    expect(body.thread_id).toBe("thr_prev");
    expect(body.agent_name).toBeUndefined();
    expect(body.video_part_tool_param).toBeUndefined();
  });

  it("rejects empty assets", () => {
    expect(() => buildXyqNestEditBody({ message: "x", assetIds: [] })).toThrow(/参考/);
  });
});

describe("buildXyqSuperResolutionBody", () => {
  it("uses mini_tool_param video_super_resolution_tool_param", () => {
    const body = buildXyqSuperResolutionBody({
      videoAssetId: "vid_sr",
      outputResolution: "1080p",
      toolVersion: "standard",
    });
    expect(body.agent_name).toBe(XYQ_VIDEO_PART_AGENT);
    expect(body.message).toBe("提升视频清晰度");
    expect(body.asset_ids).toBeUndefined();
    const param = body.video_part_tool_param as any;
    expect(param.mini_tool_param.tool_name).toBe("video_super_resolution");
    expect(
      param.mini_tool_param.tool_param.video_super_resolution_tool_param.video.pippit_asset_id,
    ).toBe("vid_sr");
    expect(
      param.mini_tool_param.tool_param.video_super_resolution_tool_param.output_resolution,
    ).toBe("1080p");
  });
});

describe("buildXyqEraseSubtitleBody", () => {
  it("uses mini_tool_param erase_video_subtitle_tool_param", () => {
    const body = buildXyqEraseSubtitleBody({ videoAssetId: "vid_sub" });
    expect(body.message).toBe("擦除视频字幕");
    const param = body.video_part_tool_param as any;
    expect(param.mini_tool_param.tool_name).toBe("erase_video_subtitle");
    expect(
      param.mini_tool_param.tool_param.erase_video_subtitle_tool_param.video.pippit_asset_id,
    ).toBe("vid_sub");
  });
});

describe("isXyqAllowedAudioUrl", () => {
  it("allows mp3/wav only", () => {
    expect(__xyqSeedanceTest.isXyqAllowedAudioUrl("https://x/a.mp3")).toBe(true);
    expect(__xyqSeedanceTest.isXyqAllowedAudioUrl("https://x/a.wav")).toBe(true);
    expect(__xyqSeedanceTest.isXyqAllowedAudioUrl("https://x/a.m4a")).toBe(false);
    expect(__xyqSeedanceTest.isXyqAllowedAudioUrl("https://x/a.aac")).toBe(false);
  });
});

describe("xyq poll extract", () => {
  it("reads download_url when run succeeded", () => {
    const out = __xyqSeedanceTest.extractVideoDownloadUrl(
      {
        thread: {
          run_list: [
            {
              run_id: "r1",
              state: 3,
              entry_list: [
                {
                  artifact: {
                    content: [
                      {
                        sub_type: "biz/x_data_video",
                        data: { video: { download_url: "https://cdn.example/v.mp4" } },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      "r1",
    );
    expect(out.downloadUrl).toBe("https://cdn.example/v.mp4");
    expect(out.completed).toBe(true);
    expect(out.failed).toBe(false);
  });

  it("marks failed run", () => {
    const out = __xyqSeedanceTest.extractVideoDownloadUrl(
      {
        thread: {
          run_list: [{ run_id: "r1", state: 4, error_message: "积分不足" }],
        },
      },
      "r1",
    );
    expect(out.failed).toBe(true);
    expect(out.errorMessage).toContain("积分");
  });
});
