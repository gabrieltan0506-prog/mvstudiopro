import { describe, expect, it } from "vitest";
import { buildManhuaAutoSegmentBinding, normalizeManhuaAutoSegmentBinding } from "./manhuaAutoSegment";
import { groupShotsIntoSegments, formatWorkbenchSegmentClipInjectBlock, resolveSegmentIndexesFromShotIndex, shotIndexesForSegment } from "./manhuaScriptWorkbench";
import { resolvePreviousSegmentClipUrl } from "./manhuaClipContinuity";
import { confirmManhuaSegmentLookBindingSource, getManhuaSegmentLookBinding, getManhuaSegmentLookSourceRevision, setManhuaSegmentLookBinding, normalizeManhuaSegmentLookBindings } from "./manhuaCharacterLookSets";

describe("自动分段身份与连续窗口", () => {
  it("长镜保留原身份、完整时间和一次对白；提示词标明连续窗口", () => {
    const source = [{ index: 101, durationSec: 31, cameraZh: "固定机位", actionZh: "从左侧走到右侧", dialogueZh: "只说一遍" }];
    const original = JSON.stringify(source);
    const segments = groupShotsIntoSegments(source, { videoModel: "gemini-omni-flash" });
    expect(segments).toHaveLength(4);
    expect(segments.at(-1)?.sourceEndSec).toBe(31);
    expect(segments.flatMap(s => s.shots).reduce((n, s) => n + s.durationSec, 0)).toBe(31);
    expect(resolveSegmentIndexesFromShotIndex(101, segments)).toEqual([1, 2, 3, 4]);
    expect(shotIndexesForSegment(4, segments)).toEqual([101]);
    expect(segments.flatMap(s => s.shots).filter(s => s.dialogueZh)).toHaveLength(1);
    const prompt = formatWorkbenchSegmentClipInjectBlock({ segmentIndex: 4, durationSec: segments[3]!.durationSec, shots: segments[3]!.shots });
    expect(prompt).toContain("原镜内23.25–31秒");
    expect(prompt).toContain("非剪辑切镜");
    expect(prompt).not.toContain("只说一遍");
    expect(JSON.stringify(source)).toBe(original);
  });

  it("源尾部内容改变会失效，不截断身份串；造型确认保留全部原串", () => {
    const segments = groupShotsIntoSegments([{ index: 1, durationSec: 5, cameraZh: "固定机位", actionZh: "动作".repeat(2000) }]);
    const binding = buildManhuaAutoSegmentBinding(1, segments[0]!, "seedance-2.0-mini");
    expect(normalizeManhuaAutoSegmentBinding(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
    const selected = setManhuaSegmentLookBinding({ bindings: {}, episodeIndex: 1, segmentIndex: 1, characterId: "hero", lookSetId: "before-transform" });
    expect(getManhuaSegmentLookSourceRevision(selected, 1, 1)).toBeUndefined();
    const confirmed = normalizeManhuaSegmentLookBindings(JSON.parse(JSON.stringify(confirmManhuaSegmentLookBindingSource(selected, 1, 1, binding.revision))));
    expect(getManhuaSegmentLookBinding(confirmed, 1, 1)).toEqual({ hero: "before-transform" });
    expect(getManhuaSegmentLookSourceRevision(confirmed, 1, 1)).toBe(binding.revision);
    segments[0]!.shots[0]!.actionZh += "结尾变更";
    expect(buildManhuaAutoSegmentBinding(1, segments[0]!, "seedance-2.0-mini").revision).not.toBe(binding.revision);
  });

  it("第二集自动第七段读取本集第六段，不误连第一集；旧片归档不消费", () => {
    const clips = [
      { id: "clip-e01-g12-auto-a", episodeIndex: 1, status: "done", outputUrl: "https://test.invalid/ep1.mp4" },
      { id: "clip-e02-g06-auto-b", episodeIndex: 2, status: "done", outputUrl: "https://test.invalid/current.mp4" },
      { id: "clip-e02-g06-auto-c", episodeIndex: 2, status: "done", outputUrl: "https://test.invalid/old.mp4", archivedFromPreviousScript: true },
    ];
    expect(resolvePreviousSegmentClipUrl(clips, 2, 7, { segmentIndexIsLocal: true })).toBe("https://test.invalid/current.mp4");
    expect(resolvePreviousSegmentClipUrl(clips, 2, 1, { segmentIndexIsLocal: true })).toBe("https://test.invalid/ep1.mp4");
  });
});
