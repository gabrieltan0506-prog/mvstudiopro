import { describe, expect, it } from "vitest";
import { buildWanReferenceRoleBlock, stableWanIdempotencyKey } from "./canvasRunBlock";

describe("Wan 提示词编译与幂等键(审查 P1)", () => {
  it("参考职责表编号与数组顺序严格一致,职责按 kind 区分", () => {
    const images = ["https://x/tail.png", "https://x/still.png", "https://x/char.png"];
    const block = buildWanReferenceRoleBlock(images, [
      { url: "https://x/tail.png", kind: "tail" },
      { url: "https://x/still.png", kind: "still" },
    ]);
    const lines = block.split("\n");
    expect(lines[1]).toMatch(/^Reference image 1:.*末帧/);
    expect(lines[2]).toMatch(/^Reference image 2:.*关键静帧/);
    expect(lines[3]).toMatch(/^Reference image 3:.*定妆/);
    expect(block).toContain("禁止串位");
  });

  it("空图列表不产出职责表", () => {
    expect(buildWanReferenceRoleBlock([], [])).toBe("");
  });

  it("幂等键:同节点同内容稳定复用;内容或节点变化即换键", () => {
    const a1 = stableWanIdempotencyKey("clip-e01-s02", "p", ["u1"]);
    const a2 = stableWanIdempotencyKey("clip-e01-s02", "p", ["u1"]);
    const b = stableWanIdempotencyKey("clip-e01-s02", "p2", ["u1"]);
    const c = stableWanIdempotencyKey("clip-e01-s03", "p", ["u1"]);
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
    expect(c).not.toBe(a1);
    expect(a1).toMatch(/^wan30_/);
  });
});
