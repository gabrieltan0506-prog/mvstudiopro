import { describe, expect, it } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import {
  layoutManhuaCanvasBlocks,
  manhuaCanvasLaneOf,
  MANHUA_CANVAS_LAYOUT,
} from "./manhuaCanvasLayout";

function mk(id: string, episodeIndex?: number): CanvasBlock {
  return {
    ...defaultCanvasBlock(id.startsWith("clip-") ? "video" : "image", 9999, 9999),
    id,
    ...(episodeIndex ? { episodeIndex } : {}),
  };
}

describe("manhuaCanvasLayout", () => {
  it("把节点归到对应分区；服装并入服装道具组", () => {
    expect(manhuaCanvasLaneOf("charsheet-hero")).toBe("character");
    expect(manhuaCanvasLaneOf("charsheet-face-hero")).toBe("character");
    // 服装与道具同属「服装道具组」：都是可换戴的外部物件，放一起才好挑
    expect(manhuaCanvasLaneOf("wardrobeplate-hero")).toBe("prop");
    expect(manhuaCanvasLaneOf("wardrobe-hero")).toBe("prop");
    expect(manhuaCanvasLaneOf("propsheet-blade")).toBe("prop");
    expect(manhuaCanvasLaneOf("propplate-blade")).toBe("prop");
    expect(manhuaCanvasLaneOf("sceneplate-inn")).toBe("scene");
    expect(manhuaCanvasLaneOf("story-e01")).toBe("episode");
    expect(manhuaCanvasLaneOf("keyart-e01-s01")).toBe("episode");
    expect(manhuaCanvasLaneOf("clip-e01-g01")).toBe("clipPrompt");
    // 不认识的节点不归任何区，排版时原样保留
    expect(manhuaCanvasLaneOf("text-freeform-1")).toBeNull();
  });

  /**
   * 这条盯的是改版前的实际故障：给资产排位的函数只认角色和场景，
   * 道具压根没进去，留在生成时的原始坐标上，画面就是一团乱。
   */
  it("人物 / 道具 / 场景上下堆三块，块内直排，道具不再被漏掉", () => {
    const blocks = [
      mk("charsheet-a"),
      mk("charsheet-b"),
      mk("propsheet-x"),
      mk("sceneplate-m"),
    ];
    const out = layoutManhuaCanvasBlocks(blocks);
    const at = (id: string) => out.find((b) => b.id === id)!;

    // 三块共用最左侧的 x
    for (const id of ["charsheet-a", "charsheet-b", "propsheet-x", "sceneplate-m"]) {
      expect(at(id).x).toBe(MANHUA_CANVAS_LAYOUT.originX);
    }
    // 块内直排：同类节点 y 依次递增
    expect(at("charsheet-b").y).toBeGreaterThan(at("charsheet-a").y);
    // 块间顺序：人物 → 道具 → 场景
    expect(at("propsheet-x").y).toBeGreaterThan(at("charsheet-b").y);
    expect(at("sceneplate-m").y).toBeGreaterThan(at("propsheet-x").y);
    // 道具确实被排过位，不再留在原始坐标
    expect(at("propsheet-x").y).not.toBe(9999);
  });

  it("右侧按流程往右并列：静帧+导演版 → 成片提示词", () => {
    const blocks = [
      mk("charsheet-a"),
      mk("story-e01", 1),
      mk("keyart-e01-s01", 1),
      mk("clip-e01-g01", 1),
    ];
    const out = layoutManhuaCanvasBlocks(blocks);
    const at = (id: string) => out.find((b) => b.id === id)!;

    expect(at("story-e01").x).toBeGreaterThan(at("charsheet-a").x);
    expect(at("clip-e01-g01").x).toBeGreaterThan(at("story-e01").x);
    // 同一列内导演版在静帧之前
    expect(at("story-e01").x).toBe(at("keyart-e01-s01").x);
    expect(at("keyart-e01-s01").y).toBeGreaterThan(at("story-e01").y);
  });

  it("同集内先导演版后静帧，静帧按镜号排，多集按集号先后", () => {
    const blocks = [
      mk("keyart-e01-s03", 1),
      mk("keyart-e01-s01", 1),
      mk("beats-e01", 1),
      mk("story-e01", 1),
      mk("story-e02", 2),
    ];
    const out = layoutManhuaCanvasBlocks(blocks);
    const y = (id: string) => out.find((b) => b.id === id)!.y;

    expect(y("story-e01")).toBeLessThan(y("beats-e01"));
    expect(y("beats-e01")).toBeLessThan(y("keyart-e01-s01"));
    expect(y("keyart-e01-s01")).toBeLessThan(y("keyart-e01-s03"));
    // 第 2 集整体排在第 1 集之后
    expect(y("story-e02")).toBeGreaterThan(y("keyart-e01-s03"));
  });

  it("折叠的集只占一个节点的高度，后面的集跟着上移", () => {
    const blocks = [
      mk("story-e01", 1),
      mk("keyart-e01-s01", 1),
      mk("keyart-e01-s02", 1),
      mk("keyart-e01-s03", 1),
      mk("story-e02", 2),
    ];
    const expanded = layoutManhuaCanvasBlocks(blocks);
    const collapsed = layoutManhuaCanvasBlocks(blocks, { collapsedEpisodes: [1] });
    const yOf = (list: CanvasBlock[], id: string) => list.find((b) => b.id === id)!.y;

    // 折叠后第 1 集的静帧全叠到同一个 y，不再各占一行
    const ks = ["keyart-e01-s01", "keyart-e01-s02", "keyart-e01-s03"];
    const collapsedYs = new Set(ks.map((id) => yOf(collapsed, id)));
    expect(collapsedYs.size).toBe(1);
    expect(new Set(ks.map((id) => yOf(expanded, id))).size).toBe(3);
    // 第 2 集因此上移
    expect(yOf(collapsed, "story-e02")).toBeLessThan(yOf(expanded, "story-e02"));
  });

  it("只改坐标，不动 prompt / 产出，也不增删节点", () => {
    const blocks = [
      { ...mk("keyart-e01-s01", 1), prompt: "静帧提示词", outputUrl: "https://cdn/x.png" },
      mk("text-freeform-1"),
    ];
    const out = layoutManhuaCanvasBlocks(blocks);
    expect(out.length).toBe(blocks.length);
    const keyart = out.find((b) => b.id === "keyart-e01-s01")!;
    expect(keyart.prompt).toBe("静帧提示词");
    expect(keyart.outputUrl).toBe("https://cdn/x.png");
    // 不归分区的自由节点原样保留坐标
    const free = out.find((b) => b.id === "text-freeform-1")!;
    expect(free.x).toBe(9999);
    expect(free.y).toBe(9999);
  });
});
