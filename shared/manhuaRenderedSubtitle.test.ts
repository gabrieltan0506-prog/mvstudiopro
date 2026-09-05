import { describe, expect, it } from "vitest";
import { buildRenderedSubtitleTimeline, normalizeManhuaRenderedSubtitle, subtitleCuesForRenderedSource } from "./manhuaRenderedSubtitle";
import { replaceManhuaFinalAssembleVersion, findManhuaFinalVideoVersionIdentity } from "./manhuaFinalPostProd";
import { sanitizeManhuaCloudDraftBlock } from "./manhuaCloudDraft";
import { normalizeCanvasBlock } from "../client/src/lib/canvasTypes";
import { buildManhuaSubtitleBurnSrt } from "./manhuaEditSubtitle";

describe("实际合成字幕合同", () => {
  it("计划4秒不覆盖实际8秒源镜窗，裁切后字幕保留真实相交部分", () => {
    const cues = subtitleCuesForRenderedSource({ source: { shots: [
      { shotIndex: 1, durationSec: 4, textZh: "前半句" }, { shotIndex: 2, durationSec: 4, textZh: "后半句" },
    ] }, sourceDuration: 16, trimStart: 4, renderedDuration: 8 });
    expect(cues.map(c => [c.textZh, c.startSec, c.endSec])).toEqual([["前半句", 0, 4], ["后半句", 4, 8]]);
  });
  it("真实重排、转场重叠和静帧共同决定秒位，不把静帧生成对白", () => {
    const cue = (textZh: string) => ({ shotIndex: 1, order: 1, startSec: 0, endSec: 2, textZh });
    const receipt = buildRenderedSubtitleTimeline([
      { duration: 2, cues: [cue("乙")] }, { duration: 1.2, cues: [] }, { duration: 2, cues: [cue("甲")] },
    ], "fade", 4);
    expect(receipt.cues.map(c => [c.textZh, c.startSec, c.endSec])).toEqual([["乙", 0, 2], ["甲", 2, 4]]);
    expect(buildManhuaSubtitleBurnSrt(receipt.cues)).toContain("00:00:02,000 --> 00:00:04,000");
  });
  it("两版各自带字幕，云草稿→真实Canvas规范化不丢，旧版不套新版", () => {
    const timeline = buildRenderedSubtitleTimeline([{ duration: 8, cues: [{ shotIndex: 1, order: 1, startSec: 0, endSec: 8, textZh: "旧稿原句" }] }], "cut", 8);
    const first = replaceManhuaFinalAssembleVersion({ id: "final-e01" }, { url: "https://test.invalid/old.mp4", jobId: "old-job", subtitleTimeline: timeline });
    const next = replaceManhuaFinalAssembleVersion(first, { url: "https://test.invalid/new.mp4", jobId: "new-job", subtitleTimeline: { ...timeline, cues: [{ ...timeline.cues[0]!, textZh: "新稿" }] } });
    const cloud = sanitizeManhuaCloudDraftBlock({ ...next, kind: "video", x: 0, y: 0, width: 420, height: 360, prompt: "" })!;
    const restored = normalizeCanvasBlock(JSON.parse(JSON.stringify(cloud)));
    expect(findManhuaFinalVideoVersionIdentity(restored, "https://test.invalid/old.mp4")?.subtitleTimeline?.cues[0]?.textZh).toBe("旧稿原句");
    expect(findManhuaFinalVideoVersionIdentity(restored, "https://test.invalid/new.mp4")?.subtitleTimeline?.cues[0]?.textZh).toBe("新稿");
    expect(findManhuaFinalVideoVersionIdentity(replaceManhuaFinalAssembleVersion({ id: "final-e01" }, "https://test.invalid/legacy.mp4"), "https://test.invalid/legacy.mp4")?.subtitleTimeline).toBeUndefined();
  });
  it("坏回执整份拒绝，不截断合法历史字幕条数", () => {
    const timeline = buildRenderedSubtitleTimeline([{ duration: 1, cues: Array.from({ length: 25 }, (_, i) => ({ shotIndex: i + 1, order: i + 1, startSec: 0, endSec: 1, textZh: `字幕${i}` })) }], "cut", 1);
    expect(normalizeManhuaRenderedSubtitle(timeline)?.cues).toHaveLength(25);
    expect(normalizeManhuaRenderedSubtitle({ ...timeline, durationSec: 0.5 })).toBeUndefined();
  });
});
