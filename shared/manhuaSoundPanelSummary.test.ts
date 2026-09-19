import { createCanvasAudioCue, canvasAudioCueInputKey } from "./canvasAudioStudio";
import { describe, expect, it } from "vitest";
import { buildManhuaSoundPanelSummary, hasAdoptedManhuaAudio } from "./manhuaSoundPanelSummary";

const adopted = (kind: "dialogue" | "bgm") => {
  const cue = createCanvasAudioCue(kind, kind);
  cue.approved = true;
  cue.selectedTakeId = "take-1";
  cue.takes = [{ id: "take-1", gcsUri: `gs://test-only/${kind}.wav`, previewUrl: "", durationSec: 2, createdAt: "test", inputKey: canvasAudioCueInputKey(cue) }];
  return cue;
};

const dialogue = (speakerZh: string, selectedTakeId?: string) => ({
  kind: "dialogue",
  speakerZh,
  textZh: "别怕，站我身后。",
  ...(selectedTakeId ? { selectedTakeId } : {}),
});

describe("对白与配乐面板摘要", () => {
  it("角色配音按去重说话人计，不按条数；标题带段号与时长", () => {
    const out = buildManhuaSoundPanelSummary({
      segmentIndex: 1,
      durationSec: 15,
      cues: [dialogue("阿菁"), dialogue("阿菁"), dialogue("掌柜"), { kind: "bgm" }],
    });
    expect(out.dialogueCount).toBe(3);
    expect(out.speakerCount).toBe(2);
    expect(out.speakersZh).toEqual(["阿菁", "掌柜"]);
    expect(out.headlineZh).toBe("第1段 · 00:15 · 角色配音 2 · 背景音乐 1");
  });

  it("混合轨不伪装多轨：只有预混母轨时明说不是多轨", () => {
    const premix = buildManhuaSoundPanelSummary({
      segmentIndex: 2,
      durationSec: 10,
      cues: [dialogue("阿菁")],
      hasPremixMaster: true,
    });
    expect(premix.hasRealMultitrack).toBe(false);
    expect(premix.trackNoteZh).toContain("不是多轨");
    // 反例对照：对白已采用 + 有配乐，才算真多轨
    const real = buildManhuaSoundPanelSummary({
      segmentIndex: 2,
      durationSec: 10,
      cues: [adopted("dialogue"), adopted("bgm")],
      musicJobCount: 1,
      hasPremixMaster: true,
    });
    expect(real.hasRealMultitrack).toBe(true);
    expect(real.trackNoteZh).toContain("各自成轨");
  });

  it("对白只写了字、还没选采用版本时不算多轨（有稿≠有轨）", () => {
    const out = buildManhuaSoundPanelSummary({
      segmentIndex: 1,
      durationSec: 15,
      cues: [dialogue("阿菁")],
      musicJobCount: 2,
    });
    expect(out.adoptedCount).toBe(0);
    expect(out.hasRealMultitrack).toBe(false);
  });

  it("配乐数 = bgm cue + 已提交配乐任务；音效单独计，没有就不出现在标题里", () => {
    const out = buildManhuaSoundPanelSummary({
      segmentIndex: 3,
      durationSec: 20,
      cues: [{ kind: "bgm" }, { kind: "sfx" }],
      musicJobCount: 2,
    });
    expect(out.bgmCount).toBe(3);
    expect(out.sfxCount).toBe(1);
    expect(out.headlineZh).toContain("音效 1");
    const noSfx = buildManhuaSoundPanelSummary({ segmentIndex: 3, durationSec: 20, cues: [{ kind: "bgm" }] });
    expect(noSfx.headlineZh).not.toContain("音效");
  });

  it("空态如实说这一段还没有声音任务，不显示 0 轨伪装成有内容", () => {
    const out = buildManhuaSoundPanelSummary({ segmentIndex: 1, durationSec: 15, cues: [] });
    expect(out.emptyZh).toContain("还没有任何声音任务");
    expect(out.hasRealMultitrack).toBe(false);
    expect(out.trackNoteZh).toBe("");
  });
});

 it("任务ID和孤立采用ID不能冒充音轨，旧输入和禁用候选也不计", () => {
  const pending = buildManhuaSoundPanelSummary({ segmentIndex: 1, durationSec: 15, cues: [dialogue("阿菁", "missing")], musicJobCount: 1 });
  expect(pending.hasRealMultitrack).toBe(false);
  expect(pending.adoptedCount).toBe(0);
  const cue = adopted("dialogue");
  expect(hasAdoptedManhuaAudio(cue)).toBe(true);
  expect(hasAdoptedManhuaAudio({ ...cue, enabled: false })).toBe(false);
  expect(hasAdoptedManhuaAudio({ ...cue, textZh: "改稿" })).toBe(false);
 });
