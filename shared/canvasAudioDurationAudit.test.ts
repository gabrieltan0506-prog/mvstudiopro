import { describe, expect, it } from "vitest";
import { resolveManhuaClipDisplayDurationSec } from "./manhuaScriptWorkbench.js";
import { auditCanvasAudioDuration } from "./canvasAudioDurationAudit.js";
import { canvasAudioCueInputKey, createCanvasAudioCue, type CanvasAudioCue } from "./canvasAudioStudio.js";

function adopted(kind: CanvasAudioCue["kind"], id: string, startSec: number, endSec: number, takeSec: number): CanvasAudioCue {
  const cue = createCanvasAudioCue(kind, id);
  cue.startSec = startSec; cue.endSec = endSec;
  cue.speakerZh = kind === "dialogue" ? id : "";
  cue.source = kind === "dialogue" ? undefined : { gcsUri: `gs://test/${id}`, previewUrl: "", durationSec: 30, labelZh: id };
  cue.sourceStartSec = 0; cue.sourceEndSec = takeSec;
  cue.takes = [{ id: `${id}-take`, gcsUri: `gs://test/${id}-take`, previewUrl: "", durationSec: takeSec, createdAt: "test", inputKey: canvasAudioCueInputKey(cue) }];
  cue.selectedTakeId = `${id}-take`; cue.approved = true;
  return cue;
}

describe("声音时长体检", () => {
  it("统计对白超窗和配乐覆盖并合并重叠区间，不把留白当失败", () => {
    const rows = [adopted("dialogue", "阿菁", 0, 3, 3.5), adopted("dialogue", "娘", 4, 6, 1.8),
      adopted("bgm", "主配乐", 0, 6, 6), adopted("bgm", "尾配乐", 5, 9, 4)];
    const result = auditCanvasAudioDuration(rows, 10);
    expect(result.dialogueReadyCount).toBe(1);
    expect(result.issuesZh).toContain("阿菁：配音 3.50 秒，比秒窗长 0.50 秒");
    expect(result.bgmCoveredSec).toBe(9);
    expect(result.bgmUncoveredSec).toBe(1);
  });
  it("旧候选、未采用和超出片段的配乐不计为有效覆盖", () => {
    const stale = adopted("dialogue", "曹三", 0, 2, 1.5);
    stale.textZh = "新台词";
    const unapproved = adopted("bgm", "旧配乐", 0, 5, 5); unapproved.approved = false;
    const outside = adopted("bgm", "越界配乐", 8, 12, 4);
    const result = auditCanvasAudioDuration([stale, unapproved, outside], 10);
    expect(result.dialogueReadyCount).toBe(0);
    expect(result.bgmCoveredSec).toBe(0);
    expect(result.bgmUncoveredSec).toBe(10);
    expect(result.issuesZh).toHaveLength(3);
  });
  it("没有真实原曲绑定的配乐不计入覆盖", () => {
    const cue = adopted("bgm", "无原曲", 0, 5, 5);
    cue.source = undefined;
    cue.takes[0]!.inputKey = canvasAudioCueInputKey(cue);
    expect(auditCanvasAudioDuration([cue], 10)).toMatchObject({ bgmCoveredSec: 0, bgmUncoveredSec: 10 });
  });
});


it("第四段24秒容纳原声至23.4秒，保持娘身份、音轨ID与原速", () => {
 const rows = [adopted("dialogue", "先生", 0, 6.216, 6.216), adopted("dialogue", "娘", 6.216, 9.312, 3.096),
  adopted("dialogue", "先生后句", 9.312, 13.2, 3.888), adopted("dialogue", "阿菁", 13.2, 17.184, 3.984),
  adopted("dialogue", "墨屠", 17.184, 23.4, 6.216)];
 const before = JSON.stringify(rows);
 expect(auditCanvasAudioDuration(rows, 23).issuesZh).toContain("墨屠：对白秒窗超出本段或起止时间无效");
 expect(auditCanvasAudioDuration(rows, resolveManhuaClipDisplayDurationSec("【第4段·24s】", 23))).toMatchObject({dialogueReadyCount:5,issuesZh:[]});
 expect(JSON.stringify(rows)).toBe(before);
});
