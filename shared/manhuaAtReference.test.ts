import { describe, expect, it } from "vitest";

import {
  buildManhuaAtReferenceIndex,
  formatManhuaAtReferencePromptBlock,
  parseManhuaAtReferenceTokens,
  resolveManhuaAtReferences,
} from "./manhuaAtReference";

const registry = {
  slots: [
    {
      tag: "@角色1",
      role: "character" as const,
      index: 1,
      id: "cust_a",
      labelZh: "阿咎",
      path: "https://x/ajiu.png",
    },
    {
      tag: "@场景1",
      role: "scene" as const,
      index: 1,
      id: "cust_b",
      labelZh: "雁门军营马厩",
      path: "https://x/majiu.png",
    },
  ],
};

describe("manhuaAtReference", () => {
  it("用户示例原句：图片与音轨 token 全部扫出", () => {
    const text = "4-7秒 阿咎@image01 颤抖的说：这不是我干的，你们抓错人了@x3.mp3";
    expect(parseManhuaAtReferenceTokens(text)).toEqual(["image01", "x3.mp3"]);
  });

  it("不吃邮箱与普通 @ 字符", () => {
    expect(parseManhuaAtReferenceTokens("联系 a@image01.com 和 @路人甲")).toEqual([]);
  });

  it("索引按锁表顺序编号并解析出 URL", () => {
    const index = buildManhuaAtReferenceIndex({
      registry,
      boardUrlByEpisode: { 1: "https://x/board1.png" },
    });
    const r = resolveManhuaAtReferences({
      text: "开场@image02，阿咎@image01，轨迹见@d1.png，配@x9.mp3",
      index,
      registry,
    });
    expect(r.resolved.map((e) => e.url)).toEqual([
      "https://x/majiu.png",
      "https://x/ajiu.png",
      "https://x/board1.png",
    ]);
    expect(r.missing).toEqual(["x9.mp3"]);
  });

  it("bindings 优先：资产重排后旧稿 token 仍指原槽位", () => {
    const index = buildManhuaAtReferenceIndex({ registry });
    const r = resolveManhuaAtReferences({
      text: "阿咎@image02 出场",
      index,
      registry,
      bindings: { image02: { tag: "@角色1" } },
    });
    expect(r.resolved[0]!.url).toBe("https://x/ajiu.png");
    expect(r.missing).toEqual([]);
  });

  it("断链如实报 missing，不静默跳过", () => {
    const index = buildManhuaAtReferenceIndex({ registry });
    const r = resolveManhuaAtReferences({
      text: "@image07 不存在",
      index,
      registry,
      bindings: { image07: { tag: "@角色9" } },
    });
    expect(r.missing).toEqual(["image07"]);
  });

  it("注入块含对照与导演板约束句", () => {
    const index = buildManhuaAtReferenceIndex({
      registry,
      boardUrlByEpisode: { 1: "https://x/board1.png" },
    });
    const r = resolveManhuaAtReferences({ text: "@image01 @d1.png", index, registry });
    const block = formatManhuaAtReferencePromptBlock(r);
    expect(block).toContain("【@引用对照】");
    expect(block).toContain("阿咎");
    expect(block).toContain("红线＝角色/道具动线");
  });
});
