import { describe, expect, it } from "vitest";

import {
  buildManhuaAtReferenceIndex,
  formatManhuaAtReferencePromptBlock,
  parseManhuaAtReferenceTokens,
  resolveManhuaAtReferences,
  applyManhuaAtReferencesToClip,
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
  it("用户示例原句（英文形态兼容）：图片与音轨 token 全部扫出", () => {
    const text = "4-7秒 阿咎@image01 颤抖的说：这不是我干的，你们抓错人了@x3.mp3";
    expect(parseManhuaAtReferenceTokens(text)).toEqual(["image01", "x3.mp3"]);
  });

  it("中文正式形态：@图03/@音3/@板1 全部扫出", () => {
    const text = "开场@图03，配乐@音3，轨迹见@板1";
    expect(parseManhuaAtReferenceTokens(text)).toEqual(["图03", "音3", "板1"]);
  });

  it("中英同指一物：@image01 与 @图01 解析到同一 URL", () => {
    const index = buildManhuaAtReferenceIndex({ registry });
    const en = resolveManhuaAtReferences({ text: "看@image01", index, registry });
    const zh = resolveManhuaAtReferences({ text: "看@图01", index, registry });
    expect(en.resolved[0]!.url).toBe("https://x/ajiu.png");
    expect(zh.resolved[0]!.url).toBe("https://x/ajiu.png");
    expect(en.resolved[0]!.token).toBe("图01");
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
      text: "开场@图02，阿咎@image01，轨迹见@d1.png，配@x9.mp3",
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
    // 断链上报也用中文正式形态
    expect(r.missing).toEqual(["图07"]);
  });

  it("注入块含对照与导演板约束句", () => {
    const index = buildManhuaAtReferenceIndex({
      registry,
      boardUrlByEpisode: { 1: "https://x/board1.png" },
    });
    const r = resolveManhuaAtReferences({ text: "@图01 @板1", index, registry });
    const block = formatManhuaAtReferencePromptBlock(r);
    expect(block).toContain("【@引用对照】");
    expect(block).toContain("阿咎");
    expect(block).toContain("红线＝角色/道具动线");
  });

  it("出片闭环：@图 落 imageUrls + 注入块 + bindings；断链必报", () => {
    const index = buildManhuaAtReferenceIndex({ registry });
    const r = applyManhuaAtReferencesToClip({
      promptText: "阿咎@图01 出场，背景@图02，坏的@图09",
      index,
      registry,
    });
    expect(r.imageUrls).toEqual(["https://x/ajiu.png", "https://x/majiu.png"]);
    expect(r.promptAddonZh).toContain("【@引用对照】");
    expect(r.missing).toEqual(["图09"]);
    expect(r.bindings["图01"]).toEqual({ tag: "@角色1" });
  });

  it("出片闭环：重排后 bindings 仍指原槽位", () => {
    const index = buildManhuaAtReferenceIndex({ registry });
    const r = applyManhuaAtReferencesToClip({
      promptText: "看@图02",
      index,
      registry,
      bindings: { 图02: { tag: "@角色1" } },
    });
    expect(r.imageUrls).toEqual(["https://x/ajiu.png"]);
    expect(r.missing).toEqual([]);
  });
});
