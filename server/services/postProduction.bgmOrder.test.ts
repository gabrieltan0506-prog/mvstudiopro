import { describe, expect, it } from "vitest";
import type { BgmMountParams } from "../jobs/postProdInput";
import { bgmMountParamsSchema } from "../jobs/postProdInput";
import {
  beatTableToVolumeExpr,
  buildBeatTable,
  type BgmStructure,
} from "../../shared/manhuaBeatTable";
import { buildBgmFilterPlan } from "./postProduction";

const base: BgmMountParams = {
  videoUri: "gs://b/video.mp4",
  bgmUri: "gs://b/music.mp3",
  bgmVolume: 0.48,
  entrySec: 4,
  bgmSeekSec: 5,
  fadeInSec: 0.5,
  fadeOutSec: 1.2,
};

describe("BGM ffmpeg 时间线顺序", () => {
  it("卡点表产物穿过任务契约后进入真实 FFmpeg filter graph", () => {
    const structure: BgmStructure = {
      strongestAtSec: 5,
      strongestPeakDb: -0.5,
      valleyAtSec: 9,
      valleyMeanDb: -25,
      decayStartSec: 28,
      totalSec: 30,
    };
    const volumeExpr = beatTableToVolumeExpr(buildBeatTable({
      structure,
      events: [
        { atSec: 8, durationSec: 0.5, kind: "静音停顿", descZh: "全频停一拍" },
        { atSec: 12, durationSec: 2, kind: "对白窗", descZh: "对白" },
        { atSec: 18, durationSec: 0.35, kind: "断裂点", descZh: "断裂" },
      ],
      entrySec: 3,
      bgmSeekSec: 0,
      filmDurationSec: 30,
    }));
    const parsed = bgmMountParamsSchema.parse({
      videoUri: base.videoUri,
      bgmUri: base.bgmUri,
      entrySec: 3,
      bgmSeekSec: 0,
      volumeExpr,
    });
    const graph = buildBgmFilterPlan(parsed, { durationSec: 30, hasAudio: true }).filterGraph;
    expect(graph).toContain(`volume='${volumeExpr}':eval=frame`);
    expect(graph).toContain("between(t,8,8.5),0");
    expect(graph).toContain("between(t,12,14),0.18");
    expect(graph).toContain("between(t,18,18.35),0.52");
  });

  it("服务层直接收到旧任务形状时也补齐 seek/音量/淡入淡出默认值", () => {
    const plan = buildBgmFilterPlan({
      videoUri: "gs://b/video.mp4",
      bgmUri: "gs://b/music.mp3",
    }, { durationSec: 30, hasAudio: true });
    expect(plan.seekSec).toBe(0);
    expect(plan.filterGraph).toContain("atrim=start=0.000");
    expect(plan.filterGraph).toContain("volume=0.48");
    expect(plan.filterGraph).toContain("afade=t=in:st=0.000:d=0.500");
    expect(plan.filterGraph).toContain("afade=t=out:st=29.000:d=1.000");
  });

  it("严格按 seek/atrim → asetpts → adelay → volume → fade", () => {
    const graph = buildBgmFilterPlan({
      ...base,
      volumeExpr: "if(between(t,10,11),0,if(between(t,12,15),0.18,0.42))",
    }, { durationSec: 30, hasAudio: true }).filterGraph;

    const music = graph.slice(graph.indexOf("[1:a]"), graph.indexOf("[bg]"));
    const order = [
      "atrim=start=5.000",
      "asetpts=PTS-STARTPTS",
      "adelay=4000|4000",
      "volume='if(between(t,10,11),0,if(between(t,12,15),0.18,0.42))':eval=frame",
      "afade=t=in",
      "afade=t=out",
    ].map((token) => music.indexOf(token));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("旧请求没有 volumeExpr 时保持固定 bgmVolume", () => {
    const graph = buildBgmFilterPlan(base, { durationSec: 30, hasAudio: false }).filterGraph;
    expect(graph).toContain("volume=0.48");
    expect(graph).not.toContain("eval=frame");
    expect(graph).toContain("[2:a]apad");
  });

  it("淡出对齐成片尾，不因晚入场而按音乐局部时间错位", () => {
    const plan = buildBgmFilterPlan(base, { durationSec: 30, hasAudio: true });
    expect(plan.fadeOutStartSec).toBeCloseTo(28.8, 5);
    expect(plan.filterGraph).toContain("afade=t=out:st=28.800:d=1.200");
  });

  it("直接调用服务函数也拒绝滤镜注入表达式", () => {
    expect(() => buildBgmFilterPlan(
      { ...base, volumeExpr: "0;anullsink" },
      { durationSec: 30, hasAudio: true },
    )).toThrow("卡点音量表达式格式不正确");
  });
});
