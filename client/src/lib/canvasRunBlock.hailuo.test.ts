import { describe, expect, it } from "vitest";
import { buildHailuo3CanvasRequestBody } from "./canvasRunBlock";

describe("H3 画布提交体", () => {
  it("把 10 秒试片时长和画质写入真实 jobs 请求体", () => {
    const body = buildHailuo3CanvasRequestBody({
      prompt: "【第1段·15s】\n目标时长：约 10 秒\n0–10秒：人物向门口移动",
      imageUrl: "https://cdn.example/first.png",
      imageUrls: [
        "https://cdn.example/first.png",
        "https://cdn.example/reference.png",
      ],
      aspectRatio: "16:9",
      duration: 10,
      resolution: "2K",
      episodeIndex: 1,
      clipIndex: 1,
    });

    expect(body).toMatchObject({
      imageUrl: "https://cdn.example/first.png",
      imageUrls: [
        "https://cdn.example/first.png",
        "https://cdn.example/reference.png",
      ],
      aspectRatio: "16:9",
      duration: 10,
      resolution: "2K",
      generateAudio: true,
      episodeIndex: 1,
      clipIndex: 1,
    });
    expect(body.prompt).toContain("约 10 秒");
    expect(body.prompt).not.toContain("【第1段·15s】");
  });

  it("真实提交体使用 H3 自然语言引用，不发送 Seedance 专属标记", () => {
    const body = buildHailuo3CanvasRequestBody({
      prompt: "【参考】@图片1 锁定人物，角色说「别动」，<门轴轻响>",
      imageUrls: ["https://cdn.example/first.png"],
      aspectRatio: "16:9",
      duration: 10,
    });
    expect(body.prompt).toContain("Image 1");
    expect(body.prompt).toContain("“别动”");
    expect(body.prompt).not.toMatch(/@图片|[{}<>【】]/);
  });

  it("第 10 张图明确阻断，不截成 9 张后假装成功", () => {
    expect(() =>
      buildHailuo3CanvasRequestBody({
        prompt: "人物走近",
        imageUrls: Array.from({ length: 10 }, (_, i) => `https://cdn.example/${i + 1}.png`),
        aspectRatio: "16:9",
        duration: 10,
      }),
    ).toThrow(/参考图上限 9/);
  });

  it.each(["768p", "1080p", "2K"])("保留客户端画质 %s 交给服务端统一归一", (resolution) => {
    const body = buildHailuo3CanvasRequestBody({
      prompt: "固定机位",
      aspectRatio: "9:16",
      duration: 10,
      resolution,
    });
    expect(body.resolution).toBe(resolution);
    expect(body.duration).toBe(10);
  });
});
