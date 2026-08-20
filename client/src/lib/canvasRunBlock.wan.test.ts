import { describe, expect, it } from "vitest";
import { buildWan30RequestBody, buildWanReferenceRoleBlock, newWanSubmissionKey } from "./canvasRunBlock";

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

  it("look 职责只锁服化;类型判别只认 roleTag——label 不含类型词也不许猜成人物(三审 P1-2)", () => {
    const block = buildWanReferenceRoleBlock(
      ["https://x/look.png", "https://x/bridge.png", "https://x/knife.png"],
      [
        { url: "https://x/look.png", kind: "asset", labelZh: "谢明彰", duty: "look" },
        { url: "https://x/bridge.png", kind: "asset", roleTag: "@场景1", labelZh: "断月桥" },
        { url: "https://x/knife.png", kind: "asset", roleTag: "@道具2", labelZh: "割肉小刀" },
      ],
    );
    expect(block).toMatch(/服装\/妆造参考,只锁服化/);
    expect(block).toMatch(/「断月桥」场景参考.*不锁定任何人物/);
    expect(block).toMatch(/「割肉小刀」道具参考.*不锁定任何人物/);
    expect(block).not.toMatch(/断月桥」的人物定妆/);
  });

  it("请求体构建器:提交键与 seed 真实入 POST 载荷(三审 P0-1);同载荷重放键不变", () => {
    const input = {
      prompt: "p",
      images: ["https://x/1.png"],
      aspectRatio: "9:16" as const,
      idempotencyKey: "wan30_clip_abc123",
      seed: 777,
      duration: 30,
    };
    const body = buildWan30RequestBody(input);
    expect(body.idempotencyKey).toBe("wan30_clip_abc123");
    expect(body.seed).toBe(777);
    expect(body.duration).toBe(30);
    // 同一次提交的网络重放:同一载荷序列化完全一致(键不漂移)
    expect(JSON.stringify(buildWan30RequestBody(input))).toBe(JSON.stringify(body));
    // 用户下一次点击换新键
    expect(newWanSubmissionKey("clip")).not.toBe(newWanSubmissionKey("clip"));
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
