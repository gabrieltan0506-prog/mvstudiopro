import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatVideoBreakdownRecreatePrompt, validateVideoBreakdownTiming, videoBreakdownSchema } from "@shared/videoBreakdown";
import { bounds, videoBreakdownFixture, videoBreakdownFixtureRich, videoBreakdownFixtureRichFrames } from "@shared/videoBreakdown.fixture";
import { buildVideoBreakdownBgmPrompt } from "@shared/videoBreakdownBgm";
import { VideoBreakdownFailed, VideoBreakdownIntro, VideoBreakdownResultView } from "@/components/videoBreakdown/VideoBreakdownResult";
import {
  VIDEO_BREAKDOWN_PRICING_RULE_COPY,
  estimateVideoBreakdownCredits,
  videoBreakdownPriceCopy,
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
  sortedKeyMoments,
  splitArrowStages,
  speechRows,
  viralStrategyRows,
  validateVideoBreakdownDuration,
  validateVideoBreakdownFile,
  videoBreakdownStageIndex,
  videoBreakdownStageLabel,
} from "./videoBreakdownView";

const fixture = videoBreakdownFixture;

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
    expect(md).toContain("## 配乐提示词");
    expect(md.match(/```text/g)).toHaveLength(5);
    for (const label of ["媒介与美术风格", "色彩体系", "光线体系", "材质与质感", "构图体系", "摄影机体系"]) expect(md).toContain(`| ${label} |`);
    expect(md).toContain("- 琥珀色眼睛");
    expect(md).toContain("- 闪电节拍");
    expect(md.match(/^## 片段 /gm)).toHaveLength(4);
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

  it("按片长计价：一位小数后用契约函数；读不出时长给规则", () => {
    expect(estimateVideoBreakdownCredits(17)).toBe(30);
    expect(estimateVideoBreakdownCredits(120.04)).toBe(30);
    expect(estimateVideoBreakdownCredits(120.06)).toBe(40);
    expect(estimateVideoBreakdownCredits(130)).toBe(40);
    expect(estimateVideoBreakdownCredits(130.1)).toBe(50);
    expect(estimateVideoBreakdownCredits(300)).toBe(210);
    expect(estimateVideoBreakdownCredits(null)).toBeNull();
    expect(estimateVideoBreakdownCredits(0.01)).toBeNull();
    expect(videoBreakdownPriceCopy(65.3)).toBe("本次消耗 30 积分");
    expect(videoBreakdownPriceCopy(null)).toContain(VIDEO_BREAKDOWN_PRICING_RULE_COPY);
    expect(VIDEO_BREAKDOWN_PRICING_RULE_COPY).toBe("按片长计费：120 秒以内 30 积分，超出部分每 10 秒加 10 积分（不足 10 秒按 10 秒计）");
  });

  it("地址栏 job 参数", () => {
    expect(readJobIdFromSearch("?job=vb_123abc")).toBe("vb_123abc");
    expect(readJobIdFromSearch("job=../../x")).toBeNull();
    expect(readJobIdFromSearch("")).toBeNull();
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

  it("空态说明两种用法：直接复刻、套用拍法做新片", () => {
    const out = html(createElement(VideoBreakdownIntro));
    expect(out).toContain("拉一支片");
    expect(out).toContain("直接复刻");
    expect(out).toContain("套用它的拍法");
  });

  it("给了送入画布回调才出现两个主行动与单段按钮；配乐提示词区块常驻", () => {
    const without = html(createElement(VideoBreakdownResultView, { result: fixture, sourceUrl, clipUrls, onCopy: () => undefined }));
    expect(without).not.toContain("复刻这支片");
    expect(without).toContain("配乐提示词");
    const out = html(createElement(VideoBreakdownResultView, { result: fixture, sourceUrl, clipUrls, onCopy: () => undefined, onSendToCanvas: () => undefined }));
    expect(out).toContain("复刻这支片");
    expect(out).toContain("用这套拍法创作新片");
    expect(out.match(/data-send-segment=/g)).toHaveLength(4);
    expect(out.match(/到自由画布创作/g)).toHaveLength(4);
    expect(out).toContain("本段片段未裁好，只带复刻提示词");
    const bgm = /<pre data-bgm-prompt[^>]*>([\s\S]*?)<\/pre>/.exec(out)?.[1] || "";
    expect(decode(bgm)).toBe(buildVideoBreakdownBgmPrompt(fixture));
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

describe("可选块：镜长分布 / 手法节奏情绪 / 风格判词 / 声音拆解 / 重点时刻", () => {
  const rich = videoBreakdownFixtureRich;
  const frames = videoBreakdownFixtureRichFrames;
  const sourceUrl = "https://cdn.example.com/src.mp4";

  it("富数据符合契约", () => {
    expect(videoBreakdownSchema.parse(rich)).toEqual(rich);
  });

  it("阶段切分与重点时刻排序（截图按原下标对应）", () => {
    expect(splitArrowStages("不安 → 紧张->惊惧 ➜ 怅然")).toEqual(["不安", "紧张", "惊惧", "怅然"]);
    expect(splitArrowStages("一气呵成")).toEqual(["一气呵成"]);
    expect(sortedKeyMoments(rich, frames).map(m => [m.atSec, m.frameUrl])).toEqual([[4.2, frames[1]], [10.2, frames[0]], [15, ""]]);
    expect(sortedKeyMoments(fixture)).toEqual([]);
  });

  it("有可选块：全部渲染，镜长条形计数正确，截图为空串时只显示文字，可点击跳原片", () => {
    const out = html(createElement(VideoBreakdownResultView, { result: rich, sourceUrl, keyMomentFrameUrls: frames, onCopy: () => undefined }));
    expect(out).toContain("data-lapian-shot-lengths");
    // 8 个镜头：2.1/2.1/2.2/2.1/2.1/2.2/2.1/2.1 秒 → 全在 2–4s
    expect(Array.from(out.matchAll(/data-count="(\d+)"/g)).map(m => Number(m[1]))).toEqual([0, 8, 0, 0, 0, 0, 0]);
    for (const text of ["可复用手法", "前景遮挡制造窥视感", "节奏结构", "情绪推进", "风格判词", "快切", "声音拆解", "声音节奏", "混音", "可复用声音手法", "生成声音要素", "重点时刻", "幼兽坠入泥沼"]) expect(out).toContain(text);
    expect(out.match(/<ol[^>]*aria-label="情绪推进"/)).toBeTruthy();
    expect(out.match(/<img /g)).toHaveLength(2);
    const moments = Array.from(out.matchAll(/data-key-moment="([\d.]+)"><button/g)).map(m => Number(m[1]));
    expect(moments).toEqual([4.2, 10.2, 15]);
    expect(out).toContain("切镜");
    expect(out).toContain("00:04.2");
  });

  it("没有原片地址时重点时刻不可点击", () => {
    const out = html(createElement(VideoBreakdownResultView, { result: rich, keyMomentFrameUrls: frames, onCopy: () => undefined }));
    expect(out).not.toMatch(/data-key-moment="[\d.]+"><button/);
    expect(out).toContain("幼兽坠入泥沼");
  });

  it("无可选块：不留空壳，只有镜长分布", () => {
    const out = html(createElement(VideoBreakdownResultView, { result: fixture, sourceUrl, onCopy: () => undefined }));
    expect(out).toContain("镜长分布");
    for (const marker of ["data-lapian-craft", "data-lapian-sound", "data-lapian-key-moments", "风格判词", "声音拆解", "重点时刻"]) expect(out).not.toContain(marker);
  });

  it("导出 Markdown 带上可选块；没有时不出现", () => {
    const md = buildVideoBreakdownMarkdown(rich);
    for (const text of ["### 镜长分布", "| 2–4s | 8 |", "### 可复用手法", "### 节奏结构", "静态铺垫 → 对峙升温", "### 情绪推进", "### 风格判词", "`压迫`", "### 声音拆解", "| 生成声音要素 |", "### 重点时刻", "| 00:04.2 | 切镜 | 闪电硬切 |"]) expect(md).toContain(text);
    expect(md.indexOf("闪电硬切")).toBeLessThan(md.indexOf("张口特写"));
    const plain = buildVideoBreakdownMarkdown(fixture);
    expect(plain).toContain("### 镜长分布");
    for (const text of ["### 可复用手法", "### 声音拆解", "### 重点时刻"]) expect(plain).not.toContain(text);
  });
});

describe("口播与爆款策略（1111 可选块）", () => {
  const talking = () => {
    const v = structuredClone(fixture);
    v.overview.viralStrategy = { whyItWorks: "反常识结论 + 真实场景", hook: "第一句抛出「别再这样洗脸了」", scriptStructure: "抛痛点 → 反常识结论 → 三步做法", topicAngle: "护肤新手", titleIdeas: ["别再这样洗脸了"] };
    v.segments[0]!.speech = { transcript: "别再这样洗脸了，越洗越干。", onScreenText: "黄底大字弹出", delivery: "语速快" };
    return videoBreakdownSchema.parse(v);
  };
  it("旧结果不渲染新区块", () => {
    const out = html(createElement(VideoBreakdownResultView, { result: fixture, onCopy: () => undefined }));
    expect(out).not.toContain("data-lapian-viral-strategy");
    expect(out).not.toContain("data-segment-speech");
    expect(speechRows(fixture.segments[0]!)).toEqual([]);
    expect(viralStrategyRows(fixture)).toEqual([]);
    expect(buildVideoBreakdownMarkdown(fixture)).not.toContain("## 爆款策略");
  });
  it("有值时渲染爆款策略区块与逐段口播，复刻提示词与导出都带上台词", () => {
    const result = talking();
    const out = decode(html(createElement(VideoBreakdownResultView, { result, onCopy: () => undefined })));
    expect(out).toContain("data-lapian-viral-strategy");
    for (const label of ["爆款原因", "开头钩子", "口播 / 文案结构", "选题与受众", "标题参考"]) expect(out).toContain(label);
    expect(out).toContain('data-segment-speech="0"');
    expect(out).toContain("别再这样洗脸了，越洗越干。");
    expect(out).toContain("【台词 / 口播】别再这样洗脸了，越洗越干。");
    expect(out.indexOf("爆款策略")).toBeLessThan(out.indexOf("全片创作拆解"));
    const md = buildVideoBreakdownMarkdown(result);
    expect(md).toContain("## 爆款策略");
    expect(md).toContain("### 口播与字幕");
    expect(buildAllRecreatePromptsText(result)).toContain("【字幕花字】黄底大字弹出");
  });
});
