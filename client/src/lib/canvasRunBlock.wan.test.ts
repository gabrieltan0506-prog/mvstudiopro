import { describe, expect, it } from "vitest";
import { buildWanReferenceRoleBlock, newWanSubmissionKey } from "./canvasRunBlock";

describe("Wan 提示词编译与提交键(复审 P0-2 / P1-5)", () => {
  it("职责表编号与数组顺序严格一致;导演板只管构图运镜,绝不锁脸", () => {
    const images = ["https://x/tail.png", "https://x/still.png", "https://x/char.png", "https://x/board.png"];
    const block = buildWanReferenceRoleBlock(images, [
      { url: "https://x/tail.png", kind: "tail" },
      { url: "https://x/still.png", kind: "still", slotZh: "0–5s" },
      { url: "https://x/char.png", kind: "asset", labelZh: "谢明彰", duty: "identity" },
      { url: "https://x/board.png", kind: "board" },
    ]);
    const lines = block.split("\n");
    expect(lines[1]).toMatch(/^Reference image 1:.*末帧/);
    expect(lines[2]).toMatch(/^Reference image 2:.*0–5s/);
    expect(lines[3]).toMatch(/^Reference image 3:.*「谢明彰」.*只锁脸/);
    expect(lines[4]).toMatch(/^Reference image 4:.*导演板/);
    expect(lines[4]).toMatch(/禁止用它锁定人物长相/);
    expect(block).toContain("禁止串位");
  });

  it("look 职责只锁服化;场景资产不锁人物", () => {
    const block = buildWanReferenceRoleBlock(
      ["https://x/look.png", "https://x/scene.png"],
      [
        { url: "https://x/look.png", kind: "asset", labelZh: "谢明彰", duty: "look" },
        { url: "https://x/scene.png", kind: "asset", labelZh: "雁门军营场景" },
      ],
    );
    expect(block).toMatch(/服装\/妆造参考,只锁服化/);
    expect(block).toMatch(/场景\/道具参考.*不锁定任何人物/);
  });

  it("空图列表不产出职责表", () => {
    expect(buildWanReferenceRoleBlock([], [])).toBe("");
  });

  it("提交键:每次调用必换新键(失败退款后重跑必须重新扣费),前缀含节点标识", () => {
    const a = newWanSubmissionKey("clip-e01-s02");
    const b = newWanSubmissionKey("clip-e01-s02");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^wan30_clip-e01-s02_/);
  });
});
