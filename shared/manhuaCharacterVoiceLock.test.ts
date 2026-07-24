import { describe, expect, it } from "vitest";
import {
  collectManhuaCharacterTagsFromPrompt,
  evaluateManhuaCrossSegmentVoiceGate,
  listManhuaSpeakingTagsInPrompt,
  normalizeManhuaCharacterVoiceLocks,
  pickManhuaVoiceAudioUrlsForPrompt,
  planManhuaVoiceAudioForPrompt,
  resolveManhuaVoiceExtractWindow,
} from "./manhuaCharacterVoiceLock";

const samplePrompt = `
【视频生成导戏单·第1段·一轮】
本段一条成片约 12 秒
分镜1｜近景｜4秒｜约0–4s｜切镜：开场建立
  说话人锁：@角色1
  对白（引擎自带有声+口型同步，人物锁+表情一体）：@角色1（冷｜微眯｜压嗓）：「站住。」
分镜2｜中景｜4秒｜约4–8s｜切镜：承接
  说话人锁：@角色2
  对白：@角色2（急｜眉心｜短促）：「别冲动！」
分镜3｜近景｜4秒｜约8–12s｜切镜：承接
  说话人锁：@角色3
  对白：@角色3（稳｜沉｜低）：「听我说完。」
`;

describe("manhuaCharacterVoiceLock", () => {
  it("normalizes and keeps latest lock per @角色", () => {
    const locks = normalizeManhuaCharacterVoiceLocks([
      {
        id: "a",
        characterTag: "@角色1",
        labelZh: "旧",
        audioUrl: "https://cdn.example/old.mp3",
        createdAt: 1,
      },
      {
        id: "b",
        characterTag: "@角色1",
        labelZh: "新",
        audioUrl: "https://cdn.example/new.mp3",
        createdAt: 2,
      },
      {
        id: "c",
        characterTag: "@角色2",
        labelZh: "乙",
        audioUrl: "https://cdn.example/b.mp3",
        createdAt: 3,
      },
      { characterTag: "坏", audioUrl: "https://cdn.example/x.mp3" },
      { characterTag: "@角色3", audioUrl: "http://insecure.example/x.mp3" },
    ]);
    expect(locks).toHaveLength(2);
    expect(locks.find((l) => l.characterTag === "@角色1")?.audioUrl).toContain(
      "new.mp3",
    );
  });

  it("resolves extract window from director cue seconds", () => {
    const win = resolveManhuaVoiceExtractWindow(samplePrompt, "@角色2");
    expect(win.source).toBe("cue");
    expect(win.startSec).toBe(4);
    expect(win.durationSec).toBe(4);
  });

  it("ranks multi-cast voices by dialogue weight and caps at 3", () => {
    const locks = normalizeManhuaCharacterVoiceLocks([
      {
        characterTag: "@角色1",
        labelZh: "甲",
        audioUrl: "https://cdn.example/a.mp3",
      },
      {
        characterTag: "@角色2",
        labelZh: "乙",
        audioUrl: "https://cdn.example/b.mp3",
      },
      {
        characterTag: "@角色3",
        labelZh: "丙",
        audioUrl: "https://cdn.example/c.mp3",
      },
      {
        characterTag: "@角色4",
        labelZh: "丁",
        audioUrl: "https://cdn.example/d.mp3",
      },
    ]);
    // 4 人有对白权重时只挂 3；无对白的 @角色4 即使有锁也不抢位（本段未出场说话）
    const longPrompt = `${samplePrompt}
分镜4｜近景｜3秒｜约12–15s｜切镜：承接
  说话人锁：@角色4
  对白：@角色4（平）：「我来。」
`;
    const plan = planManhuaVoiceAudioForPrompt(longPrompt, locks, { limit: 3 });
    expect(plan.audioUrls).toHaveLength(3);
    expect(plan.attached.map((a) => a.characterTag)).toEqual([
      "@角色1",
      "@角色2",
      "@角色3",
    ]);
    expect(plan.deferredTags).toContain("@角色4");
    expect(pickManhuaVoiceAudioUrlsForPrompt(longPrompt, locks)).toEqual(
      plan.audioUrls,
    );
    expect(collectManhuaCharacterTagsFromPrompt(longPrompt)).toContain("@角色4");
  });

  it("cross-segment voice gate: missing lock is soft tip, never blocks", () => {
    const seg1 =
      "【第1段·15s】客栈\n0–7.5s：@角色1，抬手，说「站住」。近景。\n7.5–15s：@角色2，后退，说「别冲动」。中景。";
    const seg2 =
      "【第2段·15s】客栈\n0–15s：@角色1，逼近，说「跟我走」。近景。";
    expect(listManhuaSpeakingTagsInPrompt(seg2)).toContain("@角色1");
    const miss = evaluateManhuaCrossSegmentVoiceGate({
      localSegmentIndex: 2,
      currentPrompt: seg2,
      episodeSegmentPrompts: [
        { localSegmentIndex: 1, prompt: seg1 },
        { localSegmentIndex: 2, prompt: seg2 },
      ],
      voiceLocks: [],
    });
    expect(miss.ok).toBe(true);
    expect(miss.missingTags).toContain("@角色1");
    expect(miss.messageZh).toMatch(/不挡出片|可选/);

    const ok = evaluateManhuaCrossSegmentVoiceGate({
      localSegmentIndex: 2,
      currentPrompt: seg2,
      episodeSegmentPrompts: [
        { localSegmentIndex: 1, prompt: seg1 },
        { localSegmentIndex: 2, prompt: seg2 },
      ],
      voiceLocks: [
        {
          id: "v1",
          characterTag: "@角色1",
          labelZh: "甲",
          audioUrl: "https://cdn.example/a.mp3",
          createdAt: 1,
        },
      ],
    });
    expect(ok.ok).toBe(true);
    expect(ok.missingTags).toEqual([]);
  });

  it("cross-segment voice gate: first appearance in episode is not required", () => {
    const seg1 =
      "【第1段·15s】客栈\n0–15s：@角色1，抬头，说「你好」。近景。";
    const gate = evaluateManhuaCrossSegmentVoiceGate({
      localSegmentIndex: 1,
      currentPrompt: seg1,
      episodeSegmentPrompts: [{ localSegmentIndex: 1, prompt: seg1 }],
      voiceLocks: [],
    });
    expect(gate.ok).toBe(true);
    expect(gate.requiredTags).toEqual([]);
  });
});
