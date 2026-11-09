/**
 * 营销/知识口播「制作稿 → 段落时间线 → 配音 → 后期导出」纯逻辑。
 * 正向：多种制作稿写法切段、图库/上传两种来源绑定、配音回执、贴装与拼接参数、刷新恢复与找回任务、署名。
 * 反向：空稿/超段/纯画面、非营销或参考用途或照片的图库资产、非本人上传路径、口播改动后旧配音过期、
 *       画面短于配音、贴装未完成不得拼接、非法草稿不恢复、签名地址不入稿。
 */
import { describe, expect, it } from "vitest";
import type { StockFootageAssetView } from "./stockFootage";
import {
  MARKETING_PRODUCTION_MAX_SEGMENTS,
  applyPostProdJobResult,
  auditMarketingExport,
  buildMarketingSubtitleSrt,
  carryOverSegmentBindings,
  extractMarketingScriptSection,
  findRecoveredPostProdJob,
  mapWithConcurrency,
  marketingSegmentTargetSec,
  marketingSegmentTitle,
  marketingStockSourceText,
  marketingTrimIssue,
  marketingTrimOverrunSec,
  marketingVoiceTrackState,
  marketingConcatInput,
  marketingCreditLines,
  marketingDialogueRequest,
  marketingMountInput,
  marketingMountKey,
  marketingCloneVoiceStorageKey,
  marketingProductionScopeKey,
  marketingProductionStorageKey,
  marketingSegmentClipSec,
  marketingVisualRef,
  marketingVoiceFromDialogue,
  newMarketingProductionDraft,
  nextMarketingExportStep,
  marketingFinalDone,
  parseMarketingProductionDraft,
  segmentMarketingScript,
  stockVisualFromAsset,
  uploadVisualFromFile,
  type MarketingProductionDraft,
  type MarketingSegment,
} from "./marketingProduction";

const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const VOICE_REQ = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = `sf_${"a".repeat(48)}`;
const UPLOAD = "gs://bucket-a/uploads/u7/1111-product.mp4";

function stockAsset(overrides: Partial<StockFootageAssetView> = {}): StockFootageAssetView {
  return {
    assetId: ASSET_ID, requestId: "11111111-1111-4111-8111-111111111111", kind: "video", purpose: "marketing", usage: "insert",
    gcsUri: `gs://bucket-a/stock-footage/7/${ASSET_ID}.mp4`, mimeType: "video/mp4", bytes: 1000, sha256: "c".repeat(64),
    width: 1080, height: 1920, durationSec: 12,
    source: { provider: "pexels", providerAssetId: "123", pageUrl: "https://www.pexels.com/video/123/", author: { name: "Ann", url: "https://www.pexels.com/@ann" },
      license: { name: "Pexels License", url: "https://www.pexels.com/license/" }, downloadedFrom: "https://videos.pexels.com/x.mp4",
      providerFileId: "9", retrievedAt: "2026-11-08T00:00:00Z" },
    context: { segmentId: "seg_1" }, adoptedAt: "2026-11-08T00:00:00Z",
    url: "https://storage.googleapis.com/bucket-a/stock-footage/7/x.mp4?X-Goog-Signature=abc",
    ...overrides,
  };
}

function readySegment(id: string, narration: string, visual: MarketingSegment["visual"], voiceSec = 4): MarketingSegment {
  return {
    segmentId: id, narration, visualHint: "", estimatedSec: 3, visual,
    voice: { billingRequestId: VOICE_REQ, voice: "v1", narration, status: "succeeded", gcsUri: `gs://bucket-a/post-prod/7/dialogue/dlg_${id}.wav`, durationSec: voiceSec },
  };
}

function readyDraft(): MarketingProductionDraft {
  const draft = newMarketingProductionDraft(DRAFT_ID, "2026-11-08T00:00:00Z");
  return {
    ...draft,
    segments: [
      readySegment("seg_1", "每天一杯好咖啡，从选豆开始。", stockVisualFromAsset(stockAsset())),
      readySegment("seg_2", "水温九十二度，闷蒸三十秒。", uploadVisualFromFile({ gcsUri: UPLOAD, fileName: "product.mp4", mimeType: "video/mp4", durationSec: 6 }), 5),
    ],
  };
}

function withMountsDone(draft: MarketingProductionDraft): MarketingProductionDraft {
  const mounts: MarketingProductionDraft["mounts"] = {};
  for (const segment of draft.segments)
    mounts[segment.segmentId] = { key: marketingMountKey(draft, segment), status: "succeeded", jobId: `job_${segment.segmentId}`, gcsUri: `gs://bucket-a/post-prod/7/mount_${segment.segmentId}.mp4` };
  return { ...draft, mounts };
}

describe("制作稿 → 段落时间线（正向）", () => {
  it("从完整方案里只取口播/分镜小节", () => {
    const md = "# 方案\n目标人群：白领\n## 口播脚本\n第1段\n口播：你好\n## 发布建议\n周五发";
    expect(extractMarketingScriptSection(md)).toBe("第1段\n口播：你好");
    expect(extractMarketingScriptSection("# 方案\n只有定位")).toBe("");
  });

  it("带段落标记 + 口播/画面标注：段落标题不进配音，画面进素材提示", () => {
    const r = segmentMarketingScript("说明文字\n第1段：开场\n画面：咖啡豆特写\n口播：每天一杯好咖啡。\n时长：3秒\n第2段\n1. 画面：冲泡 口播：水温九十二度。");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments.map(s => s.narration)).toEqual(["每天一杯好咖啡。", "水温九十二度。"]);
    expect(r.segments[0].visualHint).toBe("咖啡豆特写");
    expect(r.segments[0].segmentId).toBe("seg_1");
    expect(r.segments[0].estimatedSec).toBeGreaterThan(0);
  });

  it("带标记不标注时段内正文都算口播", () => {
    const r = segmentMarketingScript("【开场】\n今天聊聊咖啡\n【结尾】\n关注我");
    expect(r.ok && r.segments.map(s => s.narration)).toEqual(["今天聊聊咖啡", "关注我"]);
  });

  it("Markdown 分镜表按口播列与画面列切段", () => {
    const r = segmentMarketingScript("| 镜号 | 画面 | 口播 |\n|---|---|---|\n| 1 | 咖啡豆 | 选豆很关键 |\n| 2 | 冲泡 | 水温要稳 |");
    expect(r.ok && r.segments.map(s => [s.narration, s.visualHint])).toEqual([["选豆很关键", "咖啡豆"], ["水温要稳", "冲泡"]]);
  });

  it("没有标记时按空行分段；纯画面段被计数丢弃", () => {
    const r = segmentMarketingScript("第一句话。\n\n画面：空镜\n\n第二句话。");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments.map(s => s.narration)).toEqual(["第一句话。", "第二句话。"]);
    expect(r.droppedVisualOnly).toBe(1);
  });

  it("重新转换时沿用口播一字不差段落的画面与配音", () => {
    const old = readyDraft().segments;
    const next = segmentMarketingScript("每天一杯好咖啡，从选豆开始。\n\n新加的一句。");
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const merged = carryOverSegmentBindings(old, next.segments);
    expect(merged[0].visual?.source).toBe("stock");
    expect(merged[0].voice?.status).toBe("succeeded");
    expect(merged[1].visual).toBeUndefined();
  });
});

describe("制作稿 → 段落时间线（反向）", () => {
  it("空稿、只有画面、超过 12 段都明确拒绝", () => {
    expect(segmentMarketingScript("  ").ok).toBe(false);
    expect(segmentMarketingScript("第1段\n画面：空镜").ok).toBe(false);
    const many = Array.from({ length: MARKETING_PRODUCTION_MAX_SEGMENTS + 1 }, (_, i) => `第${i + 1}句。`).join("\n\n");
    const r = segmentMarketingScript(many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("最多 12 段");
  });
});

describe("段落画面：图库与用户上传（区分来源）", () => {
  it("图库素材只存 assetId 与署名证据，不存签名地址", () => {
    const visual = stockVisualFromAsset(stockAsset());
    expect(visual).toMatchObject({ source: "stock", assetId: ASSET_ID, attribution: "Ann / Pexels" });
    expect(JSON.stringify(visual)).not.toContain("X-Goog-Signature");
    expect(JSON.stringify(visual)).not.toContain("videos.pexels.com");
    expect(marketingVisualRef(visual)).toBe(`stock:${ASSET_ID}`);
  });

  it("上传素材以本人上传 gs:// 进入后期", () => {
    const visual = uploadVisualFromFile({ gcsUri: UPLOAD, fileName: "p.mp4", mimeType: "video/mp4", durationSec: 6 });
    expect(visual.source).toBe("upload");
    expect(marketingVisualRef(visual)).toBe(UPLOAD);
  });

  it("反向：非营销用途、参考用途、照片、无时长的图库资产被拒", () => {
    expect(() => stockVisualFromAsset(stockAsset({ purpose: "mv" }))).toThrow("不是为营销");
    expect(() => stockVisualFromAsset(stockAsset({ usage: "reference" }))).toThrow("参考用途");
    expect(() => stockVisualFromAsset(stockAsset({ kind: "photo" }))).toThrow("视频素材");
    expect(() => stockVisualFromAsset(stockAsset({ durationSec: undefined }))).toThrow("时长");
    expect(() => stockVisualFromAsset(stockAsset({ assetId: "sf_123" }))).toThrow("编号无效");
  });

  it("反向：非本人上传前缀、越界路径、非视频、无时长被拒", () => {
    const base = { fileName: "p.mp4", mimeType: "video/mp4", durationSec: 6 };
    expect(() => uploadVisualFromFile({ ...base, gcsUri: "gs://bucket-a/stock-footage/7/x.mp4" })).toThrow("地址无效");
    expect(() => uploadVisualFromFile({ ...base, gcsUri: "https://evil.example/x.mp4" })).toThrow("地址无效");
    expect(() => uploadVisualFromFile({ ...base, gcsUri: "gs://bucket-a/uploads/u7/../u8/x.mp4" })).toThrow("地址无效");
    expect(() => uploadVisualFromFile({ ...base, gcsUri: UPLOAD, mimeType: "image/png" })).toThrow("视频");
    expect(() => uploadVisualFromFile({ ...base, gcsUri: UPLOAD, durationSec: 0 })).toThrow("时长");
  });
});

describe("配音（复用 canvasAudio.generateDialogue）", () => {
  const segment = readyDraft().segments[0];
  it("请求整段口播、speakerId 绑定草稿与段落", () => {
    const request = marketingDialogueRequest(readyDraft(), segment, "qwen-tts-plus:longxiaochun", VOICE_REQ);
    expect(request).toEqual({ billingRequestId: VOICE_REQ, input: segment.narration, voice: "qwen-tts-plus:longxiaochun", speakerZh: "口播讲述者", speakerId: `mk-${DRAFT_ID}-seg_1`, voiceStateZh: "" });
  });
  it("回执只存 gcsUri 与时长，不存签名地址", () => {
    const base = { billingRequestId: VOICE_REQ, voice: "v1", narration: segment.narration, status: "submitted" as const };
    const voice = marketingVoiceFromDialogue(base, { jobId: "dlg_1", status: "succeeded", creditsCost: 40, result: { gcsUri: "gs://bucket-a/post-prod/7/dialogue/dlg_1.wav", durationSec: 3.2, audioUrl: "https://signed" } as never });
    expect(voice).toMatchObject({ status: "succeeded", gcsUri: "gs://bucket-a/post-prod/7/dialogue/dlg_1.wav", durationSec: 3.2, jobId: "dlg_1", creditsCost: 40 });
    expect(JSON.stringify(voice)).not.toContain("https://signed");
  });
  it("反向：待核对记为 unknown；成功但缺音频不当作成功；没有口播或声线不提交", () => {
    const base = { billingRequestId: VOICE_REQ, voice: "v1", narration: "x", status: "submitted" as const };
    expect(marketingVoiceFromDialogue(base, { status: "reconcile_manual" }).status).toBe("unknown");
    expect(marketingVoiceFromDialogue(base, { status: "succeeded", result: { gcsUri: "https://x" } }).status).toBe("unknown");
    expect(() => marketingDialogueRequest(readyDraft(), { ...segment, narration: " " }, "v1", VOICE_REQ)).toThrow("没有口播");
    expect(() => marketingDialogueRequest(readyDraft(), segment, "", VOICE_REQ)).toThrow("声线");
  });
});

describe("导出：逐段贴装配音 → 拼接 + 同步字幕（复用 bgm_mount / concat）", () => {
  it("贴装参数：画面引用 + 本段配音满音量，不避让不淡入淡出", () => {
    const draft = readyDraft();
    const mount = marketingMountInput(draft, draft.segments[0]);
    expect(mount).toEqual({
      action: "bgm_mount", scopeKey: `marketing:${DRAFT_ID}`,
      params: { videoUri: `stock:${ASSET_ID}`, bgmUri: "gs://bucket-a/post-prod/7/dialogue/dlg_seg_1.wav", bgmVolume: 1, entrySec: 0, bgmSeekSec: 0, bgmDurationSec: 4, fadeInSec: 0, fadeOutSec: 0, duckUnderDialogue: false },
    });
    expect(marketingMountInput(draft, draft.segments[1]).params.videoUri).toBe(UPLOAD);
    expect(marketingProductionScopeKey(DRAFT_ID).length).toBeLessThanOrEqual(128);
  });

  it("编排：先贴装全部段落 → 拼接 → 完成", () => {
    const draft = readyDraft();
    expect(nextMarketingExportStep(draft)).toEqual({ kind: "mount", segmentIds: ["seg_1", "seg_2"] });
    const mounted = withMountsDone(draft);
    expect(nextMarketingExportStep(mounted)).toEqual({ kind: "concat" });
    const concat = marketingConcatInput(mounted);
    expect(concat.params.clips).toEqual(["gs://bucket-a/post-prod/7/mount_seg_1.mp4", "gs://bucket-a/post-prod/7/mount_seg_2.mp4"]);
    expect(concat.params.trims).toEqual([{ startSec: 0, endSec: 4.3 }, { startSec: 0, endSec: 5.3 }]);
    expect(concat.params).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    expect(concat.params.subtitleSrt).toContain("00:00:00,000 -->");
    expect(concat.params.subtitleSrt).toContain("水温九十二度");
    const queued = { ...mounted, final: { key: JSON.stringify(concat), status: "queued" as const, jobId: "job_final" } };
    expect(nextMarketingExportStep(queued)).toEqual({ kind: "wait", reason: "成片拼接处理中" });
    const done = { ...queued, final: applyPostProdJobResult(queued.final, { status: "succeeded", output: { gcsUri: "gs://bucket-a/post-prod/7/final.mp4", url: "https://signed", durationSec: 9.6 } }) };
    expect(nextMarketingExportStep(done)).toEqual({ kind: "done" });
    expect(JSON.stringify(done.final)).not.toContain("https://signed");
  });

  it("反向：贴装实测时长短于入点+配音时，编排返回阻断而不是抛错（审查阻断 1108，防面板渲染崩溃）", () => {
    const mounted = withMountsDone(readyDraft());
    const first = mounted.segments[0];
    const short = { ...mounted, mounts: { ...mounted.mounts, [first.segmentId]: { ...mounted.mounts[first.segmentId], durationSec: 3.96 } } };
    const step = nextMarketingExportStep(short);
    expect(step.kind).toBe("blocked");
    expect(step.kind === "blocked" && step.issues[0]).toContain("3.96 秒");
    expect(marketingFinalDone(short)).toBe(false);
  });

  it("字幕时间不越过本段取段时长，第二段从第一段结束处开始", () => {
    const srt = buildMarketingSubtitleSrt([{ text: "你好", voiceSec: 2, clipSec: 2.3 }, { text: "再见", voiceSec: 1, clipSec: 1.3 }]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:02,000\n你好\n\n2\n00:00:02,300 --> 00:00:03,300\n再见\n");
  });

  it("取段秒数 = 配音 + 0.3 秒余量，但不超过素材", () => {
    const draft = readyDraft();
    expect(marketingSegmentClipSec(draft.segments[0])).toBe(4.3);
    const tight = readySegment("s", "x", uploadVisualFromFile({ gcsUri: UPLOAD, fileName: "p", mimeType: "video/mp4", durationSec: 4.1 }), 4);
    expect(marketingSegmentClipSec(tight)).toBe(4.1);
  });

  it("反向：缺画面/配音、口播改动、画面短于配音都挡在导出前", () => {
    const draft = readyDraft();
    const edited = { ...draft, segments: [{ ...draft.segments[0], narration: "改过的口播" }, { ...draft.segments[1], visual: undefined }] };
    const issues = auditMarketingExport(edited);
    expect(issues.join("\n")).toContain("口播已修改，请重新配音");
    expect(issues.join("\n")).toContain("还没有画面");
    expect(nextMarketingExportStep(edited).kind).toBe("blocked");
    const short = { ...draft, segments: [readySegment("s", "x", uploadVisualFromFile({ gcsUri: UPLOAD, fileName: "p", mimeType: "video/mp4", durationSec: 2 }), 4)] };
    expect(auditMarketingExport(short).join("")).toContain("短于配音");
    expect(auditMarketingExport(newMarketingProductionDraft(DRAFT_ID))).toHaveLength(1);
  });

  it("反向：贴装未完成或绑定变更后旧贴装作废，不能直接拼接", () => {
    const draft = readyDraft();
    expect(() => marketingConcatInput(draft)).toThrow("贴装尚未完成");
    const mounted = withMountsDone(draft);
    const rebound = { ...mounted, segments: [{ ...mounted.segments[0], visual: uploadVisualFromFile({ gcsUri: UPLOAD, fileName: "p", mimeType: "video/mp4", durationSec: 9 }) }, mounted.segments[1]] };
    expect(nextMarketingExportStep(rebound)).toEqual({ kind: "mount", segmentIds: ["seg_1"] });
  });

  it("反向：任务失败或成功却无产物地址都记为失败", () => {
    const job = { key: "k", status: "queued" as const };
    expect(applyPostProdJobResult(job, { status: "failed", error: "ffmpeg 退出" })).toMatchObject({ status: "failed", error: "ffmpeg 退出" });
    expect(applyPostProdJobResult(job, { status: "succeeded", output: { url: "https://x" } }).status).toBe("failed");
  });
});

describe("刷新恢复与任务找回", () => {
  it("合法草稿可原样读回；非法草稿不采用", () => {
    const draft = withMountsDone(readyDraft());
    expect(parseMarketingProductionDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(parseMarketingProductionDraft({ ...draft, version: 2 })).toBeNull();
    expect(parseMarketingProductionDraft({ ...draft, segments: [{ ...draft.segments[0], visual: { source: "stock", assetId: ASSET_ID, url: "https://x" } }] })).toBeNull();
    expect(parseMarketingProductionDraft("garbage")).toBeNull();
  });

  it("提交未拿到 jobId 时按 scopeKey + 动作 + 画面引用找回最新一条", () => {
    const rows = [
      { jobId: "old", action: "bgm_mount", scopeKey: `marketing:${DRAFT_ID}`, sourceVideoUris: [`stock:${ASSET_ID}`], createdAt: "2026-11-08T00:00:00Z" },
      { jobId: "new", action: "bgm_mount", scopeKey: `marketing:${DRAFT_ID}`, sourceVideoUris: [`stock:${ASSET_ID}`], createdAt: "2026-11-08T01:00:00Z" },
      { jobId: "other", action: "bgm_mount", scopeKey: "marketing:other", sourceVideoUris: [`stock:${ASSET_ID}`], createdAt: "2026-11-08T02:00:00Z" },
    ];
    expect(findRecoveredPostProdJob(rows, { scopeKey: `marketing:${DRAFT_ID}`, action: "bgm_mount", sourceVideoUris: [`stock:${ASSET_ID}`] })).toBe("new");
    expect(findRecoveredPostProdJob(rows, { scopeKey: `marketing:${DRAFT_ID}`, action: "concat", sourceVideoUris: [`stock:${ASSET_ID}`] })).toBeNull();
  });
});

describe("本机键按登录用户隔离", () => {
  it("草稿键与声线克隆续做键都带用户；克隆键无用户直接拒绝、不再落到共享键", () => {
    expect(marketingProductionStorageKey("7")).toBe("mvs.marketingProduction.v1:7");
    expect(marketingCloneVoiceStorageKey("7")).toBe("mvs.marketing.cloneVoice.v2:7");
    expect(marketingCloneVoiceStorageKey("7")).not.toBe(marketingCloneVoiceStorageKey("8"));
    expect(() => marketingCloneVoiceStorageKey("")).toThrow("需要登录用户");
    expect(() => marketingCloneVoiceStorageKey("  ")).toThrow("需要登录用户");
  });
});

describe("成片说明：署名与用户素材分列", () => {
  it("图库逐条署名带授权链接，上传素材单列", () => {
    const credits = marketingCreditLines(readyDraft());
    expect(credits.stock).toEqual(["Ann / Pexels（https://www.pexels.com/video/123/，Pexels License https://www.pexels.com/license/）"]);
    expect(credits.uploads).toEqual(["product.mp4"]);
  });
});

describe("图库选段（抽屉入点/出点）→ 贴装与拼接真实取段", () => {
  function trimmedDraft(trim: { inSec: number; outSec: number }, voiceSec = 4): MarketingProductionDraft {
    const draft = newMarketingProductionDraft(DRAFT_ID, "2026-11-08T00:00:00Z");
    return { ...draft, segments: [readySegment("seg_1", "每天一杯好咖啡，从选豆开始。", stockVisualFromAsset(stockAsset(), trim), voiceSec)] };
  }

  it("正向：选段写入画面并可原样读回，不含签名地址", () => {
    const visual = stockVisualFromAsset(stockAsset(), { inSec: 3.25, outSec: 7.25 });
    expect(visual.trim).toEqual({ inSec: 3.25, outSec: 7.25 });
    const draft = trimmedDraft({ inSec: 3.25, outSec: 7.25 });
    expect(parseMarketingProductionDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(JSON.stringify(draft)).not.toContain("X-Goog-Signature");
  });

  it("正向：贴装 entrySec = 入点，拼接 trims 从入点取到配音结束 + 余量", () => {
    const draft = trimmedDraft({ inSec: 3, outSec: 8 });
    expect(marketingMountInput(draft, draft.segments[0]).params.entrySec).toBe(3);
    const concat = marketingConcatInput(withMountsDone(draft));
    expect(concat.params.trims).toEqual([{ startSec: 3, endSec: 7.3 }]);
    expect(concat.params.subtitleSrt).toContain("00:00:00,000 -->");
  });

  it("正向：配音落在窗口内时不越过出点", () => {
    const draft = trimmedDraft({ inSec: 2, outSec: 6.1 });
    expect(marketingSegmentClipSec(draft.segments[0])).toBe(4.1);
    expect(marketingTrimOverrunSec(draft.segments[0])).toBe(0);
    expect(marketingConcatInput(withMountsDone(draft)).params.trims).toEqual([{ startSec: 2, endSec: 6.1 }]);
  });

  it("正向：配音长于窗口时从入点顺延（不越过素材），并报告顺延秒数", () => {
    const draft = trimmedDraft({ inSec: 2, outSec: 4 }, 4);
    expect(marketingSegmentClipSec(draft.segments[0])).toBe(4.3);
    expect(marketingTrimOverrunSec(draft.segments[0])).toBe(2.3);
  });

  it("正向：贴装产物实测时长更短时取段不越界", () => {
    const draft = trimmedDraft({ inSec: 7.5, outSec: 12 }, 4.3);
    const mounted = withMountsDone(draft);
    mounted.mounts.seg_1 = { ...mounted.mounts.seg_1, durationSec: 11.9 };
    expect(marketingConcatInput(mounted).params.trims).toEqual([{ startSec: 7.5, endSec: 11.9 }]);
  });

  it("兼容：无选段的旧草稿贴装与拼接参数不变（旧任务指纹仍有效）", () => {
    const draft = readyDraft();
    expect(marketingMountInput(draft, draft.segments[0]).params.entrySec).toBe(0);
    expect(marketingConcatInput(withMountsDone(draft)).params.trims[0]).toEqual({ startSec: 0, endSec: 4.3 });
  });

  it("反向：入点 < 0、出点 ≤ 入点、出点超过素材时长、短于 0.1 秒都被拒", () => {
    expect(marketingTrimIssue({ inSec: -1, outSec: 3 }, 12)).toContain("入点");
    expect(marketingTrimIssue({ inSec: 3, outSec: 3 }, 12)).toContain("晚于入点");
    expect(marketingTrimIssue({ inSec: 3, outSec: 12.5 }, 12)).toContain("超出素材时长");
    expect(marketingTrimIssue({ inSec: 3, outSec: 3.05 }, 12)).toContain("0.1");
    expect(marketingTrimIssue({ inSec: Number.NaN, outSec: 3 }, 12)).toContain("无效");
    expect(marketingTrimIssue({ inSec: 0, outSec: 12 }, 12)).toBeNull();
    expect(() => stockVisualFromAsset(stockAsset(), { inSec: 5, outSec: 4 })).toThrow("晚于入点");
    expect(() => stockVisualFromAsset(stockAsset(), { inSec: 0, outSec: 20 })).toThrow("超出素材时长");
  });

  it("反向：篡改的草稿选段（出点越界）不恢复", () => {
    const draft = trimmedDraft({ inSec: 1, outSec: 5 });
    const bad = JSON.parse(JSON.stringify(draft));
    bad.segments[0].visual.trim = { inSec: 1, outSec: 99 };
    expect(parseMarketingProductionDraft(bad)).toBeNull();
    bad.segments[0].visual.trim = { inSec: 1, outSec: 5, url: "https://x" };
    expect(parseMarketingProductionDraft(bad)).toBeNull();
  });

  it("反向：入点之后剩余素材短于配音，导出前拦截", () => {
    const draft = trimmedDraft({ inSec: 9, outSec: 12 }, 4);
    expect(marketingSegmentClipSec(draft.segments[0])).toBeNull();
    expect(auditMarketingExport(draft).join("")).toContain("从第 9.0 秒起只剩 3.0 秒");
    expect(nextMarketingExportStep(draft).kind).toBe("blocked");
  });

  it("反向：贴装产物实测时长放不下配音时拒绝拼接", () => {
    const draft = trimmedDraft({ inSec: 8, outSec: 12 }, 4);
    const mounted = withMountsDone(draft);
    mounted.mounts.seg_1 = { ...mounted.mounts.seg_1, durationSec: 11.5 };
    expect(() => marketingConcatInput(mounted)).toThrow("请重新选段");
    expect(nextMarketingExportStep(mounted)).toMatchObject({ kind: "blocked" });
  });
});

describe("找素材入口辅助", () => {
  it("目标时长：有效配音用实测，否则用预估；口播改过后回到预估", () => {
    const seg = readySegment("s", "你好", undefined, 4.6);
    expect(marketingSegmentTargetSec(seg)).toBe(4.6);
    expect(marketingSegmentTargetSec({ ...seg, narration: "改了" })).toBe(3);
  });
  it("关键词原文含画面提示与口播，且不超过 1000 字；标题取画面提示", () => {
    expect(marketingStockSourceText({ visualHint: "咖啡豆特写", narration: "选豆很关键" })).toBe("画面：咖啡豆特写\n口播：选豆很关键");
    expect(marketingStockSourceText({ visualHint: "", narration: "长".repeat(2000) }).length).toBe(1000);
    expect(marketingSegmentTitle({ visualHint: "咖啡豆特写", narration: "x" })).toBe("咖啡豆特写");
    expect(marketingSegmentTitle({ visualHint: "", narration: "一二三四五六七八九十一二三四五六七八" })).toBe("一二三四五六七八九十一二三四五六…");
  });
  it("并发上限：同时进行不超过 3 个，结果保序，单项失败不影响其他", async () => {
    let active = 0; let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      if (n === 4) throw new Error("boom");
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results.map(r => (r.ok ? r.value : "x"))).toEqual([10, 20, 30, "x", 50, 60, 70]);
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });
});

describe("旁白轨状态", () => {
  it("正向：已配音显示实测时长；待配音/生成中", () => {
    const seg = readySegment("s", "你好", undefined, 4.25);
    expect(marketingVoiceTrackState(seg)).toEqual({ tone: "ready", label: "已配音 4.3 秒" });
    expect(marketingVoiceTrackState({ ...seg, voice: undefined })).toEqual({ tone: "empty", label: "待配音" });
    expect(marketingVoiceTrackState({ ...seg, voice: { ...seg.voice!, status: "running" } }).tone).toBe("pending");
  });
  it("反向：口播改过、失败、成功却缺音频都不算已配音", () => {
    const seg = readySegment("s", "你好", undefined, 4);
    expect(marketingVoiceTrackState({ ...seg, narration: "改了" }).tone).toBe("stale");
    expect(marketingVoiceTrackState({ ...seg, voice: { ...seg.voice!, status: "failed" } }).tone).toBe("failed");
    expect(marketingVoiceTrackState({ ...seg, voice: { ...seg.voice!, gcsUri: undefined } }).tone).toBe("pending");
  });
});
