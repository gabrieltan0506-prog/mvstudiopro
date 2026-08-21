/**
 * 防废片编译器第一刀测试:装箱守恒/方言分流/三产物/格式层归一与钳制。
 */
import { describe, expect, it } from "vitest";
import { packShotsIntoSegments, type EpisodeIR, type ShotIR } from "./manhuaShotIR";
import {
  applyCensorReplacements,
  formatPromptForEngine,
  normalizeImageRefs,
} from "./promptFormatLayer";
import { buildTtsCueSheet, compileEpisode } from "./manhuaPromptCompiler";

const shot = (index: number, sec: number, over: Partial<ShotIR> = {}): ShotIR => ({
  index,
  durationSec: sec,
  sceneZh: "军械库",
  actionZh: `第${index}镜动作`,
  ...over,
});

const IR: EpisodeIR = {
  episodeIndex: 1,
  genreZh: "古风武侠",
  styleZh: "雨夜冷青色调,烛光侧光,竖屏电影感",
  shots: [
    shot(1, 5, {
      dialogue: { speakerZh: "谢明彰", textZh: "放你可以,向警方自首", emotionZh: "压着怒意" },
      imageRefs: [{ n: 1, roleZh: "谢明彰定妆·锁脸" }],
    }),
    shot(2, 4, { sfxZh: "雨打伞棚" }),
    shot(3, 6, { dialogue: { speakerZh: "库吏", textZh: "我认罪" } }),
    shot(4, 5),
    shot(5, 5),
    shot(6, 5),
  ],
};

describe("镜→段装箱(镜数守恒)", () => {
  it("同一 IR:30s 引擎装成 1 段,15s 引擎装成 2 段,镜总数不变", () => {
    const seg30 = packShotsIntoSegments(IR.shots, 30);
    const seg15 = packShotsIntoSegments(IR.shots, 15);
    expect(seg30).toHaveLength(1);
    expect(seg15).toHaveLength(2);
    expect(seg30.flatMap((s) => s.shots)).toHaveLength(6);
    expect(seg15.flatMap((s) => s.shots)).toHaveLength(6);
    // 15s 箱:5+4+6=15 / 5+5+5=15
    expect(seg15.map((s) => s.durationSec)).toEqual([15, 15]);
  });

  it("单镜超上限被钳到上限,不丢镜", () => {
    const segs = packShotsIntoSegments([shot(1, 40)], 15);
    expect(segs).toHaveLength(1);
    expect(segs[0].shots[0].durationSec).toBe(15);
  });
});

describe("方言分流", () => {
  it("Seedance 段提示词带 {}对白/<>音效/@图N/段头【】与铁令段", () => {
    const out = compileEpisode(IR, "seedance-2.5");
    expect(out.segments).toHaveLength(1);
    const p = out.segmentPrompts[0];
    expect(p).toContain("{放你可以,向警方自首}");
    expect(p).toContain("<雨打伞棚>");
    expect(p).toContain("@图1 定义谢明彰定妆·锁脸");
    expect(p).toContain("【第01段·30s】");
    expect(p).toContain("毛孔");
    expect(p).toContain("零文字零水印");
  });

  it("H3 段提示词无四标记,用 Image N 与自然语言台词", () => {
    const out = compileEpisode(IR, "minimax-h3");
    expect(out.segments).toHaveLength(2);
    const p = out.segmentPrompts[0];
    expect(p).not.toMatch(/[{}<>【】]/);
    expect(p).toContain("Image 1");
    expect(p).toContain("“放你可以,向警方自首”");
  });
});

describe("三产物", () => {
  it("TTS 台词表秒位=镜前时长和,情绪进 instruction", () => {
    const cues = buildTtsCueSheet(packShotsIntoSegments(IR.shots, 30));
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startSec: 0, speakerZh: "谢明彰", instructionZh: "压着怒意" });
    expect(cues[1]).toMatchObject({ startSec: 9, speakerZh: "库吏" });
  });

  it("BGM brief:题材查表出国风 style,纯音乐口径,总时长=段和+10 余量", () => {
    const out = compileEpisode(IR, "seedance-2.5");
    expect(out.bgmBrief.styleTags).toContain("guzheng");
    expect(out.bgmBrief.negativeTags).toContain("vocals");
    expect(out.bgmBrief.suno.instrumental).toBe(true);
    expect(out.bgmBrief.suno.durationSec).toBe(40);
    expect(out.bgmBrief.segments[0].moodZh).toBe("衬底不压对白");
  });
});

describe("格式层", () => {
  it("图引用归一:图一/图 2/[图3] → @图N", () => {
    expect(normalizeImageRefs("图一的脸,按图 2 的光,[图3]构图")).toBe(
      "@图1的脸,按@图2 的光,@图3构图",
    );
  });

  it("避审替换与中文引号台词转 {}", () => {
    const r = formatPromptForEngine("「他要开枪了」子弹时间放慢", "seedance-2.5");
    expect(r.text).toContain("{他要武器击发了}");
    expect(r.text).toContain("极慢速凝滞瞬间");
    expect(r.issues.some((i) => i.kind === "censor")).toBe(true);
  });

  it("H3 方向:{}回转引号,@图N→Image N,时长超限钳制并出提示", () => {
    const r = formatPromptForEngine("{我认罪} @图2 出场", "minimax-h3", { durationSec: 30 });
    expect(r.text).toContain("“我认罪”");
    expect(r.text).toContain("Image 2");
    expect(r.clampedDurationSec).toBe(15);
    expect(r.issues.some((i) => i.kind === "duration")).toBe(true);
  });

  it("避审替换纯函数可单独调用", () => {
    expect(applyCensorReplacements("杀了他").text).toBe("制服他");
  });
});
