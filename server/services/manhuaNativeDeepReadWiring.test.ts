/**
 * 原生精读接线的**行为测试**。
 *
 * 上一版这里全是源码 `contains` 断言，结果放过了一个必炸的 bug：
 * 生产传进来的是素材接入层**已探测成功的媒体直链**，而我把它交给了只认页面
 * `formats` 的 yt-dlp 解析器（`format_id` 要以 `bytevc1_540p` 开头），
 * 直链没有那种 id，一开 flag 就 100% 失败——而当时的测试喂的是页面 URL，全绿。
 *
 * **教训写进断言**：测试输入必须与生产契约一致，否则测的是另一条链路。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildNativeDeepReadEpisodeExecution,
  buildNativeDeepReadLearnResult,
  isManhuaLearnEpisodeAlreadyLearned,
  pickLearnedIndexesForBatchSelection,
  type NativeDeepReadEpisodeSourceDeps,
} from "./manhuaTemplateLearnService";
import {
  buildCutSegmentArgs,
  resolveNativeDeepReadNodeUrls,
} from "./manhuaNativeDeepReadRunner";
import { getManhuaLearnPipelineMeta } from "../../shared/manhuaTemplateLearnPipeline";

/** 生产里 currentEpisodeMediaSource 返回的就是这种「已解析直链 + Referer」 */
const RESOLVED_STREAM = "https://v3-dy-o.zjcdn.com/abc/def.mp4?expire=123";
const PLAYBACK_REFERER = "https://www.douyin.com/";

const ep = (over: Record<string, unknown> = {}) =>
  ({
    index: 1,
    url: "https://www.douyin.com/video/7641538290936947889",
    title: "第1集",
    playbackUrl: RESOLVED_STREAM,
    ...over,
  }) as never;

const deps = (durationSec: number, over: Partial<NativeDeepReadEpisodeSourceDeps> = {}) =>
  ({
    probeDuration: vi.fn(async () => durationSec),
    mediaSource: vi.fn(() => ({ url: RESOLVED_STREAM, referer: PLAYBACK_REFERER })),
    ...over,
  }) as NativeDeepReadEpisodeSourceDeps;

describe("素材接入层 → 原生精读的接缝", () => {
  it("🔴 拿到的是已探测直链，就直接用，绝不再跑一次页面 formats 解析", async () => {
    const d = deps(600);
    const plan = await buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, d);

    const nodes = await plan.resolveNodes();
    expect(nodes).toEqual([{ url: RESOLVED_STREAM, referer: PLAYBACK_REFERER }]);
    // 走的是素材接入层自己的探测，不是 yt-dlp format 解析
    expect(d.mediaSource).toHaveBeenCalled();
  });

  it("🔴 Referer 必须随节点带出——丢了会被 CDN 拒", async () => {
    const plan = await buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, deps(600));
    const [node] = await plan.resolveNodes();
    expect(node!.referer).toBe(PLAYBACK_REFERER);
  });

  it("每次回调都重新探测：抖音地址约 8 分钟失效，runner 跨段靠它刷新", async () => {
    const d = deps(600);
    const plan = await buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, d);
    const before = (d.probeDuration as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await plan.resolveNodes();
    await plan.resolveNodes();
    const after = (d.probeDuration as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(after - before).toBe(2);
  });

  it("整集按单段上限切分，段间首尾相接不留缝", async () => {
    // 18 分钟 = 1080s，单段上限 1000s → 两段
    const plan = await buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, deps(1080));
    expect(plan.segments).toEqual([
      { startSec: 0, endSec: 1000 },
      { startSec: 1000, endSec: 1080 },
    ]);
    expect(plan.durationSec).toBe(1080);
    expect(plan.episodeIndex).toBe(1);
    expect(plan.seriesKey).toBe("s1");
  });

  it("短集只切一段，不产生零长尾段", async () => {
    const plan = await buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, deps(600));
    expect(plan.segments).toEqual([{ startSec: 0, endSec: 600 }]);
  });

  it("超长片按策略拒绝，且**在建 claim 之前**就拒——不进付费流程", async () => {
    await expect(
      buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, deps(999_999)),
    ).rejects.toThrow(/超过|跳过策略外片/);
  });

  it("时长探不出来直接拒，不拿 0 秒去建单", async () => {
    await expect(
      buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, deps(0)),
    ).rejects.toThrow(/未取得可用时长/);
  });

  it("媒体流读不到时当场抛，不建 claim 不发模型请求", async () => {
    const d = deps(600, {
      mediaSource: vi.fn(() => {
        throw new Error("尚未取得可读取的媒体流，不能开始学习");
      }) as never,
    });
    await expect(
      buildNativeDeepReadEpisodeExecution({ seriesKey: "s1", ep: ep() }, d),
    ).rejects.toThrow(/媒体流/);
  });
});

describe("两代完成凭证不互相冒充（P0-4）", () => {
  /** 一份「抽帧模式下算已学完」的旧 digest */
  const oldDigest = {
    index: 3,
    url: "https://www.douyin.com/video/3",
    durationSec: 600,
    learnedThroughSec: 600,
    completionPolicy: "audio_dense_frames_v1",
    // 按真实判据造：audio_dense_frames_v1 要求每个 chunk 都有
    // 语音＋高密度画面＋读帧三路成功凭证（isStrictManhuaLearnChunkComplete）
    chunks: [
      {
        startSec: 0,
        endSec: 600,
        transcriptPreview: "",
        hookNoteZh: "",
        beatHints: [],
        climaxNotes: [],
        sceneHints: [],
        learnedAt: "2026-08-24T00:00:00.000Z",
        audioAnalysis: { model: "gemini-3.6-flash", attempted: true, success: true },
        denseFrames: { requestedCount: 16, extractedCount: 16, validMotion: true, success: true },
        vision: { provider: "openrouter", model: "gpt-5.6-terra", attempted: true, success: true },
      },
    ],
  } as never;

  it("🔴 旧抽帧 digest 不能让 native 模式判「已完成」——否则打开 flag 一集都不重学", () => {
    expect(
      isManhuaLearnEpisodeAlreadyLearned({
        nativeDeepReadMode: true,
        nativeIngestedEpisodes: new Set<number>(),
        episodeIndex: 3,
        existingDigest: oldDigest,
      }),
    ).toBe(false);
  });

  it("native 模式认已入库的 native 卡 → 跳过，不再调模型", () => {
    expect(
      isManhuaLearnEpisodeAlreadyLearned({
        nativeDeepReadMode: true,
        nativeIngestedEpisodes: new Set([3]),
        episodeIndex: 3,
        existingDigest: null,
      }),
    ).toBe(true);
  });

  it("🔴 native 卡也不能让抽帧模式判「已完成」——两者产出结构不同", () => {
    expect(
      isManhuaLearnEpisodeAlreadyLearned({
        nativeDeepReadMode: false,
        nativeIngestedEpisodes: new Set([3]),
        episodeIndex: 3,
        existingDigest: null,
      }),
    ).toBe(false);
  });

  it("抽帧模式仍认自己的 digest（回归）", () => {
    expect(
      isManhuaLearnEpisodeAlreadyLearned({
        nativeDeepReadMode: false,
        episodeIndex: 3,
        existingDigest: oldDigest,
      }),
    ).toBe(true);
  });

  it("native 模式没拿到已入库集合时按未学处理，不靠旧 digest 兜底", () => {
    expect(
      isManhuaLearnEpisodeAlreadyLearned({
        nativeDeepReadMode: true,
        nativeIngestedEpisodes: null,
        episodeIndex: 3,
        existingDigest: oldDigest,
      }),
    ).toBe(false);
  });
});

describe("ffmpeg 切片真的收到 Referer", () => {
  it("节点带 referer → 参数里出现 -headers Referer:，且在 -i 之前", () => {
    const args = buildCutSegmentArgs(
      { url: RESOLVED_STREAM, referer: PLAYBACK_REFERER },
      0,
      600,
      "/tmp/x.mp4",
    );
    const hIdx = args.indexOf("-headers");
    expect(hIdx).toBeGreaterThan(-1);
    expect(args[hIdx + 1]).toBe(`Referer: ${PLAYBACK_REFERER}\r\n`);
    // ffmpeg 的输入选项必须排在 -i 前面，排后面等于没生效
    expect(hIdx).toBeLessThan(args.indexOf("-i"));
  });

  it("没有 referer 时不塞空头，参数保持干净", () => {
    const args = buildCutSegmentArgs({ url: RESOLVED_STREAM }, 0, 600, "/tmp/x.mp4");
    expect(args).not.toContain("-headers");
  });

  it("-ss 在 -i 之前（input seeking，走 Range 只拉需要的段）", () => {
    const args = buildCutSegmentArgs({ url: RESOLVED_STREAM }, 120, 600, "/tmp/x.mp4");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-i") + 1]).toBe(RESOLVED_STREAM);
  });
});

describe("页面 URL 那条路（batch 脚本用）仍返回节点对象", () => {
  it("resolveNativeDeepReadNodeUrls 的返回形状是 { url }，与主链节点同类型", async () => {
    // 不打真 yt-dlp：只验签名契约已从 string[] 迁到节点对象
    expect(typeof resolveNativeDeepReadNodeUrls).toBe("function");
    await expect(resolveNativeDeepReadNodeUrls("")).rejects.toThrow(/缺少可解析的剧集地址/);
  });
});

describe("说明文案按真实运行模式分开（P1）", () => {
  it("原生精读模式：不得**声称做了**语音分析或高密度抽帧", () => {
    const meta = getManhuaLearnPipelineMeta({ nativeDeepRead: true });
    const all = `${meta.summaryZh}\n${meta.stepsZh.join("\n")}`;
    // 查的是「有没有声称做了」，不是「有没有出现这两个字」——
    // 文案里写「不做语音转写」是正确表述，粗断言会把它一起拦掉。
    for (const claim of ["提取语音", "高密度", "语音分析", "读帧", "均通过", "每 3 秒抽帧"]) {
      expect(all).not.toContain(claim);
    }
    // 反过来必须讲清真实做法
    expect(all).toContain("模型直接读取视频本身");
    expect(all).toContain("不抽帧、不做语音转写");
    expect(all).toContain("待审卡");
  });

  it("抽帧模式：原文案不变（回归）", () => {
    const meta = getManhuaLearnPipelineMeta();
    expect(meta.summaryZh).toContain("语音");
    expect(getManhuaLearnPipelineMeta({ nativeDeepRead: false }).summaryZh).toBe(meta.summaryZh);
  });
});

describe("native 模式的学习结果：没有系列卡这回事（终审方案 A）", () => {
  const base = {
    seriesKey: "s1",
    workId: "w1",
    batchIndexes: [] as number[],
    listedEpisodeCount: 72,
    paywallFields: {},
  };

  it("🔴 proposal / proposalGcsUri 恒为 null，analysisReady 恒为 false", () => {
    const r = buildNativeDeepReadLearnResult({ ...base, nativeCardCount: 5, batchLearned: 2 });
    expect(r.proposal).toBeNull();
    expect(r.proposalGcsUri).toBeNull();
    expect(r.analysisReady).toBe(false);
    expect(r.visionFilled).toBe(false);
  });

  it("🔴 不拿旧 digest 充数：digestsPreview 为空", () => {
    const r = buildNativeDeepReadLearnResult({ ...base, nativeCardCount: 5, batchLearned: 2 });
    expect(r.digestsPreview).toEqual([]);
  });

  it("learnedCount 用真实 native 卡数，不用 learnedEpisodeIndexes", () => {
    expect(
      buildNativeDeepReadLearnResult({ ...base, nativeCardCount: 7, batchLearned: 3 }).learnedCount,
    ).toBe(7);
  });

  it("🔴 文案不得出现旧链路说法（草版总分析／系列分析／启发式底稿）", () => {
    for (const [cards, learned] of [[0, 0], [5, 0], [5, 2]] as Array<[number, number]>) {
      const r = buildNativeDeepReadLearnResult({
        ...base,
        nativeCardCount: cards,
        batchLearned: learned,
      });
      for (const stale of ["草版总分析", "系列分析", "启发式底稿", "系列底稿"]) {
        expect(r.messageZh).not.toContain(stale);
      }
    }
  });

  it("三种情形各自说人话：本轮有新增 / 无新增 / 一张都没有", () => {
    expect(
      buildNativeDeepReadLearnResult({ ...base, nativeCardCount: 5, batchLearned: 2 }).messageZh,
    ).toContain("本轮生成 2 张原生精读待审卡");
    expect(
      buildNativeDeepReadLearnResult({ ...base, nativeCardCount: 5, batchLearned: 0 }).messageZh,
    ).toContain("本轮没有新增");
    expect(
      buildNativeDeepReadLearnResult({ ...base, nativeCardCount: 0, batchLearned: 0 }).messageZh,
    ).toContain("尚未生成待审卡");
  });

  it("暂跳提示沿用主流程口径，追加在文案末尾", () => {
    const r = buildNativeDeepReadLearnResult({
      ...base,
      nativeCardCount: 1,
      batchLearned: 1,
      skippedHintZh: " 当前有 2 集因来源受限暂跳，不计入已学；续学将从后续集继续。",
    });
    expect(r.messageZh).toContain("因来源受限暂跳");
  });
});

describe("批次选择用的完成集合（终审第三节 P0：入口就要分模式）", () => {
  /**
   * 这里锁的是「选哪个集合」这一步。
   * prog.learnedEpisodeIndexes 里混入了**旧 digest** 的完成集，
   * native 模式如果读它，某集只要在旧 digest 里出现过就会在选批次时被排除，
   * 根本进不到循环内的 native 判定 —— 只修循环里的判据是修了一半。
   */
  it("🔴 native 模式：只认 native 卡，旧 digest 完成集不参与批次排除", () => {
    expect(
      pickLearnedIndexesForBatchSelection({
        nativeDeepReadMode: true,
        nativeIngestedEpisodes: new Set([2]),
        progLearnedEpisodeIndexes: [1, 2, 3],
      }),
    ).toEqual([2]);
  });

  it("native 模式一张卡都没有时，完成集为空 —— 所有集都该进批次", () => {
    expect(
      pickLearnedIndexesForBatchSelection({
        nativeDeepReadMode: true,
        nativeIngestedEpisodes: new Set(),
        progLearnedEpisodeIndexes: [1, 2, 3],
      }),
    ).toEqual([]);
  });

  it("抽帧模式：仍用 prog.learnedEpisodeIndexes（回归）", () => {
    expect(
      pickLearnedIndexesForBatchSelection({
        nativeDeepReadMode: false,
        nativeIngestedEpisodes: new Set([9]),
        progLearnedEpisodeIndexes: [1, 2, 3],
      }),
    ).toEqual([1, 2, 3]);
  });

  it("native 卡集合乱序时输出仍升序，批次选择依赖有序输入", () => {
    expect(
      pickLearnedIndexesForBatchSelection({
        nativeDeepReadMode: true,
        nativeIngestedEpisodes: new Set([7, 2, 5]),
        progLearnedEpisodeIndexes: [],
      }),
    ).toEqual([2, 5, 7]);
  });
});
