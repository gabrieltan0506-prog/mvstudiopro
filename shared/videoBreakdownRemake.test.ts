import { describe, expect, it } from "vitest";
import { formatVideoBreakdownRecreatePrompt } from "./videoBreakdown";
import { videoBreakdownFixture as fixture } from "./videoBreakdown.fixture";
import { VIDEO_BREAKDOWN_REMAKE_CONSTRAINT, VIDEO_BREAKDOWN_REMAKE_SPEECH_CONSTRAINT, formatVideoBreakdownRemakePrompt, remakeVideoBreakdownSegment, videoBreakdownRemakeInputSchema } from "./videoBreakdownRemake";

const section = (text: string, name: string) => {
  const lines = text.split("\n");
  const start = lines.findIndex(line => line.startsWith(`【${name}】`));
  const end = lines.findIndex((line, i) => i > start && line.startsWith("【"));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
};

describe("用这套拍法创作新片", () => {
  const seg = fixture.segments[2];

  it("替换主体与场景，保留镜头序列、摄影机、光色、节奏", () => {
    const original = formatVideoBreakdownRecreatePrompt(seg);
    const remade = formatVideoBreakdownRemakePrompt(seg, { subject: "穿红雨衣的小女孩", scene: "夜晚霓虹街头" });
    expect(section(remade, "主体一致性")).toBe("【主体一致性】穿红雨衣的小女孩");
    expect(section(remade, "场景与美术")).toBe("【场景与美术】夜晚霓虹街头");
    for (const name of ["镜头序列", "摄影机与构图", "光色与材质", "节奏与声音"]) expect(section(remade, name)).toBe(section(original, name));
    expect(section(remade, "生成约束")).toBe(`【生成约束】${seg.recreatePrompt.constraints}；${VIDEO_BREAKDOWN_REMAKE_CONSTRAINT}`);
  });

  it("场景留空沿用原片场景；输入去首尾空白", () => {
    const remade = remakeVideoBreakdownSegment(seg, { subject: "  一只橘猫  ", scene: "   " });
    expect(remade.recreatePrompt.subject).toBe("一只橘猫");
    expect(remade.recreatePrompt.scene).toBe(seg.recreatePrompt.scene);
    expect(remade.shots).toBe(seg.shots);
    expect(seg.recreatePrompt.subject).toBe("同一只成年恐龙，琥珀色眼睛");
  });

  it("新主体必填且限长", () => {
    expect(() => remakeVideoBreakdownSegment(seg, { subject: "  " })).toThrow("请用一句话写新主体");
    expect(videoBreakdownRemakeInputSchema.safeParse({ subject: "a".repeat(301) }).success).toBe(false);
    expect(videoBreakdownRemakeInputSchema.safeParse({ subject: "x", scene: "b".repeat(301) }).success).toBe(false);
  });

  it("口播片做新片：不照抄原话，保留字幕花字与口播节奏，约束里写明台词换成自己的话；不改原段", () => {
    const talking = { ...seg, speech: { transcript: "别再这样洗脸了", onScreenText: "黄底大字弹出", delivery: "语速快，重音在开头" } };
    const recreated = formatVideoBreakdownRecreatePrompt(talking);
    expect(recreated).toContain("【台词 / 口播】别再这样洗脸了");
    const remade = formatVideoBreakdownRemakePrompt(talking, { subject: "健身教练" });
    expect(remade).not.toContain("别再这样洗脸了");
    expect(remade).toContain("【字幕花字】黄底大字弹出");
    expect(remade).toContain("【口播节奏】语速快，重音在开头");
    expect(section(remade, "生成约束")).toContain(VIDEO_BREAKDOWN_REMAKE_SPEECH_CONSTRAINT);
    expect(talking.speech.transcript).toBe("别再这样洗脸了");
    // 只有原话的段：speech 整块去掉
    expect(remakeVideoBreakdownSegment({ ...seg, speech: { transcript: "只有原话" } }, { subject: "x" }).speech).toBeUndefined();
  });
});
