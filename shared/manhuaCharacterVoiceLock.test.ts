import { describe, expect, it } from "vitest";
import {
  collectManhuaCharacterTagsFromPrompt,
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
});
