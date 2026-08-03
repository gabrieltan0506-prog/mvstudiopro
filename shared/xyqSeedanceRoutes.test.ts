import { describe, expect, it } from "vitest";
import {
  parseXyqSeedance25WorkMode,
  xyqWorkModeIsMiniTool,
  xyqWorkModeIsNest,
  xyqWorkModeNeedsVideo,
  type XyqSeedance25WorkMode,
} from "./xyqSeedancePrompt";

/** 验收矩阵：Fable / CLI 对照用，禁止空壳混路由 */
const ROUTE_MATRIX: Array<{
  mode: XyqSeedance25WorkMode;
  nest: boolean;
  mini: boolean;
  needsVideo: boolean;
}> = [
  { mode: "generate", nest: false, mini: false, needsVideo: false },
  { mode: "extend", nest: false, mini: false, needsVideo: true },
  { mode: "reshoot", nest: true, mini: false, needsVideo: true },
  { mode: "remix", nest: true, mini: false, needsVideo: true },
  { mode: "upscale", nest: false, mini: true, needsVideo: true },
  { mode: "erase_subtitle", nest: false, mini: true, needsVideo: true },
];

describe("xyq Seedance 2.5 route matrix", () => {
  it("keeps nest / mini_tool / video_part mutually consistent", () => {
    for (const row of ROUTE_MATRIX) {
      expect(parseXyqSeedance25WorkMode(row.mode)).toBe(row.mode);
      expect(xyqWorkModeIsNest(row.mode)).toBe(row.nest);
      expect(xyqWorkModeIsMiniTool(row.mode)).toBe(row.mini);
      expect(xyqWorkModeNeedsVideo(row.mode)).toBe(row.needsVideo);
      // nest 与 mini 不得同时为真
      expect(row.nest && row.mini).toBe(false);
    }
  });
});
