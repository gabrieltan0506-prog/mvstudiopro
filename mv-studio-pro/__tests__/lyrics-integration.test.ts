import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const galleryPath = path.join(__dirname, "..", "app", "mv-gallery.tsx");
const galleryContent = fs.readFileSync(galleryPath, "utf-8");

describe("Lyrics Integration", () => {
  it("MVItem type includes lyrics field", () => {
    expect(galleryContent).toContain("lyrics: string[]");
  });

  it("defines LYRICS_VERSE1 with real lyrics", () => {
    expect(galleryContent).toContain("LYRICS_VERSE1");
    expect(galleryContent).toContain("落叶轻轻飘落");
    expect(galleryContent).toContain("windows' corner");
  });

  it("defines LYRICS_PRECHORUS with real lyrics", () => {
    expect(galleryContent).toContain("LYRICS_PRECHORUS");
    expect(galleryContent).toContain("谁说女人就该 wait and stay");
    expect(galleryContent).toContain("谁说我的幸福 要别人给的");
  });

  it("defines LYRICS_CHORUS1 with real lyrics", () => {
    expect(galleryContent).toContain("LYRICS_CHORUS1");
    expect(galleryContent).toContain("这是意想爱 unexpected love");
    expect(galleryContent).toContain("像春风吹开 冰封已久的情怀");
    expect(galleryContent).toContain("让我终于敢 去爱一场");
  });

  it("defines LYRICS_VERSE2 with real lyrics", () => {
    expect(galleryContent).toContain("LYRICS_VERSE2");
    expect(galleryContent).toContain("曾经以为爱 是一种负担");
    expect(galleryContent).toContain("真正的爱 make me unafraid");
  });

  it("defines LYRICS_BRIDGE with real lyrics", () => {
    expect(galleryContent).toContain("LYRICS_BRIDGE");
    expect(galleryContent).toContain("也曾经受伤 也曾经徬徨");
    expect(galleryContent).toContain("因为这份爱 it's my choice");
  });

  it("defines LYRICS_FINAL with real lyrics", () => {
    expect(galleryContent).toContain("LYRICS_FINAL");
    expect(galleryContent).toContain("是我最美的答案");
    expect(galleryContent).toContain("it's my destiny");
  });

  it("defines LYRICS_OUTRO with real lyrics", () => {
    expect(galleryContent).toContain("LYRICS_OUTRO");
    expect(galleryContent).toContain("意想爱 意想爱");
    expect(galleryContent).toContain("终于明白 Love is brave");
  });

  it("all 7 MVs have lyrics arrays assigned", () => {
    // Check each MV has a lyrics field
    const lyricsAssignments = galleryContent.match(/lyrics:\s*\[\.\.\.LYRICS_/g);
    expect(lyricsAssignments).not.toBeNull();
    expect(lyricsAssignments!.length).toBe(7);
  });

  it("YWQS MVs (4) have lyrics from different song sections", () => {
    // ywqs_mv1: CHORUS1 + VERSE1
    expect(galleryContent).toContain("lyrics: [...LYRICS_CHORUS1, ...LYRICS_VERSE1.slice(0, 4)]");
    // ywqs_mv2: VERSE2 + PRECHORUS + CHORUS1
    expect(galleryContent).toContain("lyrics: [...LYRICS_VERSE2, ...LYRICS_PRECHORUS, ...LYRICS_CHORUS1.slice(0, 2)]");
    // ywqs_mv3: BRIDGE + FINAL
    expect(galleryContent).toContain("lyrics: [...LYRICS_BRIDGE, ...LYRICS_FINAL.slice(0, 4)]");
    // ywqs_mv4: FINAL + OUTRO
    expect(galleryContent).toContain("lyrics: [...LYRICS_FINAL, ...LYRICS_OUTRO.slice(0, 3)]");
  });

  it("YXA MVs (3) have lyrics from different song sections", () => {
    // yxa_mv1: CHORUS1 + PRECHORUS
    expect(galleryContent).toContain("lyrics: [...LYRICS_CHORUS1, ...LYRICS_PRECHORUS]");
    // yxa_mv2: VERSE2 + CHORUS1
    expect(galleryContent).toContain("lyrics: [...LYRICS_VERSE2, ...LYRICS_CHORUS1.slice(0, 6)]");
    // yxa_mv3: BRIDGE + OUTRO
    expect(galleryContent).toContain("lyrics: [...LYRICS_BRIDGE, ...LYRICS_OUTRO]");
  });

  it("renders lyrics section in expanded card view", () => {
    expect(galleryContent).toContain("歌词字幕");
    expect(galleryContent).toContain("lyricsBox");
    expect(galleryContent).toContain("lyricLine");
    expect(galleryContent).toContain("item.lyrics.map");
  });

  it("lyrics badge shows actual lyrics count from array", () => {
    expect(galleryContent).toContain("item.lyrics.length");
    expect(galleryContent).toContain("行歌词字幕");
  });

  it("has lyricsBox and lyricLine styles defined", () => {
    expect(galleryContent).toContain("lyricsBox:");
    expect(galleryContent).toContain("lyricLine:");
  });
});
