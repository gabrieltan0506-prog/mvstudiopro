import { describe, expect, it } from "vitest";
import {
  collectManhuaCharacterTagsFromPrompt,
  normalizeManhuaCharacterVoiceLocks,
  pickManhuaVoiceAudioUrlsForPrompt,
} from "./manhuaCharacterVoiceLock";

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

  it("picks audio urls by prompt character tags (max 3)", () => {
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
    const prompt = "【对白】@角色2 说… @角色4 答… @角色1 插话";
    expect(collectManhuaCharacterTagsFromPrompt(prompt)).toEqual([
      "@角色1",
      "@角色2",
      "@角色4",
    ]);
    expect(pickManhuaVoiceAudioUrlsForPrompt(prompt, locks)).toEqual([
      "https://cdn.example/a.mp3",
      "https://cdn.example/b.mp3",
      "https://cdn.example/d.mp3",
    ]);
  });
});
