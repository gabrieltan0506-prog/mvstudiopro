/**
 * 镜级中间表示(IR)——防废片编译器的锚(0821 规格v1 §六第一刀)。
 * 口径:镜数由剧本节拍定,不由引擎定;段是把镜按引擎时长上限装箱的编译产物。
 * 换引擎 = 重装箱 + 重编方言,静帧(一镜一张)与 IR 本身零损失。
 */

export type ShotDialogue = {
  /** 说话人(与资产表人名对齐) */
  speakerZh: string;
  /** 台词原文(编译时 Seedance 进 {},H3 进自然语言引号) */
  textZh: string;
  /** 情绪/语气(TTS instruction 与演技铁令共用) */
  emotionZh?: string;
};

export type ShotImageRef = {
  /** 参考图序号(1 起) */
  n: number;
  /** 该图职责(如"谢明彰定妆·锁脸"/"军械库空镜·锁场景光") */
  roleZh: string;
};

export type ShotIR = {
  /** 镜号(1 起,全集连续) */
  index: number;
  /** 该镜时长(秒);由剧本节拍定 */
  durationSec: number;
  /** 场景(与资产表 sceneZh 对齐) */
  sceneZh: string;
  /** 主体动作(一镜一核心动作) */
  actionZh: string;
  /** 运镜(可空,编译器按运动降维推默认) */
  cameraZh?: string;
  /** 微表情/表演细节(可空,语义层补) */
  microExpressionZh?: string;
  dialogue?: ShotDialogue;
  /** 音效提示(Seedance 进 <>) */
  sfxZh?: string;
  imageRefs?: ShotImageRef[];
};

export type EpisodeIR = {
  episodeIndex: number;
  titleZh?: string;
  /** 风格句(风格包:色彩+光源+构图+情绪),编译进全局段 */
  styleZh?: string;
  /** 题材(BGM brief 查表用,如"古风武侠") */
  genreZh?: string;
  shots: ShotIR[];
};

/** 段=镜的装箱产物 */
export type SegmentPlan = {
  index: number;
  durationSec: number;
  shots: ShotIR[];
};

export type CompilerEngineId =
  | "seedance-2.0-mini"
  | "seedance-2.0"
  | "seedance-2.0-fast"
  | "seedance-2.5"
  | "minimax-h3";

/** 引擎硬限(编译期钳制;与服务端各适配器口径一致) */
export const COMPILER_ENGINE_LIMITS: Record<
  CompilerEngineId,
  { maxSegmentSec: number; maxImageRefs: number; dialect: "seedance" | "h3" }
> = {
  "seedance-2.0-mini": { maxSegmentSec: 15, maxImageRefs: 9, dialect: "seedance" },
  "seedance-2.0": { maxSegmentSec: 15, maxImageRefs: 9, dialect: "seedance" },
  "seedance-2.0-fast": { maxSegmentSec: 15, maxImageRefs: 9, dialect: "seedance" },
  "seedance-2.5": { maxSegmentSec: 30, maxImageRefs: 9, dialect: "seedance" },
  "minimax-h3": { maxSegmentSec: 15, maxImageRefs: 9, dialect: "h3" },
};

/**
 * 镜→段装箱:顺序装,装不下开新箱;单镜超上限时钳到上限(镜数守恒,绝不丢镜)。
 * 换引擎只是换 maxSegmentSec 重跑本函数。
 */
export function packShotsIntoSegments(shots: ShotIR[], maxSegmentSec: number): SegmentPlan[] {
  const cap = Math.max(2, maxSegmentSec);
  const segments: SegmentPlan[] = [];
  let current: ShotIR[] = [];
  let currentSec = 0;

  for (const raw of shots) {
    const shot: ShotIR = {
      ...raw,
      durationSec: Math.max(1, Math.min(cap, Number(raw.durationSec) || 3)),
    };
    if (current.length > 0 && currentSec + shot.durationSec > cap) {
      segments.push({ index: segments.length + 1, durationSec: currentSec, shots: current });
      current = [];
      currentSec = 0;
    }
    current.push(shot);
    currentSec += shot.durationSec;
  }
  if (current.length > 0) {
    segments.push({ index: segments.length + 1, durationSec: currentSec, shots: current });
  }
  return segments;
}
