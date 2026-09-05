import { describe, expect, it } from "vitest";
import {
  buildWan30RequestBody,
  buildWanAudioReferenceRoleBlock,
  buildWanReferenceRoleBlock,
  buildWanVideoReferenceRoleBlock,
  newWanSubmissionKey,
  resolveWan30CanvasVideoUrls,
} from "./canvasRunBlock";

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
    expect(body.prompt).toBe("p");
    // 同一次提交的网络重放:同一载荷序列化完全一致(键不漂移)
    expect(JSON.stringify(buildWan30RequestBody(input))).toBe(JSON.stringify(body));
    // 用户下一次点击换新键
    expect(newWanSubmissionKey("clip")).not.toBe(newWanSubmissionKey("clip"));
  });

  it("真实提交体把正文编译成 Wan 自然语言，不发送 Seedance 专属标记", () => {
    const body = buildWan30RequestBody({
      prompt: "【参考】@图片1 锁脸，@音频1 管声线，角色说{别动}，<门响>",
      images: ["https://x/1.png"],
      audioUrls: ["https://x/voice.mp3"],
      aspectRatio: "9:16",
      duration: 10,
    });
    expect(body.prompt).toContain("Reference image 1");
    expect(body.prompt).toContain("Reference audio 1");
    expect(body.prompt).toContain("“别动”");
    expect(body.prompt).toContain("音效：门响");
    expect(body.prompt).not.toMatch(/@图片|@音频|[{}<>【】]/);
  });

  it("第 11 张图与第 6 条音频明确阻断，不截断后提交", () => {
    expect(() =>
      buildWan30RequestBody({
        prompt: "人物走近",
        images: Array.from({ length: 11 }, (_, i) => `https://x/${i + 1}.png`),
        aspectRatio: "9:16",
      }),
    ).toThrow(/参考图上限 10/);
    expect(() =>
      buildWan30RequestBody({
        prompt: "人物走近",
        images: ["https://x/1.png"],
        audioUrls: Array.from({ length: 6 }, (_, i) => `https://x/${i + 1}.mp3`),
        aspectRatio: "9:16",
      }),
    ).toThrow(/参考音频上限 5/);
  });

  it("正文引用了未随提交体发送的视频时明确阻断", () => {
    expect(() =>
      buildWan30RequestBody({
        prompt: "@视频1 只管动作",
        images: ["https://x/1.png"],
        aspectRatio: "9:16",
      }),
    ).toThrow(/参考视频第 1 项.*实际只收到 0 项/);
  });

  it("参考视频保序去重且只收 HTTP(S)，提示词编号与真实 JSON 数组严格一致", () => {
    const continuityVideoUrl = "https://cdn.example/episode-1-segment-1.mp4";
    const videoUrls = resolveWan30CanvasVideoUrls({
      selectedVideoUrls: [
        "https://cdn.example/action.mp4",
        "javascript:alert(1)",
        "http://cdn.example/rhythm.mp4",
        "https://cdn.example/action.mp4",
      ],
      continuityVideoUrl,
    });
    expect(videoUrls).toEqual([
      "https://cdn.example/action.mp4",
      "http://cdn.example/rhythm.mp4",
      continuityVideoUrl,
    ]);
    const roleBlock = buildWanVideoReferenceRoleBlock(videoUrls, { continuityVideoUrl });
    const body = buildWan30RequestBody({
      prompt: roleBlock,
      images: ["https://cdn.example/still.png"],
      videoUrls,
      aspectRatio: "16:9",
      duration: 10,
    });
    // runWan30 对这份对象直接 JSON.stringify 后 POST；验证线上的 JSON 形状而非只看内存对象。
    const postedJson = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    expect(postedJson.videoUrls).toEqual(videoUrls);
    expect(postedJson.prompt).toBe(body.prompt);
    expect(body.prompt).toContain("Reference video 1:用户选定的视频参考");
    expect(body.prompt).toContain("Reference video 2:用户选定的视频参考");
    expect(body.prompt).toContain("Reference video 3:上一段成片");
    expect(body.prompt).not.toContain("cdn.example");
  });

  it("第 6 条参考视频明确阻断，不截成 5 条后提交", () => {
    const videoUrls = Array.from({ length: 6 }, (_, i) => `https://x/${i + 1}.mp4`);
    expect(() =>
      buildWan30RequestBody({
        prompt: buildWanVideoReferenceRoleBlock(videoUrls),
        images: ["https://x/1.png"],
        videoUrls,
        aspectRatio: "9:16",
      }),
    ).toThrow(/参考视频上限 5/);
  });

  it("真实音频数组与角色声线职责同序编号，重复声样合并点名", () => {
    const audioUrls = ["https://x/shared.mp3", "https://x/accent.mp3"];
    const roleBlock = buildWanAudioReferenceRoleBlock(
      audioUrls,
      [
        {
          characterTag: "@角色1",
          labelZh: "玄璃",
          audioUrl: audioUrls[0]!,
          weightSec: 4,
        },
        {
          characterTag: "@角色2",
          labelZh: "谢明彰",
          audioUrl: audioUrls[0]!,
          weightSec: 2,
        },
      ],
      { accentFallbackUrl: audioUrls[1] },
    );
    const body = buildWan30RequestBody({
      prompt: roleBlock,
      images: ["https://x/still.png"],
      audioUrls,
      aspectRatio: "9:16",
      duration: 30,
    });
    expect(body.audioUrls).toEqual(audioUrls);
    expect(body.prompt).toContain("Reference audio 1:玄璃、谢明彰的角色声线");
    expect(body.prompt).toContain("Reference audio 2:全片对白口音基准");
    expect(body.prompt).not.toContain("https://x/");
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
