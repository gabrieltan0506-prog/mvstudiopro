/**
 * 防废片编译器·确定性拼装层(第一刀,零 LLM):
 * 镜级 IR → ①视频提示词(按引擎方言) ②TTS 台词表(秒位) ③Suno BGM brief。
 * 七成字段确定性拼装(风格句/绑定句/触发门/固定铁令段),三成留语义层(PR B)。
 */
import {
  COMPILER_ENGINE_LIMITS,
  packShotsIntoSegments,
  type CompilerEngineId,
  type EpisodeIR,
  type SegmentPlan,
} from "./manhuaShotIR";
import { formatPromptForEngine } from "./promptFormatLayer";

/** 固定铁令段(法典七段式:画质/演技/正向锁定,常量拼装) */
const QUALITY_LOCK_ZH =
  "画面:1/500s 快门级清晰,开场三秒极致锐利;人物保留真实毛孔与皮肤质感,任何时刻活着(呼吸/重心/衣发随动),禁止蜡像式僵直。";
const POSITIVE_LOCK_ZH =
  "锁定:人物身份与服装段内100%一致,手部解剖正确,口型对齐台词,画面零文字零水印;光必有源。";

/** 题材→BGM 风格查表(可扩;查不到给中性配乐) */
const GENRE_BGM_STYLE: Array<[RegExp, string[]]> = [
  [/古风|武侠|仙侠|江湖/, ["chinese instrumental", "guzheng", "war drums", "cinematic"]],
  [/都市|甜宠|现代/, ["modern pop instrumental", "warm piano", "light strings"]],
  [/悬疑|谍战|惊悚/, ["dark ambient", "tension strings", "pulsing bass"]],
  [/科幻|末世/, ["cinematic electronic", "synth", "epic hybrid"]],
];

export type TtsCue = {
  segmentIndex: number;
  shotIndex: number;
  /** 段内起始秒(该镜前所有镜时长之和) */
  startSec: number;
  speakerZh: string;
  textZh: string;
  /** TTS instruction(情绪中文指令) */
  instructionZh?: string;
};

export type BgmBrief = {
  styleTags: string[];
  negativeTags: string;
  /** 每段时长与情绪(裁段/生成都按它) */
  segments: Array<{ index: number; durationSec: number; moodZh: string }>;
  /** Suno V5.5 参数建议 */
  suno: { instrumental: true; durationSec: number; customMode: false };
};

export type CompiledEpisode = {
  engine: CompilerEngineId;
  segments: SegmentPlan[];
  /** 每段一条成片提示词(目标方言) */
  segmentPrompts: string[];
  ttsCueSheet: TtsCue[];
  bgmBrief: BgmBrief;
};

function shotLineSeedance(shot: {
  index: number;
  durationSec: number;
  actionZh: string;
  cameraZh?: string;
  microExpressionZh?: string;
  dialogue?: { speakerZh: string; textZh: string; emotionZh?: string };
  sfxZh?: string;
  imageRefs?: Array<{ n: number; roleZh: string }>;
  startSec: number;
}): string {
  const end = shot.startSec + shot.durationSec;
  const refs = (shot.imageRefs ?? [])
    .map((r) => `@图${r.n} 定义${r.roleZh},仅本窗生效`)
    .join(";");
  const parts = [
    `[${shot.startSec}-${end}s 第${shot.index}镜] ${shot.actionZh}`,
    shot.cameraZh ? `运镜:${shot.cameraZh}` : "",
    shot.microExpressionZh ? `表演:${shot.microExpressionZh}` : "",
    shot.dialogue
      ? `${shot.dialogue.speakerZh}${shot.dialogue.emotionZh ? `(${shot.dialogue.emotionZh})` : ""}说 {${shot.dialogue.textZh}}`
      : "",
    shot.sfxZh ? `<${shot.sfxZh}>` : "",
    refs,
  ].filter(Boolean);
  return parts.join(" · ");
}

function shotLineH3(shot: {
  index: number;
  durationSec: number;
  actionZh: string;
  cameraZh?: string;
  microExpressionZh?: string;
  dialogue?: { speakerZh: string; textZh: string; emotionZh?: string };
  imageRefs?: Array<{ n: number; roleZh: string }>;
  startSec: number;
}): string {
  const end = shot.startSec + shot.durationSec;
  const refs = (shot.imageRefs ?? [])
    .map((r) => `参考 Image ${r.n}(${r.roleZh})`)
    .join(",");
  const parts = [
    `[00:${String(shot.startSec).padStart(2, "0")}-00:${String(end).padStart(2, "0")}] ${shot.actionZh}`,
    shot.cameraZh ? `镜头${shot.cameraZh}` : "",
    shot.microExpressionZh || "",
    shot.dialogue
      ? `${shot.dialogue.speakerZh}${shot.dialogue.emotionZh ? `以${shot.dialogue.emotionZh}的语气` : ""}说:“${shot.dialogue.textZh}”`
      : "",
    refs,
  ].filter(Boolean);
  return parts.join(",");
}

/** 单段提示词(方言分流;全局段=风格句+铁令,收尾=正向锁定) */
export function compileSegmentPrompt(
  segment: SegmentPlan,
  engine: CompilerEngineId,
  styleZh?: string,
): string {
  const dialect = COMPILER_ENGINE_LIMITS[engine].dialect;
  let startSec = 0;
  const lines: string[] = [];
  for (const shot of segment.shots) {
    const withStart = { ...shot, startSec };
    lines.push(dialect === "seedance" ? shotLineSeedance(withStart) : shotLineH3(withStart));
    startSec += shot.durationSec;
  }
  const head =
    dialect === "seedance"
      ? `【第${String(segment.index).padStart(2, "0")}段·${segment.durationSec}s】${styleZh ? ` ${styleZh}` : ""}`
      : `${styleZh ? `${styleZh}。` : ""}本段时长约${segment.durationSec}秒。`;
  const raw = [head, QUALITY_LOCK_ZH, ...lines, POSITIVE_LOCK_ZH].join("\n");
  // 出口前过格式层(避审替换/方言反转 H3 标记)
  return formatPromptForEngine(raw, engine, { durationSec: segment.durationSec }).text;
}

/** TTS 台词表:段内秒位=该镜前所有镜时长之和(秒锁母轨用) */
export function buildTtsCueSheet(segments: SegmentPlan[]): TtsCue[] {
  const cues: TtsCue[] = [];
  for (const seg of segments) {
    let startSec = 0;
    for (const shot of seg.shots) {
      if (shot.dialogue) {
        cues.push({
          segmentIndex: seg.index,
          shotIndex: shot.index,
          startSec,
          speakerZh: shot.dialogue.speakerZh,
          textZh: shot.dialogue.textZh,
          instructionZh: shot.dialogue.emotionZh,
        });
      }
      startSec += shot.durationSec;
    }
  }
  return cues;
}

/** BGM brief:题材查表出 style,段表出时长与情绪;Suno 纯音乐口径 */
export function buildBgmBrief(ir: EpisodeIR, segments: SegmentPlan[]): BgmBrief {
  const genre = String(ir.genreZh || "");
  const hit = GENRE_BGM_STYLE.find(([re]) => re.test(genre));
  const styleTags = hit ? hit[1] : ["cinematic instrumental", "ambient"];
  const totalSec = segments.reduce((s, x) => s + x.durationSec, 0);
  return {
    styleTags,
    negativeTags: "vocals, singing, rap, spoken word",
    segments: segments.map((seg) => ({
      index: seg.index,
      durationSec: seg.durationSec,
      moodZh: seg.shots.some((s) => s.dialogue) ? "衬底不压对白" : "情绪推进",
    })),
    suno: {
      instrumental: true,
      durationSec: Math.max(10, Math.min(360, totalSec + 10)),
      customMode: false,
    },
  };
}

/** 总入口:IR + 引擎 → 三产物(换引擎只重跑本函数,IR 与静帧零损失) */
export function compileEpisode(ir: EpisodeIR, engine: CompilerEngineId): CompiledEpisode {
  const limits = COMPILER_ENGINE_LIMITS[engine];
  const segments = packShotsIntoSegments(ir.shots, limits.maxSegmentSec);
  return {
    engine,
    segments,
    segmentPrompts: segments.map((seg) => compileSegmentPrompt(seg, engine, ir.styleZh)),
    ttsCueSheet: buildTtsCueSheet(segments),
    bgmBrief: buildBgmBrief(ir, segments),
  };
}
