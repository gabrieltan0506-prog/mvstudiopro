import { describe, expect, it } from "vitest";
import {
  bgmMountParamsSchema,
  isSafePostProdVolumeExpr,
  postProdJobInputSchema,
} from "./postProdInput";

describe("bgm_mount 输入契约", () => {
  it("旧任务缺新字段时惰性补 bgmSeekSec=0，volumeExpr 保持缺省", () => {
    expect(bgmMountParamsSchema.parse({
      videoUri: "gs://b/v.mp4",
      bgmUri: "gs://b/m.mp3",
    })).toEqual({
      videoUri: "gs://b/v.mp4",
      bgmUri: "gs://b/m.mp3",
      bgmVolume: 0.48,
      entrySec: 0,
      bgmSeekSec: 0,
      fadeInSec: 0.5,
      fadeOutSec: 1,
    });
  });

  it("接收卡点表生成的硬静音、对白避让与高潮增益表达式", () => {
    const volumeExpr =
      "if(between(t,6.4,6.9),0,if(between(t,7,10.25),0.18,if(between(t,14,14.5),0.52,0.42)))";
    const parsed = postProdJobInputSchema.parse({
      action: "bgm_mount",
      params: {
        videoUri: "gs://b/v.mp4",
        bgmUri: "gs://b/m.mp3",
        entrySec: 0,
        bgmSeekSec: 5,
        volumeExpr,
      },
    });
    expect(parsed.action).toBe("bgm_mount");
    if (parsed.action !== "bgm_mount") return;
    expect(parsed.params.bgmSeekSec).toBe(5);
    expect(parsed.params.volumeExpr).toBe(volumeExpr);
  });

  it("拒绝追加滤镜、标签、引号或未知函数", () => {
    const unsafe = [
      "0;anullsink",
      "0[bg];[1:a]volume=1",
      "0':eval=frame",
      "sendcmd(t,1)",
    ];
    for (const expression of unsafe) {
      expect(isSafePostProdVolumeExpr(expression)).toBe(false);
      expect(() => bgmMountParamsSchema.parse({
        videoUri: "gs://b/v.mp4",
        bgmUri: "gs://b/m.mp3",
        volumeExpr: expression,
      })).toThrow("卡点音量表达式格式不正确");
    }
  });

  it("seek 与表达式继续受数值/长度边界约束", () => {
    expect(() => bgmMountParamsSchema.parse({
      videoUri: "gs://b/v.mp4",
      bgmUri: "gs://b/m.mp3",
      bgmSeekSec: 3601,
    })).toThrow();
    expect(() => bgmMountParamsSchema.parse({
      videoUri: "gs://b/v.mp4",
      bgmUri: "gs://b/m.mp3",
      volumeExpr: "1".repeat(4001),
    })).toThrow();
  });
});

describe("后期项目元数据契约", () => {
  const jobs = [
    { action: "concat", params: { clips: ["gs://b/1.mp4", "gs://b/2.mp4"] } },
    { action: "bgm_mount", params: { videoUri: "gs://b/1.mp4", bgmUri: "gs://b/1.wav" } },
    { action: "loudness_check", params: { videoUri: "gs://b/1.mp4" } },
    { action: "audio_extract", params: { videoUri: "gs://b/1.mp4" } },
    { action: "burn_subtitle", params: { videoUri: "gs://b/1.mp4", subtitleSrt: "字幕" } },
    { action: "audio_trim", params: { audioUri: "gs://b/1.wav", sourceStartSec: 0, sourceEndSec: 2 } },
    { action: "audio_timeline", params: { durationSec: 2, clips: [{ audioUri: "gs://b/1.wav", sourceStartSec: 0, sourceEndSec: 2, startSec: 0 }] } },
  ];
  it.each(jobs)("$action 入队和持久记录复读保留 scopeKey，兼容旧任务", (job) => {
    const parsed = postProdJobInputSchema.parse({ ...job, scopeKey: "project-1" });
    expect(parsed.scopeKey).toBe("project-1");
    expect(postProdJobInputSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(postProdJobInputSchema.parse(job).scopeKey).toBeUndefined();
  });
  it.each(jobs)("$action 仍拒绝额外字段、非字符串和超长项目标识", (job) => {
    expect(postProdJobInputSchema.safeParse({ ...job, scopeKey: "p", extra: true }).success).toBe(false);
    expect(postProdJobInputSchema.safeParse({ ...job, scopeKey: 1 }).success).toBe(false);
    expect(postProdJobInputSchema.safeParse({ ...job, scopeKey: "x".repeat(129) }).success).toBe(false);
  });
});
