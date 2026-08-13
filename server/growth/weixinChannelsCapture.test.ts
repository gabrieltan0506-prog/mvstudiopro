import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractCommentSamples,
  captureBudgetMsForVideo,
  deriveVideoDurationSeconds,
  extractVisibleTitleAndAuthor,
  extractWeixinChannelsMetrics,
  findCommentsClosePoint,
  findCommentsOpenPoint,
  findSearchInputPoint,
  hasFourVisibleMetrics,
  metricsRemainOnSameVideo,
  parseVisibleMetric,
  parseVisibleVideoClockSeconds,
  uploadPendingObservation,
  waitForVisibleVideoLoad,
} from "../../scripts/weixin-channels-capture.mts";

describe("weixin channels OCR", () => {
  it("从20%/50%/80%播放时钟推导时长，并将总采集预算限制为视频时长十分之一", () => {
    expect(parseVisibleVideoClockSeconds("当前 0:12")).toBe(12);
    expect(deriveVideoDurationSeconds([
      { progress: 0.2, text: "0:12" },
      { progress: 0.5, text: "0:30" },
      { progress: 0.8, text: "0:48" },
    ])).toBe(60);
    expect(captureBudgetMsForVideo(60)).toBe(6_000);
    expect(captureBudgetMsForVideo(600)).toBe(60_000);
  });

  it("解析中文万单位且不伪造缺失数据", () => {
    expect(parseVisibleMetric("1.2万+")).toBe(12_000);
    expect(parseVisibleMetric("没有数字")).toBeUndefined();
  });

  it("从底部横排真实数字识别四个公开指标", () => {
    const metrics = extractWeixinChannelsMetrics([
      { text: "2985", confidence: 0.99, x: 0.55, y: 0.1, width: 0.04, height: 0.03 },
      { text: "6234", confidence: 0.99, x: 0.65, y: 0.1, width: 0.04, height: 0.03 },
      { text: "2641", confidence: 0.99, x: 0.75, y: 0.1, width: 0.04, height: 0.03 },
      { text: "17", confidence: 0.99, x: 0.85, y: 0.1, width: 0.04, height: 0.03 },
    ]);
    expect(metrics).toMatchObject({ likes: 2985, shares: 6234, favorites: 2641, comments: 17 });
  });

  it("忽略画面中的 F 键和正文数字，只读取底部四项及真实标题作者", () => {
    const lines = [
      { text: "F7", confidence: 0.99, x: 0.75, y: 0.18, width: 0.03, height: 0.02 },
      { text: "AI圈都藏着掖着的好事", confidence: 0.99, x: 0.05, y: 0.11, width: 0.7, height: 0.03 },
      { text: "苏大讲AI", confidence: 0.99, x: 0.16, y: 0.07, width: 0.12, height: 0.02 },
      ...["1666", "5054", "1237", "37"].map((text, index) => ({ text, confidence: 0.99, x: 0.51 + index * 0.125, y: 0.035, width: 0.06, height: 0.02 })),
    ];
    expect(extractWeixinChannelsMetrics(lines)).toMatchObject({ likes: 1666, shares: 5054, favorites: 1237, comments: 37 });
    expect(extractVisibleTitleAndAuthor(lines)).toEqual({ title: "AI圈都藏着掖着的好事", author: "苏大讲AI" });
  });

  it("通过 OCR 文本定位搜索框而非写死屏幕坐标", () => {
    const point = findSearchInputPoint([
      { text: "搜一搜中搜索或输入网址", confidence: 0.98, x: 0.35, y: 0.92, width: 0.3, height: 0.04 },
    ]);
    expect(point?.x).toBeCloseTo(0.43);
    expect(point?.y).toBeCloseTo(0.06);
    expect(findSearchInputPoint([])).toBeNull();
  });

  it("每次切换至少等待两秒且不超过三秒", async () => {
    const startedAt = Date.now();
    const delay = await waitForVisibleVideoLoad();
    const elapsed = Date.now() - startedAt;
    expect(delay).toBeGreaterThanOrEqual(2_000);
    expect(delay).toBeLessThanOrEqual(3_000);
    expect(elapsed).toBeGreaterThanOrEqual(1_950);
  }, 4_000);

  it("由 OCR 评论标题同行推导关闭点，并在关闭后要求四项指标重新出现", () => {
    const panel = [
      { text: "评论 361", confidence: 0.99, x: 0.08, y: 0.86, width: 0.18, height: 0.04 },
      { text: "×", confidence: 0.99, x: 0.92, y: 0.86, width: 0.03, height: 0.04 },
    ];
    expect(findCommentsClosePoint(panel)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(findCommentsClosePoint([])).toBeNull();
    const metrics = ["2985", "6234", "2641", "80"].map((text, index) => ({ text, confidence: 0.99, x: 0.55 + index * 0.1, y: 0.1, width: 0.04, height: 0.03 }));
    expect(findCommentsOpenPoint(metrics)?.x).toBeGreaterThan(0.8);
    expect(hasFourVisibleMetrics(metrics)).toBe(true);
  });

  it("只提取真实评论文本并标记用户问题", () => {
    const samples = extractCommentSamples([
      { text: "评论 361", confidence: 0.99, x: 0.1, y: 0.9, width: 0.2, height: 0.04 },
      { text: "这个方法为什么有效？", confidence: 0.99, x: 0.1, y: 0.6, width: 0.5, height: 0.04 },
      { text: "回复", confidence: 0.99, x: 0.1, y: 0.5, width: 0.1, height: 0.03 },
    ]);
    expect(samples).toEqual([{ text: "这个方法为什么有效？", likeCount: undefined, signals: ["question"] }]);
  });

  it("Fly 未确认 persisted=true 时保留待传文件，确认后才删除", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wxc-upload-"));
    const pending = path.join(dir, "pending.json");
    await fs.writeFile(pending, JSON.stringify({ observationId: "obs-1" }));
    const failedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, persisted: false }), { status: 200 }));
    await expect(uploadPendingObservation({ server: "https://example.invalid", token: "token", taskId: "task-123", pendingFile: pending, fetchImpl: failedFetch })).rejects.toThrow("upload_not_persisted");
    await expect(fs.stat(pending)).resolves.toBeTruthy();
    const successFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, persisted: true }), { status: 200 }));
    await uploadPendingObservation({ server: "https://example.invalid", token: "token", taskId: "task-123", pendingFile: pending, fetchImpl: successFetch });
    await expect(fs.stat(pending)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("进度抽查时四项指标必须仍属于同一视频", () => {
    const base = { likes: 4_855, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] };
    expect(metricsRemainOnSameVideo(base, { likes: 4_856, shares: 1_766, favorites: 1_997, comments: 254, rawText: [] })).toBe(true);
    expect(metricsRemainOnSameVideo(base, { likes: 34_000, shares: 27_000, favorites: 9_726, comments: 2_147, rawText: [] })).toBe(false);
  });
});
