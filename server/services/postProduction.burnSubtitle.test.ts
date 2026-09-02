/**
 * burn_subtitle 算子参数构造纯测试:不真跑 ffmpeg,
 * 钉住滤镜串样式口径、路径/字体注入面与 argv 结构(路径独立 argv,不拼 shell)。
 */
import { describe, expect, it } from "vitest";
import {
  buildBurnSubtitleArgs,
  buildBurnSubtitleFilter,
  burnSubtitleParamsSchema,
} from "./postProduction";

describe("burn_subtitle 参数契约", () => {
  it("最小输入通过,未知字段与空 SRT 打回", () => {
    const parsed = burnSubtitleParamsSchema.parse({
      videoUri: "gs://b/video.mp4",
      subtitleSrt: "1\n00:00:00,000 --> 00:00:03,000\n你好\n",
    });
    expect(parsed.styleOverride).toBeUndefined();
    expect(() =>
      burnSubtitleParamsSchema.parse({
        videoUri: "gs://b/video.mp4",
        subtitleSrt: "",
      }),
    ).toThrow();
    expect(() =>
      burnSubtitleParamsSchema.parse({
        videoUri: "gs://b/video.mp4",
        subtitleSrt: "x",
        extra: 1,
      }),
    ).toThrow();
  });

  it("字体名只收白名单字符,引号/分隔符进不了 force_style", () => {
    expect(() =>
      burnSubtitleParamsSchema.parse({
        videoUri: "gs://b/v.mp4",
        subtitleSrt: "x",
        styleOverride: { fontName: "Noto Sans CJK SC" },
      }),
    ).not.toThrow();
    for (const bad of ["Arial'", "Arial,Outline=9", "Arial:x", "字体"]) {
      expect(() =>
        burnSubtitleParamsSchema.parse({
          videoUri: "gs://b/v.mp4",
          subtitleSrt: "x",
          styleOverride: { fontName: bad },
        }),
      ).toThrow("字体名格式不正确");
    }
  });
});

describe("burn_subtitle 滤镜串构造", () => {
  it("默认竖屏口径:白字黑边、底部居中、MarginV=35(约底部 12%)", () => {
    const filter = buildBurnSubtitleFilter("/tmp/pp-burnsub-x/sub-abc.srt");
    expect(filter).toBe(
      "subtitles=filename='/tmp/pp-burnsub-x/sub-abc.srt':" +
        "force_style='FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000," +
        "BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=35'",
    );
    // 默认不写死字体名,跟随渲染机 fontconfig
    expect(filter).not.toContain("FontName");
  });

  it("styleOverride 逐项覆盖,fontName 显式给才追加", () => {
    const filter = buildBurnSubtitleFilter("/tmp/a/sub.srt", {
      fontSize: 20,
      outline: 3,
      marginV: 50,
      fontName: "Noto Sans CJK SC",
    });
    expect(filter).toContain("FontSize=20");
    expect(filter).toContain("Outline=3");
    expect(filter).toContain("MarginV=50");
    expect(filter).toContain("FontName=Noto Sans CJK SC'");
  });

  it("路径带滤镜保留字符直接拒绝,不转义硬扛", () => {
    for (const bad of ["/tmp/a'b.srt", "/tmp/a:b.srt", "/tmp/a,b.srt", "/tmp/a;b.srt", "/tmp/a[0].srt"]) {
      expect(() => buildBurnSubtitleFilter(bad)).toThrow("滤镜保留字符");
    }
  });
});

describe("burn_subtitle argv 构造", () => {
  it("路径独立 argv、画面重编码、音轨 copy、输出在末位", () => {
    const args = buildBurnSubtitleArgs({
      videoPath: "/tmp/pp-burnsub-x/video.mp4",
      srtPath: "/tmp/pp-burnsub-x/sub-abc.srt",
      outPath: "/tmp/pp-burnsub-x/out.mp4",
    });
    expect(args[0]).toBe("-y");
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/pp-burnsub-x/video.mp4");
    expect(args[args.indexOf("-vf") + 1]).toContain("sub-abc.srt");
    // 字幕画进像素躲不开重编码;音轨与烧字无关,copy 不动
    expect(args.join(" ")).toContain("-c:v libx264 -preset medium -crf 18 -c:a copy");
    expect(args[args.length - 1]).toBe("/tmp/pp-burnsub-x/out.mp4");
  });
});
