import { describe, expect, it } from "vitest";
import {
  formatManhuaAudioReferenceLockBlock,
  normalizeManhuaAudioReferenceLock,
  resolveManhuaAccentAudioUrl,
} from "./manhuaAudioReferenceLock.js";

describe("manhuaAudioReferenceLock · 软参考·可选", () => {
  it("四项全空 → null（视为未设置）", () => {
    expect(normalizeManhuaAudioReferenceLock(null)).toBeNull();
    expect(normalizeManhuaAudioReferenceLock({})).toBeNull();
    expect(
      normalizeManhuaAudioReferenceLock({ bgmUrl: "  ", accentNoteZh: "" }),
    ).toBeNull();
  });

  it("只认 https 音频；非法 URL 丢弃但保留说明", () => {
    const lock = normalizeManhuaAudioReferenceLock({
      bgmUrl: "http://insecure.example/bgm.mp3",
      bgmNoteZh: "古风弦乐·紧张推进",
      accentUrl: "https://cdn.example.com/accent.mp3",
      accentNoteZh: "北方官话·沉稳",
    });
    expect(lock).not.toBeNull();
    expect(lock?.bgmUrl).toBeUndefined();
    expect(lock?.bgmNoteZh).toBe("古风弦乐·紧张推进");
    expect(lock?.accentUrl).toBe("https://cdn.example.com/accent.mp3");
    expect(lock?.accentNoteZh).toBe("北方官话·沉稳");
    expect(lock?.updatedAt).toBeGreaterThan(0);
  });

  it("口音基准音频供兜底 audio_url；无则 undefined", () => {
    expect(
      resolveManhuaAccentAudioUrl({
        accentUrl: "https://cdn.example.com/accent.mp3",
        updatedAt: 1,
      }),
    ).toBe("https://cdn.example.com/accent.mp3");
    expect(resolveManhuaAccentAudioUrl(null)).toBeUndefined();
    expect(
      resolveManhuaAccentAudioUrl({ accentNoteZh: "只有文字", updatedAt: 1 }),
    ).toBeUndefined();
  });

  it("prompt 文本区块：软口径、不挡出片；空锁返回空串", () => {
    expect(formatManhuaAudioReferenceLockBlock(null)).toBe("");
    expect(
      formatManhuaAudioReferenceLockBlock({ updatedAt: 1 }),
    ).toBe("");
    const block = formatManhuaAudioReferenceLockBlock({
      bgmNoteZh: "古风弦乐·紧张推进",
      accentUrl: "https://cdn.example.com/accent.mp3",
      accentNoteZh: "北方官话·沉稳",
      updatedAt: 1,
    });
    expect(block).toContain("参考音频·全集参考（软·可选）");
    expect(block).toContain("BGM 参考");
    expect(block).toContain("古风弦乐·紧张推进");
    expect(block).toContain("对白口音基准已挂");
    expect(block).toContain("北方官话·沉稳");
    // 软参考：不得出现硬门禁字眼
    expect(block).toContain("不挡出片");
    expect(block).not.toContain("禁止出片");
  });
});
