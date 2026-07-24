import { describe, expect, it } from "vitest";
import {
  isManhuaClipPromptLegacyFat,
  stripManhuaClipForbiddenBoards,
} from "./manhuaClipPromptSanitize";

describe("manhuaClipPromptSanitize", () => {
  it("detects legacy fat clip prompts", () => {
    expect(
      isManhuaClipPromptLegacyFat("【节拍防火墙】\n当前只拍第 1 段"),
    ).toBe(true);
    expect(
      isManhuaClipPromptLegacyFat(
        "【第1段·15s】雨夜\n0–15s：@角色1，拔刀，说「站住」。近景。",
      ),
    ).toBe(false);
  });

  it("strips ancient boards and director walls; keeps slim timeline + Image bind", () => {
    const fat = [
      "有参考图时写完整视频导戏单（一轮约 15 秒）",
      "【节拍防火墙】",
      "当前只拍第 1 段",
      "【第 1 段·成片】",
      "目标时长：约 15 秒",
      "【视频生成导戏单·第1段·一轮】",
      "分镜1｜中远景",
      "【按秒导戏单·第01段·15s】",
      "0–5s｜起幅｜全景",
      "【成片有声与导戏硬锁】",
      "1. 有声：有对白",
      "【跨镜连续硬锁·防崩】",
      "1. 脸：五官",
      "【成片预演硬锁】",
      "1. 形象连续",
      "【古风服化参考】",
      "1. 【古风原型·设计板】雨夜江湖刀客（arch_rain_jianghu_dao）",
      "【身份与时代·跟剧本】",
      "- 严格遵循",
      "【第1段·15s】雨夜桥板",
      "0–15s：@角色1，踩灭箭火，说「趴下」。近景。",
      "【垫图】本段静帧3张",
      "【资产·Image对照】",
      "@角色1|id=hero|label=剑客|kind=角色",
      "@场景1|id=bridge|label=雨桥|kind=场景",
      "【路径运镜配方】",
      "硬规则：每镜一个主运镜",
      "【点选道具锚点】",
      "- 传家玉佩 · /manhua-props/demo.jpg",
    ].join("\n");
    const out = stripManhuaClipForbiddenBoards(fat);
    expect(out).toContain("【第1段·15s】");
    expect(out).toContain("@角色1");
    expect(out).toContain("【资产·Image对照】");
    expect(out).toContain("【垫图】");
    expect(out).not.toMatch(/节拍防火墙|古风服化|视频生成导戏单|按秒导戏单|成片预演|路径运镜|点选道具|arch_rain/);
    expect(isManhuaClipPromptLegacyFat(out)).toBe(false);
  });
});
