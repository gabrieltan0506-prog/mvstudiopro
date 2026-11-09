import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { compileMvShotTimedPrompt, mvCastFromCreative, mvPrevisClipRange, mvShotGenerateDurationSec } from "./canvasMusicMvShotPrompt";
import { MUSIC_MV_BEATS_INSTRUCTIONS } from "./musicMvCraft";
import type { MvShotReferences } from "./canvasMusicMvReferences";
import type { MusicMvShotBeat } from "./canvasMusicMv";

const refs: MvShotReferences = {
  anchorImage: { gcsUri: "gs://b/anchor.png", label: "生成的主角定妆帧" },
  sceneImages: [{ gcsUri: "gs://b/s1.jpg", label: "A / Pexels" }, { gcsUri: "gs://b/s2.jpg", label: "B / Pexels" }],
  motionVideos: [{ source: "stock", gcsUri: "gs://b/m.mp4", inSec: 0, outSec: 6, durationSec: 12, label: "C / Pexels" }],
  songSlice: { jobId: "j", gcsUri: "gs://b/slice.wav", startSec: 150, endSec: 156.2 },
};
const w = (a: number, b: number, extra: Partial<MusicMvShotBeat> = {}): MusicMvShotBeat => ({
  startSec: a, endSec: b, actionZh: `动作${a}`, cameraZh: `运镜${a}`, lightingZh: `灯光${a}`, moodZh: `情绪${a}`, sfxZh: `雨声${a}`, ...extra,
});
const ctx = (over: Partial<Parameters<typeof compileMvShotTimedPrompt>[1]> = {}) => ({
  engine: "seedance-2.0-mini" as const, modelLabel: "Seedance 2.0 mini（草稿档）", resolution: "480p", aspectRatio: "9:16" as const,
  generateDurationSec: 8, beatGrid: { bpm: 129, beatSec: 60 / 129 }, references: refs, ...over,
});

describe("MV 秒锁编译：只排版顾问逐窗节拍（A 段版式）", () => {
  it("逐窗原样落版，窗标题带歌曲绝对秒，尾停窗补到生成时长，段时长可被既有解析器读出", () => {
    const out = compileMvShotTimedPrompt(
      { shotId: "c1s12", startSec: 150, endSec: 156.2, visualPrompt: "她在便利店玻璃前", cameraPrompt: "中景推近", beats: [w(150, 152.33), w(152.33, 154.19), w(154.19, 156.2)] },
      ctx(),
    );
    expect(out.degraded).toBe(false);
    expect(out.windows.map(x => x.role)).toEqual(["beat", "beat", "beat", "tail"]);
    expect(out.text).toContain("【第01段·8s】");
    expect(out.text).toContain("0–2.3秒｜c1s12-W1（歌曲 150–152.3 秒）");
    expect(out.text).toContain("人物、视线与动作：动作152.33");
    expect(out.text).toContain("景别与运镜：运镜154.19");
    expect(out.text).toContain("灯光与氛围：灯光150");
    expect(out.text).toContain("情绪与转折：情绪150");
    expect(out.text).toContain("<雨声150；无音乐、无人声>");
    expect(out.text).toContain("6.2–8秒｜c1s12尾停（不入片）");
    expect(out.text).toContain("@图片1＝全片主锚图（生成的主角定妆帧）");
    expect(out.text).toContain("@视频1＝运镜参考片（C / Pexels），取 0–6 秒；只继承站位、景别、机位运动与动作节拍，不继承外观");
    expect(out.text).toContain("@音频1＝本镜歌曲切片（原歌 150–156.2 秒），仅作节拍卡点参考");
    expect(out.text).toContain("1拍约 465 毫秒");
    expect(out.text).toContain("129 BPM");
    expect(out.issues.filter(i => i.kind !== "censor")).toEqual([]);
  });

  it("旧方案无逐窗字段：整镜一窗降级并标注，不按标点拆句", () => {
    const out = compileMvShotTimedPrompt({ shotId: "s1", startSec: 0, endSec: 5, visualPrompt: "她走过天桥，雨停了，回头", cameraPrompt: "跟拍" }, ctx({ generateDurationSec: 6 }));
    expect(out.degraded).toBe(true);
    expect(out.windows.map(x => x.role)).toEqual(["whole", "tail"]);
    expect(out.text).toContain("整镜执行正文（旧方案未出逐窗节拍）");
  });

  it("演唱段：没有逐窗节拍或没有歌词时间表即拒绝（不降级）；有确认版则唱句按 {} 对白秒锁落窗", () => {
    const base = { shotId: "sing", startSec: 60, endSec: 66, visualPrompt: "她对镜头唱", cameraPrompt: "近景", kind: "singing" as const };
    expect(() => compileMvShotTimedPrompt(base, ctx())).toThrow(/缺少逐窗节拍/);
    expect(() => compileMvShotTimedPrompt({ ...base, beats: [w(60, 63), w(63, 66)] }, ctx())).toThrow(/先确认本段歌词/);
    const out = compileMvShotTimedPrompt(
      { ...base, beats: [w(60, 63), w(63, 66)], lyricTiming: "confirmed", lyricLines: [{ text: "别爱我", startSec: 60.4, endSec: 62.1 }, { text: "又不想说", startSec: 63.0, endSec: 65.6 }] },
      ctx({ generateDurationSec: 7 }),
    );
    expect(out.text).toContain("{别爱我}");
    expect(out.text).toContain("{又不想说}");
    expect(out.text).toContain("用户确认版");
    const lip = out.windows.filter(x => x.lipSync);
    expect(lip.map(x => [x.fromSec, x.toSec])).toEqual([[0, 2.1], [3, 6]]); // 句尾到镜尾 0.4 秒 < 0.5 秒并入作换气
  });

  it("尾帧接龙占 @图片2，场景图顺延", () => {
    const out = compileMvShotTimedPrompt({ shotId: "s2", startSec: 0, endSec: 5, visualPrompt: "续", cameraPrompt: "同轴", beats: [w(0, 2.5), w(2.5, 5)], chainFromPrevious: true }, ctx({ generateDurationSec: 6 }));
    expect(out.text).toContain("@图片2＝上一镜成片尾帧");
    expect(out.text).toContain("@图片3＝本镜场景图（A / Pexels）");
    expect(out.text).toContain("@图片4＝本镜场景图（B / Pexels）");
  });

  it("H3 / Wan 用各自方言标记", () => {
    const h3 = compileMvShotTimedPrompt({ shotId: "s", startSec: 0, endSec: 4, visualPrompt: "v", cameraPrompt: "c", beats: [w(0, 2), w(2, 4)] }, ctx({ engine: "minimax-hailuo-3", generateDurationSec: 5 }));
    expect(h3.text).toContain("Image 1＝全片主锚图");
    expect(h3.text).toContain("灯光与氛围：灯光0");
    const wan = compileMvShotTimedPrompt({ shotId: "s", startSec: 0, endSec: 4, visualPrompt: "v", cameraPrompt: "c", beats: [w(0, 2), w(2, 4)] }, ctx({ engine: "wan-3.0", generateDurationSec: 5 }));
    expect(wan.text).toContain("Reference image 1＝全片主锚图");
  });
});

describe("1110 #1769 合并前必修：人物锁按角色表、对口型正脸不切镜、关键事件一窗一事、光色贯穿", () => {
  const twoCast = "雨夜街头的分手戏。\n主角：短发女生，白色风衣\n配角：高个男生，黑色夹克\n副歌转亮。";
  const slap = { shotId: "s5", startSec: 20, endSec: 26, visualPrompt: "街边雨棚下两人争执，女生打男生一巴掌，伞落地", cameraPrompt: "中景",
    beats: [w(20, 22.5, { actionZh: "女生逼近男生，抬手" }), w(22.5, 24.5, { actionZh: "女生打男生一巴掌，男生脸偏向一侧" }), w(24.5, 26, { actionZh: "伞从女生手里掉落，落地翻倒在积水里" })] };

  it("角色表解析：逐行主角/配角或「角色表：」一行", () => {
    expect(mvCastFromCreative(twoCast)).toEqual(["主角：短发女生，白色风衣", "配角：高个男生，黑色夹克"]);
    expect(mvCastFromCreative("角色表：女主：短发女生；男主：高个男生")).toEqual(["女主：短发女生", "男主：高个男生"]);
    expect(mvCastFromCreative("主角：她")).toEqual(["主角：她"]);
    expect(mvCastFromCreative("雨夜")).toEqual([]);
  });

  it("多人角色表：人物锁不再写死单人，角色表内可同框接触；单人仍按旧锁", () => {
    const multi = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast }));
    expect(multi.text).toContain("人物一致性锁（按角色表）：主角：短发女生，白色风衣；配角：高个男生，黑色夹克");
    expect(multi.text).toContain("角色表内人物可按逐窗正文同框、对手戏与肢体接触，不得删去任何一方");
    expect(multi.text).not.toContain("本镜只有同一位主角");
    expect(multi.text).not.toContain("不新增第二位清晰人物");
    const viaBinding = compileMvShotTimedPrompt(slap, ctx({ castZh: ["女主：短发女生", "男主：高个男生"] }));
    expect(viaBinding.text).toContain("人物一致性锁（按角色表）：女主：短发女生；男主：高个男生");
    const single = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: "主角：短发女生" }));
    expect(single.text).toContain("本镜只有同一位主角（主角：短发女生）");
  });

  it("锚图为身份照：只锁脸不锁服装与场景；逐窗首窗场景行只写空间", () => {
    const identity = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast, references: { ...refs, anchorImage: { gcsUri: "gs://b/me.jpg", label: "我的照片", hasRealPerson: true } } }));
    expect(identity.text).toContain("@图片1＝主角身份照（我的照片），只锁脸部骨相、年龄与发型；不继承其服装、背景、场景");
    expect(identity.text).toContain("只锁主角的脸部骨相、年龄与发型（身份照：不锁服装、背景与场景）");
    expect(identity.text).not.toContain("仅锁主角脸、年龄、体型、服装");
    expect(identity.text).toContain("空间：按@图片2、@图片3的场景空间、地标、光源方向与材质");
    expect(identity.text).not.toContain("街边雨棚下两人争执，女生打男生一巴掌");
    const keyframe = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast }));
    expect(keyframe.text).toContain("@图片1＝全片主锚图（生成的主角定妆帧），仅锁主角脸、年龄、体型、服装");
  });

  it("关键事件窗：一窗一事件、≥1.5 秒起势、写结束状态（编译文本与编排指令都有）", () => {
    const out = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast }));
    expect(out.text).toContain("关键事件窗：本窗只发生这一件事，不并列其他动作；前至少1.5秒起势");
    expect(out.text).toContain("末尾停在结束状态");
    expect(out.text.split("关键事件窗：").length - 1).toBe(3); // 头部 1 + 耳光窗 + 伞落窗
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("关键事件一窗一事件");
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("至少1.5秒起势");
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("最后写结束状态");
  });

  it("对口型窗：不切镜、正脸、禁背身/大侧脸（编译文本与编排指令都有）", () => {
    const out = compileMvShotTimedPrompt(
      { shotId: "sing", startSec: 60, endSec: 66, visualPrompt: "她对镜头唱", cameraPrompt: "近景", kind: "singing", beats: [w(60, 63), w(63, 66)], lyricTiming: "confirmed", lyricLines: [{ text: "别爱我", startSec: 60.4, endSec: 62.1 }] },
      ctx({ generateDurationSec: 7 }),
    );
    expect(out.text).toContain("对口型窗：本窗一镜到底，不切镜、不跳轴、不换景别");
    expect(out.text).toContain("禁止背身、大侧脸");
    expect(out.text).toContain("本窗不切镜，正脸或微侧对镜，禁止背身与大侧脸");
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("对口型窗内一镜到底：不切镜");
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("禁止背身、大侧脸");
    const plain = compileMvShotTimedPrompt(slap, ctx());
    expect(plain.text).not.toContain("对口型窗：");
  });

  it("光色贯穿：编排指令逐窗写光色/天气且前后连续，编译收束带连续约束", () => {
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("lightingZh＝光色与天气（每窗必写");
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("晴→阴→雨→转亮");
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).toContain("不得跳变、回退");
    expect(MUSIC_MV_BEATS_INSTRUCTIONS).not.toContain("不新增第二位清晰人物");
    const out = compileMvShotTimedPrompt(slap, ctx());
    expect(out.text).toContain("光色与天气贯穿：每窗光色/天气承接前窗");
    expect(out.text).toContain("不跳变、不回退");
  });
});

describe("MV 请求时长：复用漫剧引擎表，不锁 5/15 秒", () => {
  it("分镜 + 1 秒余量，按模型上下限钳制；H3 取不短于需求的 5/10/15 档；超上限拒绝", () => {
    expect(mvShotGenerateDurationSec("seedance-2.0-mini", 2.3)).toBe(4);
    expect(mvShotGenerateDurationSec("seedance-2.0-mini", 6.2)).toBe(8);
    expect(mvShotGenerateDurationSec("seedance-2.0-mini", 14.5)).toBe(15);
    expect(mvShotGenerateDurationSec("seedance-2.5", 21.4)).toBe(23);
    expect(mvShotGenerateDurationSec("wan-3.0", 1.2)).toBe(3);
    expect(mvShotGenerateDurationSec("minimax-hailuo-3", 6.2)).toBe(10);
    expect(() => mvShotGenerateDurationSec("seedance-2.0-mini", 16)).toThrow(/超过所选模型单段上限 15 秒/);
    expect(mvShotGenerateDurationSec("seedance-2.5", 16)).toBe(17);
  });
});

/** 无白模的代表性输入（逐字节锁定用）：逐窗/降级/演唱/接龙/H3/Wan/多人关键事件/身份照/运镜参考片。 */
export function mvNoPrevisGoldenCases(): string[] {
  const twoCast = "雨夜街头的分手戏。\n主角：短发女生，白色风衣\n配角：高个男生，黑色夹克\n副歌转亮。";
  const slap = { shotId: "s5", startSec: 20, endSec: 26, visualPrompt: "街边雨棚下两人争执，女生打男生一巴掌，伞落地", cameraPrompt: "中景",
    beats: [w(20, 22.5, { actionZh: "女生逼近男生，抬手" }), w(22.5, 24.5, { actionZh: "女生打男生一巴掌，男生脸偏向一侧" }), w(24.5, 26, { actionZh: "伞从女生手里掉落，落地翻倒在积水里" })] };
  const sing = { shotId: "sing", startSec: 60, endSec: 66, visualPrompt: "她对镜头唱", cameraPrompt: "近景", kind: "singing" as const, beats: [w(60, 63), w(63, 66)], lyricTiming: "confirmed" as const,
    lyricLines: [{ text: "别爱我", startSec: 60.4, endSec: 62.1 }, { text: "又不想说", startSec: 63.0, endSec: 65.6 }] };
  const noVideo = { ...refs, motionVideos: [] };
  return [
    compileMvShotTimedPrompt({ shotId: "c1s12", startSec: 150, endSec: 156.2, visualPrompt: "她在便利店玻璃前", cameraPrompt: "中景推近", beats: [w(150, 152.33), w(152.33, 154.19), w(154.19, 156.2)] }, ctx()).text,
    compileMvShotTimedPrompt({ shotId: "s1", startSec: 0, endSec: 5, visualPrompt: "她走过天桥", cameraPrompt: "跟拍" }, ctx({ generateDurationSec: 6 })).text,
    compileMvShotTimedPrompt(sing, ctx({ generateDurationSec: 7 })).text,
    compileMvShotTimedPrompt({ ...sing, lyricTiming: "unconfirmed" }, ctx({ generateDurationSec: 7, references: noVideo, performerZh: "男歌手" })).text,
    compileMvShotTimedPrompt({ shotId: "s2", startSec: 0, endSec: 5, visualPrompt: "续", cameraPrompt: "同轴", beats: [w(0, 2.5), w(2.5, 5)], chainFromPrevious: true }, ctx({ generateDurationSec: 6 })).text,
    compileMvShotTimedPrompt({ shotId: "s", startSec: 0, endSec: 4, visualPrompt: "v", cameraPrompt: "c", beats: [w(0, 2), w(2, 4)] }, ctx({ engine: "minimax-hailuo-3", generateDurationSec: 5 })).text,
    compileMvShotTimedPrompt({ shotId: "s", startSec: 0, endSec: 4, visualPrompt: "v", cameraPrompt: "c", beats: [w(0, 2), w(2, 4)] }, ctx({ engine: "wan-3.0", generateDurationSec: 5 })).text,
    compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast })).text,
    compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast, references: { ...noVideo, anchorImage: { gcsUri: "gs://b/me.jpg", label: "我的照片", hasRealPerson: true } } })).text,
    compileMvShotTimedPrompt(slap, ctx({ generateDurationSec: 6, beatGrid: undefined, references: { sceneImages: [], motionVideos: [] } })).text,
  ];
}

describe("1110 白模动作参考（motionVideos.source=previs）", () => {
  const twoCast = "雨夜街头的分手戏。\n主角：短发女生，白色风衣\n配角：高个男生，黑色夹克";
  const slap = { shotId: "s5", startSec: 20, endSec: 26, visualPrompt: "街边雨棚下两人争执，女生打男生一巴掌", cameraPrompt: "中景",
    beats: [w(20, 22.5, { actionZh: "女生逼近男生，抬手" }), w(22.5, 24.5, { actionZh: "女生打男生一巴掌，男生脸偏向一侧" }), w(24.5, 26, { actionZh: "两人对峙" })] };
  const previs = { source: "previs" as const, gcsUri: "gs://b/previs.mp4", inSec: 0, outSec: 6, durationSec: 6, label: "白模" };
  const stock = refs.motionVideos[0]!;

  it("无白模：输出逐字节不变（锁定改前 SHA-256）", () => {
    const hashes = mvNoPrevisGoldenCases().map(t => createHash("sha256").update(t).digest("hex").slice(0, 16));
    expect(hashes).toEqual(NO_PREVIS_GOLDEN);
    for (const t of mvNoPrevisGoldenCases()) expect(t).not.toContain("白模动作参考");
  });

  it("有白模：头部指令 + @视频N 用白模在提交数组中的真实序号", () => {
    const first = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast, references: { ...refs, motionVideos: [previs, stock] } })).text;
    expect(first).toContain("白模动作参考：站位、走位、朝向与肢体接触时序严格按@视频1（白模动作参考）执行");
    expect(first).toContain("人物外形、服装与场景以@图片1、@图片2、@图片3为准，忽略白模的材质与灰模外观");
    const second = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast, references: { ...refs, motionVideos: [stock, previs] } })).text;
    expect(second).toContain("严格按@视频2（白模动作参考）执行");
    expect(second).toContain("@视频2＝白模站位片（白模）");
    expect(second).not.toContain("严格按@视频1（白模动作参考）");
    // 头部指令在逐窗正文之前
    expect(second.indexOf("白模动作参考：")).toBeLessThan(second.indexOf("逐窗执行正文："));
    const h3 = compileMvShotTimedPrompt(slap, ctx({ engine: "minimax-hailuo-3", generateDurationSec: 10, references: { ...refs, motionVideos: [stock, previs] } })).text;
    expect(h3).toContain("严格按Video 2白模动作参考执行");
  });

  // 秒位经格式层规范（2.50→2.5，0.00→0）
  it("逐窗秒点对齐（未裁切：白模第 t 秒＝镜内第 t 秒），关键接触以白模接触帧为准", () => {
    const out = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast, references: { ...refs, motionVideos: [previs] } })).text;
    expect(out).toContain("站位与动作按@视频1镜内 0–2.5 秒段执行");
    expect(out).toContain("站位与动作按@视频1镜内 2.5–4.5 秒段执行");
    expect(out).toContain("站位与动作按@视频1镜内 4.5–6 秒段执行");
    expect(out).toContain("@视频1第 t 秒＝本镜镜内第 t 秒");
    expect(out.split("接触瞬间以@视频1白模接触帧为准").length - 1).toBe(1); // 只有耳光窗
    expect(out).not.toContain("白模已裁切");
  });

  it("裁切入点换算：派生片第 q 秒＝源片第 q+入点 秒；超出覆盖的窗承接前窗", () => {
    const trimmed = { ...previs, inSec: 0, outSec: 4, durationSec: 4, trimmedFrom: { gcsUri: "gs://b/previs-src.mp4", inSec: 2, outSec: 6, sourceSec: 6, auto: false } };
    expect(mvPrevisClipRange(trimmed, 0, 2.5)).toEqual({ fromSec: 0, toSec: 0.5 });
    expect(mvPrevisClipRange(trimmed, 2.5, 4.5)).toEqual({ fromSec: 0.5, toSec: 2.5 });
    expect(mvPrevisClipRange(trimmed, 4.5, 6)).toEqual({ fromSec: 2.5, toSec: 4 });
    expect(mvPrevisClipRange(trimmed, 0, 2)).toBeUndefined();
    const out = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast, references: { ...refs, motionVideos: [trimmed] } })).text;
    expect(out).toContain("@视频1第 t 秒＝本镜镜内第 t+2 秒（白模已裁切，入点 2 秒，逐窗秒点已换算）");
    expect(out).toContain("站位与动作按@视频1镜内 0–0.5 秒段执行");
    expect(out).toContain("站位与动作按@视频1镜内 0.5–2.5 秒段执行");
    expect(out).toContain("站位与动作按@视频1镜内 2.5–4 秒段执行");
    const early = compileMvShotTimedPrompt({ ...slap, beats: [w(20, 21.5), w(21.5, 26)] }, ctx({ references: { ...refs, motionVideos: [trimmed] } })).text;
    expect(early).toContain("本窗超出@视频1覆盖范围：站位承接前窗末态，不新增走位");
  });

  it("与对口型/一窗一事件/光色贯穿/角色表人物锁共存：白模不削弱既有规则", () => {
    const sing = compileMvShotTimedPrompt(
      { shotId: "sing", startSec: 60, endSec: 66, visualPrompt: "她对镜头唱", cameraPrompt: "近景", kind: "singing", beats: [w(60, 63), w(63, 66)], lyricTiming: "confirmed", lyricLines: [{ text: "别爱我", startSec: 60.4, endSec: 62.1 }] },
      ctx({ generateDurationSec: 7, references: { ...refs, motionVideos: [previs] } }),
    ).text;
    expect(sing).toContain("对口型窗：本窗一镜到底，不切镜、不跳轴、不换景别");
    expect(sing).toContain("本窗不切镜，正脸或微侧对镜，禁止背身与大侧脸");
    expect(sing).toContain("对口型窗仍正脸或微侧对镜、一镜到底不切镜（白模朝向与之冲突时以正脸对镜为准）");
    expect(sing).toContain("站位与动作按@视频1镜内 0–2.1 秒段执行");
    expect(sing).toContain("{别爱我}");
    const multi = compileMvShotTimedPrompt(slap, ctx({ creativePrompt: twoCast, references: { ...refs, motionVideos: [previs] } })).text;
    expect(multi).toContain("人物一致性锁（按角色表）：主角：短发女生，白色风衣；配角：高个男生，黑色夹克");
    expect(multi).toContain("关键事件窗：本窗只发生这一件事");
    expect(multi).toContain("光色与天气贯穿：每窗光色/天气承接前窗");
    expect(multi).toContain("关键事件仍一窗一事件；光色与天气仍逐窗贯穿；人物仍只取自人物一致性锁");
  });
});

/** 改前（80b9ac8d）同输入输出的 SHA-256 前 16 位：无白模时必须逐字节一致。 */
const NO_PREVIS_GOLDEN = ["46d8b046d53f9fc7", "05ad906fdaa8dbcb", "036527ee283503f9", "73cf7bc1722a094b", "fe974edb9182076a", "784d21516e2e0895", "0a3ffa65caf9a856", "c71474a56210e8a9", "6323f680c3bbf5c7", "2396ff3ea85b6d1c"];
