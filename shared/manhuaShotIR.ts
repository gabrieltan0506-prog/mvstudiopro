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

/**
 * wan-3.0 是 **reserved**：协议层已按官方参数表落好（shared/wanBailianNative.ts），
 * 但**没有百炼生产适配器**——建单、轮询、24 小时结果转存、失败分类、
 * 计费退款、重启恢复一个都没有，生产链实际走的是 WaveSpeed 那条。
 *
 * 在接上 `server/services/bailianWanVideo.ts` 之前，不许标 ready：
 * 标了就等于对用户宣称"Wan 已按百炼正式协议接通"，而事实不是。
 * 接线待办见 ~/Downloads/2026Aug24/jobs-codes-undo.md（P0·百炼 Wan 生产适配器）。
 */
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
    /**
     * **reserved · protocol_preparation**（0824 复审后从 ready 退回）。
     *
     * 协议层与方言层都已按官方参数表落好，但**百炼生产适配器不存在**：
     * `buildWanBailianRequest` 全仓零生产调用者，没有建单、轮询、
     * 24 小时结果转存、失败分类（UNKNOWN 需人工核对不得重建单）、
     * 计费退款与重启恢复。生产链实际走的是 WaveSpeed 通道。
     *
     * 标 ready 等于对用户宣称「Wan 已按百炼正式协议接通」——与事实不符，
     * 所以在 `server/services/bailianWanVideo.ts` 落地之前保持 reserved。
     *
     * 官方口径（百炼控制台 · 华北2 北京）：
     *   模型 Code  wan3.0-video / wan3.0-video-prime  ← 与本仓内部 id "wan-3.0" 不同名
     *   能力      all-in-one：参考/编辑/复刻/驱动
     *   时长      -1（智能）或 2–30 秒 · RPM 300
     */
    status: "reserved",
    /**
     * 拒绝文案要说真正的原因。默认那句「提示词方言尚未接线」在这里是**假的**——
     * 方言层早就接好了，缺的是生产适配器。照默认文案报，下一个人会去改方言层，
     * 白花半天才发现修错了地方。
     */
    noteZh:
      "wan-3.0 暂不可选用：百炼生产适配器（server/services/bailianWanVideo.ts）尚未落地，" +
      "协议层与方言层已就绪但无生产调用者；接上适配器后再把 status 翻回 ready。",
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
    const noteZh = (profile as { noteZh?: string }).noteZh;
    throw new Error(noteZh || `${engine} 的提示词方言尚未接线`);
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
