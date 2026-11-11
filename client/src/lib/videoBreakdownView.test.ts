import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatVideoBreakdownRecreatePrompt, validateVideoBreakdownTiming, videoBreakdownSchema, type VideoBreakdown, type VideoBreakdownSegment } from "@shared/videoBreakdown";
import { VideoBreakdownFailed, VideoBreakdownIntro, VideoBreakdownResultView } from "@/components/videoBreakdown/VideoBreakdownResult";
import {
  VIDEO_BREAKDOWN_PRICE_COPY,
  buildAllRecreatePromptsText,
  buildVideoBreakdownMarkdown,
  expressionRows,
  formatClock,
  formatDuration,
  friendlyVideoBreakdownError,
  isVideoBreakdownActive,
  readJobIdFromSearch,
  resolveVideoBreakdownContentType,
  segmentPlayback,
  validateVideoBreakdownDuration,
  validateVideoBreakdownFile,
  videoBreakdownStageIndex,
  videoBreakdownStageLabel,
} from "./videoBreakdownView";

const bounds: Array<[number, number, string]> = [[0, 4.2, "雨林潜行"], [4.2, 8.5, "闪电对峙"], [8.5, 12.8, "扑咬反击"], [12.8, 17, "泥沼收束"]];

function segment(index: number): VideoBreakdownSegment {
  const [startSec, endSec, title] = bounds[index];
  const mid = Math.round(((startSec + endSec) / 2) * 10) / 10;
  const length = Math.round((endSec - startSec) * 10) / 10;
  return {
    index, startSec, endSec, title,
    shots: [
      { startSec, endSec: mid, framing: `第${index + 1}段远景`, camera: "平视 · 缓推", blockingAndFocus: "主体居左三分线 | 焦点在眼睛" },
      { startSec: mid, endSec, framing: `第${index + 1}段特写`, camera: "低机位 · 手持", blockingAndFocus: "雨滴在前景虚化" },
    ],
    expression: {
      narrativeIntent: `第${index + 1}段建立威胁`, technique: "冷暖对比", rhythm: "先慢后快",
      ...(index === 3 ? {} : { sound: "雷声与低频呼吸" }),
    },
    recreatePrompt: {
      subject: "同一只成年恐龙，琥珀色眼睛", scene: "暴雨中的蕨类雨林",
      timeline: [{ fromSec: 0, toSec: length / 2, text: "缓慢探头，雨水顺鳞片滑落" }, { fromSec: length / 2, toSec: length, text: "猛然张口，闪电照亮牙齿" }],
      camera: "低机位仰拍，缓推", lightColor: "冷蓝环境光加闪电白", rhythm: "前半静默，后半鼓点", constraints: "保留雨幕；避免卡通化",
    },
  };
}

const fixture: VideoBreakdown = {
  kind: "video_breakdown_v1",
  durationSec: 17,
  summary: "暴雨雨林里两只恐龙从对峙到扑咬，最后幼兽坠入泥沼。",
  overview: {
    visualGenes: { mediumAndArtStyle: "写实三维动画", color: "墨绿与冷蓝", lighting: "闪电硬光", materialTexture: "湿润鳞片", composition: "前景遮挡", camera: "低机位为主" },
    recurringElements: ["琥珀色眼睛", "雨水高光"],
    mustKeep: ["体型对比", "闪电节拍"],
  },
  segments: [0, 1, 2, 3].map(segment),
};

const html = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("假数据符合契约", () => {
  it("17 秒 4 段通过结构与时序校验", () => {
    expect(videoBreakdownSchema.parse(fixture)).toEqual(fixture);
    expect(validateVideoBreakdownTiming(fixture)).toEqual([]);
  });
});

describe("纯函数", () => {
  it("类型与大小校验，空 type 按扩展名兜底", () => {
    expect(resolveVideoBreakdownContentType({ name: "a.MOV", type: "" })).toBe("video/quicktime");
    expect(resolveVideoBreakdownContentType({ name: "a.mp4", type: "video/mp4" })).toBe("video/mp4");
    expect(resolveVideoBreakdownContentType({ name: "a.mkv", type: "video/x-matroska" })).toBeNull();
    expect(resolveVideoBreakdownContentType({ name: "a.mp4", type: "image/png" })).toBeNull();
    expect(validateVideoBreakdownFile({ name: "a.webm", type: "video/webm", size: 1024 })).toBeNull();
    expect(validateVideoBreakdownFile({ name: "a.avi", type: "video/x-msvideo", size: 1024 })).toContain("MP4");
    expect(validateVideoBreakdownFile({ name: "a.mp4", type: "video/mp4", size: 501 * 1024 * 1024 })).toContain("500 MB");
    expect(validateVideoBreakdownFile({ name: "a.mp4", type: "video/mp4", size: 0 })).toContain("空");
  });

  it("时长超限才拦，读不到时长不拦", () => {
    expect(validateVideoBreakdownDuration(17)).toBeNull();
    expect(validateVideoBreakdownDuration(null)).toBeNull();
    expect(validateVideoBreakdownDuration(Number.NaN)).toBeNull();
    expect(validateVideoBreakdownDuration(300.3)).toBeNull();
    expect(validateVideoBreakdownDuration(301)).toContain("5 分钟");
  });

  it("时间格式", () => {
    expect(formatClock(0)).toBe("00:00.0");
    expect(formatClock(4.2)).toBe("00:04.2");
    expect(formatClock(65.04)).toBe("01:05.0");
    expect(formatClock(59.97)).toBe("01:00.0");
    expect(formatDuration(4.3)).toBe("4.3 秒");
    expect(formatDuration(125)).toBe("2 分 05 秒");
  });

  it("阶段文案与下标", () => {
    expect(videoBreakdownStageIndex({ status: "queued" })).toBe(-1);
    expect(videoBreakdownStageIndex({ status: "running", stage: "watching" })).toBe(1);
    expect(videoBreakdownStageIndex({ status: "running", stage: "cutting" })).toBe(3);
    expect(videoBreakdownStageIndex({ status: "succeeded", stage: "done" })).toBe(4);
    expect(videoBreakdownStageLabel({ status: "running", stage: "segmenting" })).toBe("分段整理中…");
    expect(videoBreakdownStageLabel({ status: "running", stage: "upload_checked" })).toBe("核对视频中…");
    expect(videoBreakdownStageLabel({ status: "running", stage: "unknown" })).toBe("正在拉片…");
    expect(isVideoBreakdownActive({ status: "running" })).toBe(true);
    expect(isVideoBreakdownActive({ status: "failed" })).toBe(false);
    expect(isVideoBreakdownActive(undefined)).toBe(false);
  });

  it("片段为空时回退到原片按起止秒", () => {
    const seg = fixture.segments[3];
    expect(segmentPlayback(seg, "https://cdn.example.com/c3.mp4", "https://cdn.example.com/src.mp4")).toEqual({ mode: "clip", src: "https://cdn.example.com/c3.mp4", startSec: 0, endSec: null });
    expect(segmentPlayback(seg, "", "https://cdn.example.com/src.mp4")).toEqual({ mode: "source", src: "https://cdn.example.com/src.mp4#t=12.80,17.00", startSec: 12.8, endSec: 17 });
    expect(segmentPlayback(seg, undefined, "https://cdn.example.com/src.mp4#t=1")).toMatchObject({ src: "https://cdn.example.com/src.mp4#t=12.80,17.00" });
    expect(segmentPlayback(seg, "  ", undefined)).toEqual({ mode: "none" });
  });

  it("声音缺省时不出现声音行", () => {
    expect(expressionRows(fixture.segments[0]).map(r => r.label)).toEqual(["叙事意图", "表现手法", "节奏与情绪", "声音"]);
    expect(expressionRows(fixture.segments[3]).map(r => r.label)).toEqual(["叙事意图", "表现手法", "节奏与情绪"]);
  });

  it("复制全部提示词：四段齐全、按顺序、正文与契约格式化一致", () => {
    const text = buildAllRecreatePromptsText(fixture);
    const blocks = text.split("\n\n");
    expect(blocks).toHaveLength(4);
    blocks.forEach((block, i) => {
      const [heading, ...rest] = block.split("\n");
      expect(heading).toBe(`# 片段 ${i + 1} · ${bounds[i][2]}（${formatClock(bounds[i][0])} – ${formatClock(bounds[i][1])}）`);
      expect(rest.join("\n")).toBe(formatVideoBreakdownRecreatePrompt(fixture.segments[i]));
    });
    expect(text).toContain("0.0–2.1秒：缓慢探头");
  });

  it("导出 Markdown：六维、元素、要点、四段表格与提示词，表格内竖线已转义", () => {
    const md = buildVideoBreakdownMarkdown(fixture);
    for (const label of ["媒介与美术风格", "色彩体系", "光线体系", "材质与质感", "构图体系", "摄影机体系"]) expect(md).toContain(`| ${label} |`);
    expect(md).toContain("- 琥珀色眼睛");
    expect(md).toContain("- 闪电节拍");
    expect(md.match(/^## 片段 /gm)).toHaveLength(4);
    expect(md.match(/```text/g)).toHaveLength(4);
    expect(md).toContain("主体居左三分线 \\| 焦点在眼睛");
    expect(md).toContain("| 00:12.8–00:14.9 | 第4段远景 |");
  });

  it("报错只放行中文业务提示", () => {
    expect(friendlyVideoBreakdownError(new Error("积分不足，请先充值"), "兜底")).toBe("积分不足，请先充值");
    expect(friendlyVideoBreakdownError(new Error("Upstream 429 quota exceeded"), "兜底")).toBe("兜底");
    expect(friendlyVideoBreakdownError(new Error("上游返回 {\"error\":1}"), "兜底")).toBe("兜底");
    expect(friendlyVideoBreakdownError(new Error("下载 https://x 失败"), "兜底")).toBe("兜底");
    expect(friendlyVideoBreakdownError(null, "兜底")).toBe("兜底");
  });

  it("地址栏 job 参数", () => {
    expect(readJobIdFromSearch("?job=vb_123abc")).toBe("vb_123abc");
    expect(readJobIdFromSearch("job=../../x")).toBeNull();
    expect(readJobIdFromSearch("")).toBeNull();
    expect(VIDEO_BREAKDOWN_PRICE_COPY).toBe("每次消耗 20 积分");
  });
});

describe("关键渲染", () => {
  const sourceUrl = "https://cdn.example.com/src.mp4";
  const clipUrls = ["https://storage.googleapis.com/b/c0.mp4", "https://cdn.example.com/c1.mp4", "", "https://cdn.example.com/c3.mp4"];

  it("结果：摘要、六维表、元素与要点、四张卡片、提示词与按钮", () => {
    const out = html(createElement(VideoBreakdownResultView, { result: fixture, sourceUrl, clipUrls, onCopy: () => undefined }));
    expect(out).toContain(fixture.summary);
    expect(out).toContain("全片创作拆解");
    for (const label of ["媒介与美术风格", "色彩体系", "光线体系", "材质与质感", "构图体系", "摄影机体系"]) expect(out).toContain(label);
    expect(out).toContain("琥珀色眼睛");
    expect(out).toContain("体型对比");
    expect(out.match(/data-segment-index=/g)).toHaveLength(4);
    expect(out.match(/<button[^>]*title="片段 /g)).toHaveLength(4);
    for (const head of ["时间", "画面景别", "摄影机", "调度 · 构图与焦点", "叙事意图", "表现手法", "节奏与情绪"]) expect(out).toContain(head);
    expect(out).toContain("复制全部提示词");
    expect(out).toContain("导出 Markdown");
    const prompts = Array.from(out.matchAll(/<pre data-recreate-prompt="(\d)"[^>]*>([\s\S]*?)<\/pre>/g));
    expect(prompts).toHaveLength(4);
    prompts.forEach(([, i, body]) => expect(decode(body)).toBe(formatVideoBreakdownRecreatePrompt(fixture.segments[Number(i)])));
    // 窄屏横向滚动容器
    expect(out).toContain("overflow-x-auto");
  });

  it("clipUrl 为空的段回退为原片按起止秒播放，其他段播片段（GCS 走站内中转）", () => {
    const out = html(createElement(VideoBreakdownResultView, { result: fixture, sourceUrl, clipUrls, onCopy: () => undefined }));
    const players = Array.from(out.matchAll(/<video data-playback="(clip|source)" src="([^"]+)"/g)).map(m => [m[1], decode(m[2])]);
    expect(players).toEqual([
      ["clip", "/api/gcs-transfer?url=" + encodeURIComponent(clipUrls[0])],
      ["clip", clipUrls[1]],
      ["source", "https://cdn.example.com/src.mp4#t=8.50,12.80"],
      ["clip", clipUrls[3]],
    ]);
    expect(out).toContain("本段片段暂未裁好");
  });

  it("没有 clipUrls 时全部回退原片；连原片都没有时给提示", () => {
    const all = html(createElement(VideoBreakdownResultView, { result: fixture, sourceUrl, onCopy: () => undefined }));
    expect(all.match(/data-playback="source"/g)).toHaveLength(4);
    const none = html(createElement(VideoBreakdownResultView, { result: fixture, onCopy: () => undefined }));
    expect(none).not.toContain("<video");
    expect(none).toContain("片段暂不可播放");
    expect(none).toContain("原片暂不可播放");
  });

  it("失败态显示业务提示与重新拉片；无提示时用兜底", () => {
    const out = html(createElement(VideoBreakdownFailed, { error: "视频里没有可识别的画面，请换一支再试", onRetry: () => undefined }));
    expect(out).toContain('role="alert"');
    expect(out).toContain("视频里没有可识别的画面，请换一支再试");
    expect(out).toContain("重新拉片");
    expect(html(createElement(VideoBreakdownFailed, { onRetry: () => undefined }))).toContain("请稍后重新拉片");
  });

  it("空态说明拉片是什么、复刻提示词可直接用于视频生成", () => {
    const out = html(createElement(VideoBreakdownIntro));
    expect(out).toContain("拉片");
    expect(out).toContain("可直接用于视频生成");
  });

  it("前台文本不含模型、通道、供应商名", () => {
    const out = [
      html(createElement(VideoBreakdownResultView, { result: fixture, sourceUrl, clipUrls, onCopy: () => undefined })),
      html(createElement(VideoBreakdownFailed, { onRetry: () => undefined })),
      html(createElement(VideoBreakdownIntro)),
    ].join("").replace(/<[^>]+>/g, " ");
    expect(out).not.toMatch(/gemini|gpt|claude|veo|vertex|openai|google|anthropic|seedance|evolink|fly|vercel/i);
  });
});
