import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canvasAudioCueInputKey, createCanvasAudioCue, type CanvasAudioCue, type CanvasAudioTake } from "@shared/canvasAudioStudio";
import { buildPremixTimelineClips, isPremixPendingKey, PREMIX_BGM_VOLUME } from "./manhuaPremixMaster";

function cueWithTake(kind: "dialogue" | "bgm", id: string, startSec: number, endSec: number, durationSec: number): CanvasAudioCue {
  const cue: CanvasAudioCue = { ...createCanvasAudioCue(kind, id), speakerZh: "阿菁", voice: "v", textZh: "别怕", shotZh: "近景", startSec, endSec, approved: true, selectedTakeId: `${id}-take` };
  const take: CanvasAudioTake = { id: `${id}-take`, gcsUri: `gs://b/post-prod/1/${id}.wav`, previewUrl: "", durationSec, createdAt: "2026-09-10", inputKey: canvasAudioCueInputKey(cue) };
  return { ...cue, takes: [take] };
}
const getSelectedTake = (cue: CanvasAudioCue) => cue.takes.find((t) => t.id === cue.selectedTakeId);

describe("一键预混母轨 · 时间轴片段", () => {
  it("对白原音量、配乐压 0.25 带淡入淡出；未确认/禁用的不进轨", () => {
    const cues = [
      cueWithTake("dialogue", "d1", 1.5, 4, 2.2),
      cueWithTake("bgm", "b1", 0, 13, 12.5),
      { ...cueWithTake("dialogue", "d2", 5, 8, 2), approved: false },
      { ...cueWithTake("dialogue", "d3", 9, 12, 2), enabled: false },
    ];
    const clips = buildPremixTimelineClips({ cues, durationSec: 30, getSelectedTake, inputKeyOf: canvasAudioCueInputKey });
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ audioUri: "gs://b/post-prod/1/d1.wav", startSec: 1.5, volume: 1, fadeInSec: 0, fadeOutSec: 0, sourceEndSec: 2.2 });
    expect(clips[1]).toMatchObject({ audioUri: "gs://b/post-prod/1/b1.wav", startSec: 0, volume: PREMIX_BGM_VOLUME, fadeInSec: 0.7, fadeOutSec: 1.2 });
  });
  it("短配乐的淡入淡出各封顶到片长三分之一，不会被服务端拒", () => {
    const cues = [cueWithTake("dialogue", "d1", 0, 3, 2), cueWithTake("bgm", "b1", 3, 5, 1.5)];
    const [, bgm] = buildPremixTimelineClips({ cues, durationSec: 30, getSelectedTake, inputKeyOf: canvasAudioCueInputKey });
    expect(bgm!.fadeInSec + bgm!.fadeOutSec).toBeLessThanOrEqual(1.5);
    expect(bgm!.fadeInSec).toBe(0.5);
  });
  it("没有对白、秒窗越界、内容改过、音频长于秒窗都报中文错", () => {
    expect(() => buildPremixTimelineClips({ cues: [cueWithTake("bgm", "b", 0, 10, 8)], durationSec: 30, getSelectedTake, inputKeyOf: canvasAudioCueInputKey })).toThrow(/至少一句对白/);
    expect(() => buildPremixTimelineClips({ cues: [cueWithTake("dialogue", "d", 28, 33, 2)], durationSec: 30, getSelectedTake, inputKeyOf: canvasAudioCueInputKey })).toThrow(/秒窗超出/);
    const edited = { ...cueWithTake("dialogue", "d", 0, 3, 2), textZh: "改了" };
    expect(() => buildPremixTimelineClips({ cues: [edited], durationSec: 30, getSelectedTake, inputKeyOf: canvasAudioCueInputKey })).toThrow(/重新试听/);
    expect(() => buildPremixTimelineClips({ cues: [cueWithTake("dialogue", "d", 0, 1, 2)], durationSec: 30, getSelectedTake, inputKeyOf: canvasAudioCueInputKey })).toThrow(/长于秒窗/);
  });
  it("预混任务用 premix: 前缀区分，不当合听预览", () => {
    expect(isPremixPendingKey("premix:sha256:abc")).toBe(true);
    expect(isPremixPendingKey("sha256:abc")).toBe(false);
  });
  it("接线：配音间按钮→OmniCanvas 挂 master；上传进度从 XHR 一路到成片坞", () => {
    const studio = readFileSync(new URL("../components/canvas/CanvasAudioStudio.tsx", import.meta.url), "utf8");
    expect(studio).toContain("buildPremixTimelineClips({");
    expect(studio).toContain("isPremixPendingKey(pending.inputKey)");
    expect(studio).toContain("onMasterTrackReady?.({");
    const wb = readFileSync(new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url), "utf8");
    expect(wb).toContain('onSetClipSegmentReference(activeClip.id, "master", entry)');
    const omni = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
    expect(omni).toContain("onSetClipSegmentReference={(clipId, slot, entry) => {");
    expect(omni).toContain("onProgress: (fraction) => setSegmentRefProgress(fraction)");
    expect(omni).toContain("segmentRefProgress={segmentRefProgress}");
    const api = readFileSync(new URL("./omniCanvasApi.ts", import.meta.url), "utf8");
    expect(api).toContain("xhr.upload.onprogress");
    const dock = readFileSync(new URL("../components/canvas/ManhuaClipDock.tsx", import.meta.url), "utf8");
    expect(dock).toContain("`上传 ${Math.round(segmentRefProgress * 100)}%`");
  });
});
