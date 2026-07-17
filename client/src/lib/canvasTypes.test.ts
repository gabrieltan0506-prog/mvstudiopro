import { describe, expect, it } from "vitest";
import {
  collectDocumentAssets,
  collectUpstreamBlockIds,
  collectUpstreamTexts,
  collectVisionImages,
  defaultCanvasBlock,
  resolveBlockHandoffText,
  resolveNearestUpstreamImageUrl,
} from "./canvasTypes";

describe("canvas upstream handoff", () => {
  it("prefers outputText over prompt when resolving handoff", () => {
    const block = defaultCanvasBlock("text", 0, 0);
    block.prompt = "draft prompt";
    block.outputText = "final output";
    expect(resolveBlockHandoffText(block)).toBe("final output");
  });

  it("falls back to prompt when outputText is empty", () => {
    const block = defaultCanvasBlock("text", 0, 0);
    block.prompt = "A 方框里的提示词";
    expect(resolveBlockHandoffText(block)).toBe("A 方框里的提示词");
  });

  it("collects upstream prompt from connected block before run", () => {
    const a = defaultCanvasBlock("text", 0, 0);
    a.id = "a";
    a.prompt = "一只在海边奔跑的金毛";

    const b = defaultCanvasBlock("image", 100, 0);
    b.id = "b";
    b.prompt = "电影感竖屏封面";

    const texts = collectUpstreamTexts("b", [a, b], [{ fromId: "a", toId: "b" }]);
    expect(texts).toEqual(["一只在海边奔跑的金毛"]);
  });

  it("collects multi-hop chain A→B→C texts in upstream order", () => {
    const a = defaultCanvasBlock("text", 0, 0);
    a.id = "a";
    a.prompt = "品牌故事";

    const b = defaultCanvasBlock("text", 100, 0);
    b.id = "b";
    b.prompt = "分镜脚本";

    const c = defaultCanvasBlock("image", 200, 0);
    c.id = "c";
    c.prompt = "生成封面";

    const edges = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];

    expect(collectUpstreamBlockIds("c", [a, b, c], edges)).toEqual(["a", "b"]);
    expect(collectUpstreamTexts("c", [a, b, c], edges)).toEqual(["品牌故事", "分镜脚本"]);
  });

  it("collects diamond graph upstream without duplicates", () => {
    const a = defaultCanvasBlock("text", 0, 0);
    a.id = "a";
    a.prompt = "根节点";

    const b = defaultCanvasBlock("text", 100, 0);
    b.id = "b";
    b.prompt = "分支 B";

    const c = defaultCanvasBlock("text", 100, 80);
    c.id = "c";
    c.prompt = "分支 C";

    const d = defaultCanvasBlock("image", 200, 40);
    d.id = "d";

    const edges = [
      { fromId: "a", toId: "b" },
      { fromId: "a", toId: "c" },
      { fromId: "b", toId: "d" },
      { fromId: "c", toId: "d" },
    ];

    expect(collectUpstreamTexts("d", [a, b, c, d], edges)).toEqual(["根节点", "分支 B", "分支 C"]);
  });

  it("collects parent handoff text via parentId chain", () => {
    const parent = defaultCanvasBlock("text", 0, 0);
    parent.id = "parent";
    parent.prompt = "上游父节点文案";

    const child = defaultCanvasBlock("image", 200, 0, "parent");
    child.id = "child";

    const texts = collectUpstreamTexts("child", [parent, child], []);
    expect(texts).toEqual(["上游父节点文案"]);
  });

  it("dedupes identical upstream texts", () => {
    const a = defaultCanvasBlock("text", 0, 0);
    a.id = "a";
    a.prompt = "same";

    const b = defaultCanvasBlock("text", 100, 0, "a");
    b.id = "b";
    b.prompt = "same";

    const texts = collectUpstreamTexts("b", [a, b], [{ fromId: "a", toId: "b" }]);
    expect(texts).toEqual(["same"]);
  });

  it("collects vision assets from entire upstream chain", () => {
    const a = defaultCanvasBlock("text", 0, 0);
    a.id = "a";
    a.outputUrl = "https://example.com/a.png";

    const b = defaultCanvasBlock("text", 100, 0);
    b.id = "b";
    b.outputUrl = "https://example.com/b.png";

    const c = defaultCanvasBlock("image", 200, 0);
    c.id = "c";

    const edges = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];

    const urls = collectVisionImages("c", [a, b, c], edges).map((item) => item.url);
    expect(urls).toEqual(["https://example.com/a.png", "https://example.com/b.png"]);
  });

  it("does not treat uploaded documents as vision images", () => {
    const block = defaultCanvasBlock("copy_organize", 0, 0);
    block.id = "org";
    block.uploadedAssets = [
      {
        id: "doc1",
        url: "https://example.com/day3.txt",
        previewUrl: "https://example.com/day3.txt",
        fileName: "day3.txt",
        kind: "document",
        mimeType: "text/plain",
      },
      {
        id: "img1",
        url: "https://example.com/cover.png",
        previewUrl: "https://example.com/cover.png",
        fileName: "cover.png",
        kind: "image",
        mimeType: "image/png",
      },
    ];

    const vision = collectVisionImages("org", [block], []);
    expect(vision.map((i) => i.url)).toEqual(["https://example.com/cover.png"]);
    expect(collectDocumentAssets("org", [block], []).map((a) => a.fileName)).toEqual(["day3.txt"]);
  });

  it("picks nearest upstream image for reference", () => {
    const a = defaultCanvasBlock("text", 0, 0);
    a.id = "a";
    a.outputUrl = "https://example.com/far.png";

    const b = defaultCanvasBlock("image", 100, 0);
    b.id = "b";
    b.outputUrl = "https://example.com/near.png";

    const c = defaultCanvasBlock("video", 200, 0);
    c.id = "c";

    const edges = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];

    expect(resolveNearestUpstreamImageUrl("c", [a, b, c], edges)).toBe("https://example.com/near.png");
  });
});
