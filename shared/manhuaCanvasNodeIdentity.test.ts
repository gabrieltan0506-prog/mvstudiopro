import { describe, expect, it } from "vitest";
import {
  manhuaCanvasNodeBelongsToSegment,
  readManhuaCanvasNodeIdentity,
} from "./manhuaCanvasNodeIdentity";

describe("画布节点身份", () => {
  it("关键静帧：id 里的 -sNN 是镜号不是段号；段号由镜号映射", () => {
    const id = readManhuaCanvasNodeIdentity({
      blockId: "keyart-e01-s04-1789611087611-abcd",
      prompt: "",
      episodeIndex: 1,
    })!;
    expect(id.kind).toBe("keyart");
    expect(id.episode).toBe(1);
    expect(id.shotIndex).toBe(4); // -s04 = 第 4 镜
    expect(id.segmentIndex).toBe(2); // 每段 3 镜 → 第 4 镜落在第 2 段
    expect(id.labelZh).toBe("第1集 · 第2段 · 镜04 · 关键静帧");
  });

  it("给了真实段表就按段表映射，不按每段镜数硬推", () => {
    const segments = [
      { index: 1, shots: [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }] },
      { index: 2, shots: [{ index: 5 }] },
    ] as never;
    const id = readManhuaCanvasNodeIdentity({
      blockId: "keyart-e01-s04-x",
      episodeIndex: 1,
      segments,
    })!;
    expect(id.shotIndex).toBe(4);
    expect(id.segmentIndex).toBe(1); // 段表说第 4 镜还在第 1 段
  });

  it("段成片读出段号，没有镜号就不编一个", () => {
    const id = readManhuaCanvasNodeIdentity({
      blockId: "clip-e01-g02-audio",
      prompt: "【第2段·10s】医馆",
      episodeIndex: 1,
    })!;
    expect(id.kind).toBe("clip");
    expect(id.segmentIndex).toBe(2);
    expect(id.shotIndex).toBeNull();
    expect(id.labelZh).toBe("第1集 · 第2段 · 段成片");
  });

  it("整集成片与资产图认得出类型，但不硬塞段号", () => {
    const fin = readManhuaCanvasNodeIdentity({ blockId: "final-e01", episodeIndex: 1 })!;
    expect(fin.kind).toBe("final");
    expect(fin.segmentIndex).toBeNull();
    expect(fin.labelZh).toBe("第1集 · 整集成片");
    const asset = readManhuaCanvasNodeIdentity({ blockId: "char-aqing-01" })!;
    expect(asset.kind).toBe("asset");
    expect(asset.labelZh).toBe("资产图");
  });

  it("空 id 返回 null；认不出前缀就是「其它节点」，不猜", () => {
    expect(readManhuaCanvasNodeIdentity({ blockId: "" })).toBeNull();
    expect(readManhuaCanvasNodeIdentity({ blockId: "  " })).toBeNull();
    const other = readManhuaCanvasNodeIdentity({ blockId: "note-1788870239167" })!;
    expect(other.kind).toBe("other");
    expect(other.segmentIndex).toBeNull();
  });

  it("没有 episodeIndex 时从 id 里读集号", () => {
    const id = readManhuaCanvasNodeIdentity({ blockId: "clip-e03-g01-x", prompt: "【第1段·5s】" })!;
    expect(id.episode).toBe(3);
  });
});

describe("选中的节点是不是当前这一段", () => {
  const current = { episode: 1, segmentIndex: 2 };
  const of = (blockId: string, prompt = "") =>
    readManhuaCanvasNodeIdentity({ blockId, prompt, episodeIndex: null });

  it("同集同段 → current；同集别段 → other", () => {
    expect(manhuaCanvasNodeBelongsToSegment(of("clip-e01-g02-x", "【第2段·10s】"), current)).toBe("current");
    expect(manhuaCanvasNodeBelongsToSegment(of("clip-e01-g03-x", "【第3段·10s】"), current)).toBe("other");
  });

  it("别集一律 other，哪怕段号一样", () => {
    expect(manhuaCanvasNodeBelongsToSegment(of("clip-e02-g02-x", "【第2段·10s】"), current)).toBe("other");
  });

  it("判不出段号时是 unknown，不许默认当成本段", () => {
    expect(manhuaCanvasNodeBelongsToSegment(of("final-e01"), current)).toBe("unknown");
    expect(manhuaCanvasNodeBelongsToSegment(null, current)).toBe("unknown");
    // 反例对照：真能判出来的就不许报 unknown
    expect(manhuaCanvasNodeBelongsToSegment(of("clip-e01-g02-x", "【第2段·10s】"), current)).not.toBe("unknown");
  });
});
