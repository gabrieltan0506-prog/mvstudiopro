/**
 * 镜级中间表示(IR)——防废片编译器的锚。
 * 口径:镜数与镜时长由剧本节拍定,不由引擎定;段是装箱产物。
 * 引擎中立 IR 单镜上限 15s;超过必须上游拆镜,禁止静默钳制
 * (否则 TTS 秒位与 BGM 总时长随引擎漂移)。
 */
import {
  CANVAS_VIDEO_MODEL_HAILUO_H3,
  HAILUO_REFERENCE_MAX,
} from "./hailuoOpenRouterModels.js";
import {
  SEEDANCE_25_REFERENCE_MAX,
  SEEDANCE_REFERENCE_MAX,
} from "./seedanceOpenRouterModels.js";
import { WAN30_REFERENCE_MAX } from "./wanWavespeedModels.js";

export type ShotDialogue = {
  speakerZh: string;
  textZh: string;
  emotionZh?: string;
};

export type ShotMediaRefKind = "image" | "video" | "audio";

export type ShotMediaRef = {
  kind: ShotMediaRefKind;
  /** 在同类型数组中的编号,从 1 开始 */
  n: number;
  /** 唯一职责,例如"沈曜锁脸""动作轨迹""玄璃声线" */
  roleZh: string;
  /** 对应资产 ID;格式层不直接持有 URL */
  sourceAssetId?: string;
  /** 视频、音频时长;未知时由提交适配器探测 */
  durationSec?: number;
};

export type ShotIR = {
  index: number;
  durationSec: number;
  sceneZh: string;
  actionZh: string;
  cameraZh?: string;
  microExpressionZh?: string;
  dialogue?: ShotDialogue;
  sfxZh?: string;
  mediaRefs?: ShotMediaRef[];
};

export type EpisodeIR = {
  episodeIndex: number;
  titleZh?: string;
  styleZh?: string;
  genreZh?: string;
  shots: ShotIR[];
};

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
  | "wan-3.0"
  | typeof CANVAS_VIDEO_MODEL_HAILUO_H3;

export type ReadyCompilerEngineId = Exclude<CompilerEngineId, "wan-3.0">;

export type CompilerDialect = "seedance" | "h3" | "wan";
export type CompilerSupportStatus = "ready" | "reserved";

export type CompilerReferenceLimits = {
  image: number;
  video: number;
  audio: number;
  total?: number;
  minVideoItemSec?: number;
  maxVideoItemSec?: number;
  maxVideoTotalSec?: number;
  minAudioItemSec?: number;
  maxAudioItemSec?: number;
  maxAudioTotalSec?: number;
};

export type CompilerEngineProfile = {
  minSegmentSec: number;
  maxSegmentSec: number;
  references: CompilerReferenceLimits;
  dialect: CompilerDialect;
  status: CompilerSupportStatus;
  /** 目标引擎提示词字符上限 */
  maxPromptChars?: number;
  /** 是否只接受整数输出时长 */
  requiresIntegerSegmentSec?: boolean;
  noteZh?: string;
};

export const COMPILER_ENGINE_LIMITS = {
  "seedance-2.0-mini": {
    minSegmentSec: 4,
    maxSegmentSec: 15,
    references: {
      image: SEEDANCE_REFERENCE_MAX.image,
      video: SEEDANCE_REFERENCE_MAX.video,
      audio: SEEDANCE_REFERENCE_MAX.audio,
    },
    dialect: "seedance",
    status: "ready",
  },
  "seedance-2.0": {
    minSegmentSec: 4,
    maxSegmentSec: 15,
    references: {
      image: SEEDANCE_REFERENCE_MAX.image,
      video: SEEDANCE_REFERENCE_MAX.video,
      audio: SEEDANCE_REFERENCE_MAX.audio,
    },
    dialect: "seedance",
    status: "ready",
  },
  "seedance-2.0-fast": {
    minSegmentSec: 4,
    maxSegmentSec: 15,
    references: {
      image: SEEDANCE_REFERENCE_MAX.image,
      video: SEEDANCE_REFERENCE_MAX.video,
      audio: SEEDANCE_REFERENCE_MAX.audio,
    },
    dialect: "seedance",
    status: "ready",
  },
  "seedance-2.5": {
    minSegmentSec: 4,
    maxSegmentSec: 30,
    references: {
      image: SEEDANCE_25_REFERENCE_MAX.image,
      video: SEEDANCE_25_REFERENCE_MAX.video,
      audio: SEEDANCE_25_REFERENCE_MAX.audio,
    },
    dialect: "seedance",
    status: "ready",
  },
  [CANVAS_VIDEO_MODEL_HAILUO_H3]: {
    minSegmentSec: 4,
    maxSegmentSec: 15,
    maxPromptChars: 7000,
    requiresIntegerSegmentSec: true,
    references: {
      image: HAILUO_REFERENCE_MAX.image,
      video: 3,
      audio: 3,
      total: 12,
      minVideoItemSec: 2,
      maxVideoItemSec: 15,
      maxVideoTotalSec: 15,
      minAudioItemSec: 2,
      maxAudioItemSec: 15,
      maxAudioTotalSec: 15,
    },
    dialect: "h3",
    status: "ready",
  },
  "wan-3.0": {
    minSegmentSec: 2,
    maxSegmentSec: 30,
    references: {
      image: WAN30_REFERENCE_MAX.image,
      video: WAN30_REFERENCE_MAX.video,
      audio: WAN30_REFERENCE_MAX.audio,
    },
    dialect: "wan",
    status: "reserved",
    noteZh:
      "Wan 3.0 独立提示词方言与参考职责适配器已预留,公开使用方式稳定前不提交编译结果",
  },
} satisfies Record<CompilerEngineId, CompilerEngineProfile>;

export function normalizeCompilerEngineId(raw: unknown): CompilerEngineId | null {
  const key = String(raw || "").trim().toLowerCase();
  const normalized =
    key === "minimax-h3" ||
    key === "hailuo-3" ||
    key === "minimax/hailuo-3" ||
    key === "minimax-h3-reference-to-video"
      ? CANVAS_VIDEO_MODEL_HAILUO_H3
      : key === "wan30" || key === "wan3.0" || key === "alibaba/wan-3.0"
        ? "wan-3.0"
        : key;
  return Object.hasOwn(COMPILER_ENGINE_LIMITS, normalized)
    ? (normalized as CompilerEngineId)
    : null;
}

export function isReadyCompilerEngineId(
  engine: CompilerEngineId,
): engine is ReadyCompilerEngineId {
  return COMPILER_ENGINE_LIMITS[engine].status === "ready";
}

export function assertCompilerEngineReady(
  engine: CompilerEngineId,
): asserts engine is ReadyCompilerEngineId {
  const profile = COMPILER_ENGINE_LIMITS[engine];
  if (profile.status !== "ready") {
    throw new Error(profile.noteZh || `${engine} 的提示词方言尚未接线`);
  }
}

/** 引擎中立 IR 的单镜上限;超过必须上游拆镜 */
export const COMPILER_IR_MAX_SHOT_SEC = 15;

/** 镜→段装箱:时长只读不改写;非法/超限一律抛错要求上游处理 */
export function packShotsIntoSegments(
  shots: ShotIR[],
  maxSegmentSec: number,
): SegmentPlan[] {
  const cap = Number(maxSegmentSec);
  if (!Number.isFinite(cap) || cap < 2) {
    throw new RangeError(`无效的单段时长上限：${maxSegmentSec}`);
  }

  const segments: SegmentPlan[] = [];
  let current: ShotIR[] = [];
  let currentSec = 0;

  for (const raw of shots) {
    const durationSec = Number(raw.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new RangeError(`第 ${raw.index} 镜时长必须为正数`);
    }
    if (durationSec > COMPILER_IR_MAX_SHOT_SEC) {
      throw new RangeError(
        `第 ${raw.index} 镜为 ${durationSec}s，超过引擎中立 IR 的 ${COMPILER_IR_MAX_SHOT_SEC}s 上限，请先拆镜`,
      );
    }
    if (durationSec > cap) {
      throw new RangeError(`第 ${raw.index} 镜为 ${durationSec}s，超过当前引擎单段 ${cap}s 上限`);
    }

    const shot: ShotIR = {
      ...raw,
      durationSec,
      mediaRefs: raw.mediaRefs?.map((ref) => ({ ...ref })),
    };

    if (current.length > 0 && currentSec + durationSec > cap) {
      segments.push({ index: segments.length + 1, durationSec: currentSec, shots: current });
      current = [];
      currentSec = 0;
    }
    current.push(shot);
    currentSec += durationSec;
  }
  if (current.length > 0) {
    segments.push({ index: segments.length + 1, durationSec: currentSec, shots: current });
  }
  return segments;
}
