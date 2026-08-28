import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MANHUA_NATIVE_AUDIO_CUE_KINDS,
  isManhuaNativeAudioGateFailureZh,
  mergeManhuaNativeAudioChunks,
  normalizeManhuaNativeAudioChunkAnalysis,
  parseManhuaNativeAudioAnalysis,
  stripClockTextZh,
  type ManhuaNativeAudioTrack,
} from "./manhuaNativeAudioAnalysis";

const track = (fromSec: number): ManhuaNativeAudioTrack => ({
  fromSec,
  toSec: fromSec + 1,
  emotionArcZh: `情绪${fromSec}`,
  toneZh: "克制",
  sfxZh: "",
  bgmZh: "低频",
  atmosphereZh: "压迫",
  silenceZh: "",
  cues: [],
});

describe("原生精读音轨合并", () => {
  it("0827 定稿的 11 种声音事件全部能通过共享解析门", () => {
    const normalized = normalizeManhuaNativeAudioChunkAnalysis({
      raw: {
        audioTrack: [{
          ...track(0),
          toSec: 11,
          cues: MANHUA_NATIVE_AUDIO_CUE_KINDS.map((kind, atSec) => ({
            atSec,
            kind,
            detailZh: `${kind} 证据`,
          })),
        }],
        audioBeatStructureZh: "声音连续推进",
        mixNotesZh: "空间层次清楚",
        reusableAudioZh: "按变化证据组织声音",
        genAudioHintZh: "保留声画关系",
      },
      chunk: { index: 0, startSec: 0, endSec: 11 },
    });
    expect(normalized.audioTrack[0]?.cues.map((cue) => cue.kind))
      .toEqual(MANHUA_NATIVE_AUDIO_CUE_KINDS);
  });

  it("超过旧128段预算时仍逐条保留音轨与事件，不做合并或截断", () => {
    const durationSec = 135;
    const merged = mergeManhuaNativeAudioChunks({
      durationSec,
      chunks: [{
        audioTrack: Array.from({ length: durationSec }, (_, index) => ({
          ...track(index),
          cues: [{ atSec: index, kind: "sfx" as const, detailZh: `事件${index}` }],
        })),
        audioBeatStructureZh: "持续推进",
        mixNotesZh: "人声居中",
        reusableAudioZh: "连续增强",
        genAudioHintZh: "保留层次",
      }],
      usage: {
        inputTokens: 10,
        audioInputTokens: 8,
        outputTokens: 2,
        costCny: 0.01,
        receiptComplete: true,
        geminiInputTokens: 10,
        geminiAudioInputTokens: 8,
        geminiOutputTokens: 2,
        geminiCostCny: 0.01,
        geminiCalls: 2,
      },
    });
    expect(merged.audioTrack).toHaveLength(durationSec);
    expect(merged.audioTrack.flatMap((row) => row.cues)).toHaveLength(durationSec);
    expect(merged.audioTrack[129]?.emotionArcZh).toBe("情绪129");
    expect(merged.audioTrack[129]?.cues[0]?.detailZh).toBe("事件129");
    expect(merged.audioTrack[0]?.fromSec).toBe(0);
    expect(merged.audioTrack.at(-1)?.toSec).toBe(durationSec);
    expect(merged.audioTrack.every((row, index, rows) =>
      index === 0 || row.fromSec === rows[index - 1]?.toSec,
    )).toBe(true);
    expect(parseManhuaNativeAudioAnalysis(merged)).toBeDefined();
  });
});

describe("stripClockTextZh 文本秒位剥离", () => {
  it("剥离钟表秒位及挂在其上的连接残渣", () => {
    expect(stripClockTextZh("在01:23处鼓点加强")).toBe("鼓点加强");
    expect(stripClockTextZh("01:23-01:40 副歌")).toBe("副歌");
    expect(stripClockTextZh("配乐于1:05:30左右切入")).toBe("配乐切入");
  });

  it("区间形式整段消除，不留连字符残渣", () => {
    expect(stripClockTextZh("00:10-00:25 低频铺底，随后收束")).toBe("低频铺底，随后收束");
    expect(stripClockTextZh("从3:05至4:10情绪递进")).toBe("从情绪递进");
  });

  it("无秒位文本原样返回（含普通数字与比分）", () => {
    expect(stripClockTextZh("鼓点在第80秒加强")).toBe("鼓点在第80秒加强");
    expect(stripClockTextZh("")).toBe("");
  });

  it("全角冒号不在 CLOCK_RE 口径内，镜像保留不扩权", () => {
    expect(stripClockTextZh("０１：２３ 副歌")).toBe("０１：２３ 副歌");
  });
});

describe("normalize 写入路：先剥离再入库（0826 拍板）", () => {
  const rawChunk = {
    audioTrack: [{
      fromSec: 0,
      toSec: 10,
      emotionArcZh: "在01:23处鼓点加强",
      toneZh: "克制",
      sfxZh: "01:23-01:40 副歌",
      bgmZh: "低频铺底",
      atmosphereZh: "压迫",
      silenceZh: "",
      cues: [{ atSec: 3, kind: "sfx", detailZh: "在00:03处玻璃碎裂" }],
    }],
    audioBeatStructureZh: "前段克制，02:00左右增强",
    mixNotesZh: "人声居中",
    reusableAudioZh: "先压低背景再抬人声",
    genAudioHintZh: "保留动态层次",
  };

  afterEach(() => vi.restoreAllMocks());

  it("含秒位文本被剥离后照常入库，数字时间轴保持不动，cues.detailZh 一并纳入", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const normalized = normalizeManhuaNativeAudioChunkAnalysis({
      raw: rawChunk,
      chunk: { index: 1, startSec: 100, endSec: 110 },
    });
    expect(normalized.audioTrack[0]).toMatchObject({
      fromSec: 100,
      toSec: 110,
      emotionArcZh: "鼓点加强",
      sfxZh: "副歌",
    });
    expect(normalized.audioTrack[0]?.cues[0]).toMatchObject({ atSec: 103, detailZh: "玻璃碎裂" });
    expect(normalized.audioBeatStructureZh).toBe("前段克制，增强");
    expect(warn).toHaveBeenCalledWith(
      "[nativeAudioAnalysis] 已剥离文本秒位 4 处（数字时间轴为唯一真源）",
    );
  });

  it("数字时间轴校验仍是硬门禁：cue 越界照抛", () => {
    expect(() => normalizeManhuaNativeAudioChunkAnalysis({
      raw: {
        ...rawChunk,
        audioTrack: [{
          ...rawChunk.audioTrack[0],
          cues: [{ atSec: 99, kind: "sfx", detailZh: "越界" }],
        }],
      },
      chunk: { index: 0, startSec: 0, endSec: 10 },
    })).toThrow("音频事件秒位不属于声明区间");
  });

  it("必填字段剥离后为空则拒绝入库", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => normalizeManhuaNativeAudioChunkAnalysis({
      raw: {
        ...rawChunk,
        audioTrack: [{ ...rawChunk.audioTrack[0], emotionArcZh: "01:02" }],
      },
      chunk: { index: 0, startSec: 0, endSec: 10 },
    })).toThrow("剥离文本秒位后正文为空");
  });
});

describe("读取门保持 assertNoClockText 不变（存量/手改卡防线）", () => {
  const storedCard = () => mergeManhuaNativeAudioChunks({
    durationSec: 10,
    chunks: [{
      audioTrack: [{
        fromSec: 0, toSec: 10, emotionArcZh: "平稳到增强", toneZh: "克制",
        sfxZh: "", bgmZh: "低频", atmosphereZh: "压迫", silenceZh: "", cues: [],
      }],
      audioBeatStructureZh: "持续推进",
      mixNotesZh: "人声居中",
      reusableAudioZh: "连续增强",
      genAudioHintZh: "保留层次",
    }],
    usage: {
      inputTokens: 10, audioInputTokens: 8, outputTokens: 2, costCny: 0.01,
      receiptComplete: true, geminiInputTokens: 10, geminiAudioInputTokens: 8,
      geminiOutputTokens: 2, geminiCostCny: 0.01, geminiCalls: 2,
    },
  });

  it("已存卡含钟表秒位仍被整卡拒读", () => {
    const trackTampered = storedCard();
    trackTampered.audioTrack[0]!.bgmZh = "低频在01:23切入";
    expect(parseManhuaNativeAudioAnalysis(trackTampered)).toBeUndefined();

    const summaryTampered = storedCard();
    summaryTampered.audioBeatStructureZh = "02:00 后推进";
    expect(parseManhuaNativeAudioAnalysis(summaryTampered)).toBeUndefined();
  });

  it("门禁重试多计的已付费调用不再触发整卡拒读（下限仍在）", () => {
    const retried = storedCard();
    retried.usage.geminiCalls = 3;
    expect(parseManhuaNativeAudioAnalysis(retried)).toBeDefined();
    const incomplete = storedCard();
    incomplete.usage.geminiCalls = 1;
    expect(parseManhuaNativeAudioAnalysis(incomplete)).toBeUndefined();
  });
});

describe("门禁类失败判定", () => {
  it("normalize/校验类中文错误算门禁失败；网络与中止不算", () => {
    expect(isManhuaNativeAudioGateFailureZh(new Error("音频分析时间轴存在未解释空洞"))).toBe(true);
    expect(isManhuaNativeAudioGateFailureZh(new Error("音频事件秒位不属于声明区间"))).toBe(true);
    expect(isManhuaNativeAudioGateFailureZh(new Error("音频描述剥离文本秒位后正文为空，拒绝入库"))).toBe(true);
    expect(isManhuaNativeAudioGateFailureZh(new Error("声音理解请求超过12分钟"))).toBe(false);
    expect(isManhuaNativeAudioGateFailureZh(new Error("用户已停止学习"))).toBe(false);
    expect(isManhuaNativeAudioGateFailureZh(new Error("mono failed"))).toBe(false);
  });

  it("审查#3：相邻数字拼出的新钟表文本被多轮剥净；标点残渣收敛", () => {
    expect(stripClockTextZh("2在1:05处:15")).toBe("");
    expect(stripClockTextZh("在01:23处鼓点，，在02:10处收")).toBe("鼓点，收");
  });
});
