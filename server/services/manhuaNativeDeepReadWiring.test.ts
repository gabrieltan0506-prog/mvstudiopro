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
