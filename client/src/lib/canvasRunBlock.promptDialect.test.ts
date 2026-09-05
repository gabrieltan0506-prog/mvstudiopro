import { describe, expect, it } from "vitest";
import {
  compileManhuaVideoPromptForOutbound,
  resolveManhuaCanvasVideoImageReferenceMax,
} from "./canvasRunBlock";

const RAW = [
  "【第1段·10s】",
  "@图片1 锁定人物，@视频1 只管动作，@音频1 只管声线",
  "谢明彰说「杀了他」",
  "<雨打伞棚>",
].join("\n");

describe("漫剧成片提示词唯一出站编译器", () => {
  it.each([
    ["seedance-2.0", 9],
    ["seedance-2.5", 30],
  ] as const)("%s 保留官方素材标记与四类符号，且不静默改写对白", (engine, maxImages) => {
    const text = compileManhuaVideoPromptForOutbound({
      prompt: RAW,
      engine,
      durationSec: 10,
      imageRefCount: maxImages,
      videoRefCount: engine === "seedance-2.5" ? 10 : 3,
      audioRefCount: engine === "seedance-2.5" ? 10 : 3,
    });
    expect(text).toContain("[第1段·10s]");
    expect(text).toContain("@图片1");
    expect(text).toContain("@视频1");
    expect(text).toContain("@音频1");
    expect(text).toContain("{杀了他}");
    expect(text).toContain("<雨打伞棚>");
    expect(text).not.toContain("制服他");
    expect(text).toBe(
      [
        "[第1段·10s]",
        "@图片1 锁定人物，@视频1 只管动作，@音频1 只管声线",
        "谢明彰说{杀了他}",
        "<雨打伞棚>",
      ].join("\n"),
    );
  });

  it("H3 转为 Image N 自然语言，剥离 Seedance 标记并保留原对白", () => {
    const text = compileManhuaVideoPromptForOutbound({
      prompt: "【第1段·10s】\n@图片1 锁定人物\n谢明彰说「杀了他」\n<雨打伞棚>",
      engine: "minimax-hailuo-3",
      durationSec: 10,
      imageRefCount: 1,
    });
    expect(text).toContain("Image 1");
    expect(text).toContain("“杀了他”");
    expect(text).toContain("雨打伞棚");
    expect(text).not.toMatch(/@图片|@视频|@音频|[{}<>【】]/);
    expect(text).not.toContain("制服他");
    expect(text).toBe(
      ["第1段·10s", "Image 1 锁定人物", "谢明彰说“杀了他”", "雨打伞棚"].join("\n"),
    );
  });

  it("Wan 转为三类 Reference 自然语言职责，剥离 Seedance 标记", () => {
    const text = compileManhuaVideoPromptForOutbound({
      prompt: RAW,
      engine: "wan-3.0",
      durationSec: 10,
      imageRefCount: 1,
      videoRefCount: 1,
      audioRefCount: 1,
    });
    expect(text).toContain("Reference image 1");
    expect(text).toContain("Reference video 1");
    expect(text).toContain("Reference audio 1");
    expect(text).toContain("“杀了他”");
    expect(text).toContain("音效：雨打伞棚");
    expect(text).not.toMatch(/@图片|@视频|@音频|[{}<>【】]/);
    expect(text).not.toContain("制服他");
    expect(text).toBe(
      [
        "第1段·10s：",
        "Reference image 1 锁定人物，Reference video 1 只管动作，Reference audio 1 只管声线",
        "谢明彰说“杀了他”",
        "音效：雨打伞棚",
      ].join("\n"),
    );
  });

  it("四条生产路由按各自真实引用上限阻断，不静默截断", () => {
    expect(() =>
      compileManhuaVideoPromptForOutbound({
        prompt: "人物走近",
        engine: "seedance-2.0",
        durationSec: 10,
        imageRefCount: 10,
      }),
    ).toThrow(/参考图上限 9/);
    expect(() =>
      compileManhuaVideoPromptForOutbound({
        prompt: "人物走近",
        engine: "seedance-2.5",
        durationSec: 10,
        imageRefCount: 31,
      }),
    ).toThrow(/参考图上限 30/);
    expect(() =>
      compileManhuaVideoPromptForOutbound({
        prompt: "人物走近",
        engine: "minimax-hailuo-3",
        durationSec: 10,
        videoRefCount: 1,
      }),
    ).toThrow(/参考视频上限 0/);
    expect(() =>
      compileManhuaVideoPromptForOutbound({
        prompt: "人物走近",
        engine: "wan-3.0",
        durationSec: 10,
        audioRefCount: 6,
      }),
    ).toThrow(/参考音频上限 5/);
  });

  it("引用编号超过真实提交素材数时阻断，不发送悬空职责", () => {
    expect(() =>
      compileManhuaVideoPromptForOutbound({
        prompt: "@图片2 锁定配角",
        engine: "seedance-2.5",
        durationSec: 10,
        imageRefCount: 1,
      }),
    ).toThrow(/参考图第 2 项.*实际只收到 1 项/);
  });

  it.each(["minimax-hailuo-3", "wan-3.0"] as const)(
    "%s 把资产库 @角色/@场景/@道具 标签转成自然语言并保留编号",
    (engine) => {
      const text = compileManhuaVideoPromptForOutbound({
        prompt: "@角色1 在 @场景2 拿起 @道具3",
        engine,
        durationSec: 10,
      });
      expect(text).toContain("角色1 在 场景2 拿起 道具3");
      expect(text).not.toMatch(/@(角色|场景|道具)\d+/);
    },
  );

  it("段级绑定与最终取图共用四引擎真实上限", () => {
    expect(resolveManhuaCanvasVideoImageReferenceMax("seedance-2.0")).toBe(9);
    expect(resolveManhuaCanvasVideoImageReferenceMax("seedance-2.5")).toBe(30);
    expect(resolveManhuaCanvasVideoImageReferenceMax("minimax-hailuo-3")).toBe(9);
    expect(resolveManhuaCanvasVideoImageReferenceMax("wan-3.0")).toBe(10);
  });
});
