import { describe, expect, it } from "vitest";
import {
  XYQ_SEEDANCE_25_MODEL,
  XYQ_VIDEO_PART_AGENT,
} from "../../shared/xyqSeedanceModels";
import { __xyqSeedanceTest, buildXyqGenerateVideoBody } from "./xyqSeedanceVideo";

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
