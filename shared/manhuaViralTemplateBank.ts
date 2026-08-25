/**
 * 漫剧节奏模板库（产品只消费 status=approved）。
 * 出厂种子已于 2026-08-10 全部下架——那批是手写硬编码货，没经过真实爆款学习，
 * 用户判定质量不足。产品列表从此只来自 GCS approved（学节奏真学成 + 人审批准），
 * 本文件只留类型、解析与合并逻辑。
 * 成稿禁止竞品片名/台词抄袭；只借结构与中性手法标签。
 */

import {
  MANHUA_EPISODE_SEGMENT_DURATION_SEC,
  getManhuaEpisodeLengthTier,
  manhuaEpisodeDensityFloors,
  manhuaEpisodeSegmentsForTier,
} from "./manhuaEpisodeSegmentPlan.js";
import {
  parseManhuaNativeAudioAnalysis,
  type ManhuaNativeAudioAnalysis,
} from "./manhuaNativeAudioAnalysis.js";

export type ManhuaViralTemplateStatus = "proposed" | "approved" | "rejected";

/** 赛道分组（UI 分类排布用） */
export type ManhuaViralTemplateLane =
  | "爽文逆袭"
  | "古言种田"
  | "系统觉醒"
  | "甜宠"
  | "悬疑权谋"
  | "搞笑沙雕"
  | "游戏竞技"
  | "多维标签";

export const MANHUA_VIRAL_TEMPLATE_LANE_ORDER: readonly ManhuaViralTemplateLane[] = [
  "爽文逆袭",
  "古言种田",
  "系统觉醒",
  "甜宠",
  "悬疑权谋",
  "搞笑沙雕",
  "游戏竞技",
  "多维标签",
] as const;

export type ManhuaViralTemplateClassification = {
  emotionTagsZh: string[];
  narrativeFeatureTagsZh: string[];
  performanceTagsZh: string[];
  audiovisualTagsZh: string[];
  audienceExperienceTagsZh: string[];
};

/** 新收费模板的五维分类必须逐维都有真实证据；旧卡兼容由调用方显式处理。 */
export function hasCompleteManhuaTemplateClassification(
  classification: ManhuaViralTemplateClassification | undefined,
): classification is ManhuaViralTemplateClassification {
  return Boolean(
    classification
    && classification.emotionTagsZh.length
    && classification.narrativeFeatureTagsZh.length
    && classification.performanceTagsZh.length
    && classification.audiovisualTagsZh.length
    && classification.audienceExperienceTagsZh.length,
  );
}

/**
 * 同系列分集卡滚动聚合后的故事骨架。
 *
 * 这部分回答「故事为什么能继续长」，不再只保存钩子、压制、反转等局部手法。
 * 原生逐集卡可以没有；由系列结构模型聚合出的系列卡必须完整具备。
 */
export type ManhuaViralTemplateStoryStructure = {
  corePromiseZh: string;
  conflictEngineZh: string;
  relationshipEngineZh: string;
  episodeProgressionZh: string[];
  variationRulesZh: string[];
};

export function flattenManhuaTemplateClassification(
  classification: ManhuaViralTemplateClassification | undefined,
): string[] {
  if (!classification) return [];
  return Array.from(new Set([
    ...classification.emotionTagsZh,
    ...classification.narrativeFeatureTagsZh,
    ...classification.performanceTagsZh,
    ...classification.audiovisualTagsZh,
    ...classification.audienceExperienceTagsZh,
  ].map((tag) => String(tag || "").trim()).filter(Boolean)));
}

export type ManhuaViralTemplateBeat = {
  /** 约第几秒起（0-based 区间起点） */
  atSec: number;
  /** 冲突/信息增量类型（中性） */
  conflictZh: string;
  /** 可视觉化动作一句 */
  visualZh: string;

  /**
   * 以下为**原生视频精读**产出（0824 新增）。
   *
   * 全部可选，因为抽帧链路给不出这些——运镜、转场、力度是**帧与帧之间的差分**，
   * 不存在于任何单帧里，抽帧在采样那一刻就丢了。
   * 已入库的抽帧产出不带这些字段，必须继续有效。
   */
  /** 景别：极特写/特写/近景/中景/全景/大远景 */
  shotSizeZh?: string;
  /** 机位：平视/仰拍/俯拍/过肩/主观 */
  angleZh?: string;
  /** 运镜：方向与速度，看不出运动写「固定机位」——严禁无依据的「镜头拉远」 */
  cameraMoveZh?: string;
  /** 光影：光位、色调、明暗对比 */
  lightingZh?: string;
  /** 进入这一镜的转场：硬切/闪白/黑场/遮挡转场/叠化 */
  transitionInZh?: string;
  /** 这一镜结束秒（精读逐镜才有；抽帧只有起点） */
  endSec?: number;
};

export type ManhuaViralTemplateDensityHints = {
  /** 建议正文最少字（卡片按长档 12 段填；注入时按目标档段数折算） */
  minBodyChars: number;
  /** 建议「」对白句数 */
  minDialogueLines: number;
  /** 建议不同场景名命中数 */
  minLocationHits: number;
};

export type ManhuaViralTemplateSourceRef = {
  url: string;
  fetchedAt: string;
  noteZh?: string;
};

export const MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS = [
  "nameZh",
  "laneZh",
  "classification",
  "storyStructure",
  "summaryZh",
  "hook3sZh",
  "beatGrid",
  "reusableZh",
  "genPromptHintZh",
  "scenePoolHints",
  "castShape",
  "densityHints",
] as const;

export type ManhuaViralTemplateOptimizeField =
  (typeof MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS)[number];

export type ManhuaViralTemplateOptimizeModel =
  | "terra_high"
  | "kimi_k3_max"
  | "claude_opus_5_high"
  | "deepseek_v4_0813_high";

export type ManhuaViralTemplateChangeReason = {
  field: ManhuaViralTemplateOptimizeField;
  reasonZh: string;
};

/** 待审优化修订；只存在于监管私有卡，公开 DTO 不读取这些字段。 */
export type ManhuaViralTemplateRevision = {
  parentTemplateId: string;
  requestId: string;
  model: ManhuaViralTemplateOptimizeModel;
  modelName: string;
  reasoningEffort: "medium" | "high" | "max";
  promptZh: string;
  changedFields: ManhuaViralTemplateOptimizeField[];
  reasons: ManhuaViralTemplateChangeReason[];
  createdByUserId: number;
  createdAt: string;
};

/**
 * 这张卡是不是**原生视频精读**学出来的（0824 新增）。
 *
 * 判据取「抽帧链路物理上给不出的东西」：逐镜六栏与可复用手法。
 * 运镜/转场是帧间差分，抽帧在采样那一刻就丢了——有这些字段，就必然来自原生视频链路。
 * 用于 UI 上区分新旧形态模板，也用于后续淘汰旧库时筛选。
 */
export function isNativeVideoLearnedTemplate(
  card: Pick<ManhuaViralTemplateCard, "beatGrid" | "reusableZh" | "genPromptHintZh" | "audioStory">,
): boolean {
  if (card.audioStory?.hasAudio) return true;
  if (String(card.reusableZh || "").trim()) return true;
  if (String(card.genPromptHintZh || "").trim()) return true;
  return (card.beatGrid || []).some(
    (b) => b.shotSizeZh || b.angleZh || b.cameraMoveZh || b.lightingZh || b.transitionInZh,
  );
}

export type ManhuaViralTemplateCard = {
  id: string;
  /** UI 短名（中性，不写竞品剧名） */
  nameZh: string;
  laneZh: ManhuaViralTemplateLane;
  /** 新收费模板的真实分类；一张卡可同时属于多个标签组。 */
  classification?: ManhuaViralTemplateClassification;
  /** 跨集剧情结构；只在系列聚合卡上作为收费模板的核心内容。 */
  storyStructure?: ManhuaViralTemplateStoryStructure;
  /** 一句话用途 */
  summaryZh: string;
  hook3sZh: string;
  beatGrid: ManhuaViralTemplateBeat[];
  /** 画面 OCR 原文，仅 owner 审批与音画证据裁决可见；公开 DTO/编剧注入不下发原句。 */
  subtitleTrack?: Array<{ atSec: number; textZh: string }>;

  /**
   * 可复用手法：**脱离本剧剧情**写成的通用做法（0824 新增，原生视频精读独有）。
   *
   * 这是学习产出里最有门槛的一栏——剧情复述谁看一遍片子都写得出，
   * 而「用机位稳定性区分攻守」「力量不拍光效拍环境反应」要懂导演手法才写得出来。
   * 抽帧链路给不出，故可选。
   */
  reusableZh?: string;
  /**
   * 生成提示词要素：若用 AI 生成类似片段，画面提示词该写哪几个要素。
   * 这是**学习产出通向生产输入的那座桥**——学到的东西能不能直接投产，看这一栏。
   */
  genPromptHintZh?: string;
  /** 声音层的剧情因果、对白表演与音乐/音效节奏；不保存来源台词原文。 */
  audioStory?: ManhuaNativeAudioAnalysis;
  scenePoolHints: string[];
  castShape: {
    leadDesireZh: string;
    pressureZh: string;
    foilZh?: string;
  };
  densityHints: ManhuaViralTemplateDensityHints;
  sourceRefs: ManhuaViralTemplateSourceRef[];
  status: ManhuaViralTemplateStatus;
  /** 公开码（批准入库时随机生成并持久化，如 "A7F2"）：普通用户唯一可见的模板句柄来源 */
  publicCode?: string;
  approvedAt?: string;
  updatedAt?: string;
  /** 学习链 provenance：证明读帧模型与系列聚合方式；兼容旧润色记录。 */
  provenance?: ManhuaViralTemplateProvenance;
  /** 已批准模板经 owner 优化后形成的待审修订；普通学习提案没有此字段。 */
  revision?: ManhuaViralTemplateRevision;
};

/** 读帧与聚合分开记；proposalPolish 只为读取迁移前旧卡保留。 */
export type ManhuaViralTemplateProvenance = {
  frameVision?: {
    provider: string;
    model: string;
    attemptedChunks: number;
    successChunks: number;
  };
  proposalPolish?: {
    provider: string;
    model: string;
    attempted: boolean;
    success: boolean;
    /** true = 润色失败、卡面是启发式草稿 */
    degraded?: boolean;
  };
  /**
   * 原生视频精读来源（0824）。
   *
   * 与 frameVision 并列而非替代：一张卡到底是抽帧学的还是精读学的，
   * 审批人和后续对账都要能分辨。失败/丢弃/截断三个计数必须落库——
   * 静默少几个镜头比整体失败更难发现。
   */
  nativeVideoDeepRead?: {
    model: string;
    /** 计划精读的段数与实际成功段数 */
    attemptedSegments: number;
    successSegments: number;
    /** 落库的镜头数 */
    shotCount: number;
    /** 因动作或节奏结构为空而丢弃的镜头数 */
    droppedCount: number;
    /** 是否触顶 128 被等距抽稀 */
    truncated: boolean;
    /** 同一次多视频视觉请求的内部批次号；只用于对账，不暴露媒体地址。 */
    batchRequestId?: string;
    /** 该次视觉请求实际包含的剧集数。 */
    batchEpisodeCount?: number;
    /** 走的是套餐额度还是按量付费 —— 对账要看这个 */
    usingPlanQuota?: boolean;
    costCny: number;
  };
  nativeAudioDeepRead?: {
    model: string;
    hasAudio: boolean;
    alignmentMethod: string;
    chunkCount: number;
    beatCount: number;
    costCny: number;
  };
  /** 原生逐集卡经 Fly 快照后，滚动聚合成系列卡；保留旧北京卡兼容读取。 */
  nativeSeriesAggregation?: {
    model: string;
    route: "beijing_token_plan_text" | "openrouter_text";
    sourceEpisodeCount: number;
    firstEpisodeIndex: number;
    lastEpisodeIndex: number;
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
    priceEquivalentCny: number;
    usingPlanQuota: boolean;
    snapshotSha256: string;
    aggregatedAt: string;
  };
  /** 关键帧 API 已同时产出底稿字段；这里证明系列卡由程序聚合且没有第二次模型调用。 */
  seriesAggregation?: {
    mode: "frame_vision_deterministic";
    sourceChunks: number;
    success: boolean;
  };
};

const DEFAULT_DENSITY: ManhuaViralTemplateDensityHints = {
  minBodyChars: 280,
  minDialogueLines: 8,
  minLocationHits: 2,
};

/** 出厂种子已清空（见文件头）；保留常量名给合并逻辑与测试注入用 */
export const MANHUA_VIRAL_TEMPLATE_BANK: readonly ManhuaViralTemplateCard[] = [];

/**
 * 一句话说清「这张卡是怎么学来的」。
 *
 * 审批人必须能分辨精读卡与抽帧卡：两者门槛差很多，精读卡带可复用手法与生成要素，
 * 抽帧卡没有。丢镜数与触顶抽稀也必须露出来——**静默少几个镜头比整体失败更难发现**。
 *
 * 判据只此一处，路由与前端都引用，不各自拼串。
 * 不含成本：审批看的是内容质量，成本走对账口径。
 */
export function describeManhuaTemplateLearnSourceZh(
  provenance: ManhuaViralTemplateProvenance | undefined,
): string | undefined {
  const n = provenance?.nativeVideoDeepRead;
  if (n) {
    const parts = [
      "原生精读",
      n.model,
      `${n.shotCount}镜`,
      `${n.successSegments}/${n.attemptedSegments}段`,
    ].filter(Boolean);
    if (n.droppedCount > 0) parts.push(`丢弃${n.droppedCount}镜`);
    if (n.truncated) parts.push("触顶抽稀");
    if ((n.batchEpisodeCount || 0) > 1) parts.push(`同批${n.batchEpisodeCount}集`);
    if (n.usingPlanQuota === false) parts.push("按量付费");
    const a = provenance?.nativeAudioDeepRead;
    if (a?.hasAudio) parts.push(`声音${a.beatCount}拍/${a.chunkCount}段`);
    else if (a) parts.push("无音轨");
    return parts.join(" · ");
  }
  const f = provenance?.frameVision;
  if (f) {
    return ["抽帧读图", f.model, `${f.successChunks}/${f.attemptedChunks}块`]
      .filter(Boolean)
      .join(" · ");
  }
  return undefined;
}

export function parseManhuaViralTemplateCard(raw: unknown): ManhuaViralTemplateCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaViralTemplateCard>;
  const id = String(o.id || "").trim();
  const nameZh = String(o.nameZh || "").trim();
  const laneZh = String(o.laneZh || "").trim() as ManhuaViralTemplateLane;
  if (!id || !nameZh) return null;
  if (!MANHUA_VIRAL_TEMPLATE_LANE_ORDER.includes(laneZh)) return null;
  const status = o.status;
  if (status !== "proposed" && status !== "approved" && status !== "rejected") return null;
  const beatGrid = Array.isArray(o.beatGrid)
    ? o.beatGrid
        .map((raw) => {
          const b = raw as ManhuaViralTemplateBeat;
          /** 空串归 undefined：抽帧产出没有这些字段，不该在库里留一堆空字符串 */
          const opt = (v: unknown, max: number): string | undefined =>
            String(v || "").trim().slice(0, max) || undefined;
          const endSec = Math.floor(Number(b.endSec) || 0);
          return {
            atSec: Math.max(0, Math.floor(Number(b.atSec) || 0)),
            conflictZh: String(b.conflictZh || "").trim().slice(0, 40),
            visualZh: String(b.visualZh || "").trim().slice(0, 80),
            shotSizeZh: opt(b.shotSizeZh, 16),
            angleZh: opt(b.angleZh, 16),
            cameraMoveZh: opt(b.cameraMoveZh, 60),
            lightingZh: opt(b.lightingZh, 60),
            transitionInZh: opt(b.transitionInZh, 20),
            endSec: endSec > 0 ? endSec : undefined,
          };
        })
        .filter((b) => b.conflictZh && b.visualZh)
        // 抽帧链路一集 ~24 拍够用；原生视频精读是逐镜，实测 262 秒出 95 镜，
        // 卡在 24 会把大部分镜头静默截断
        .slice(0, 128)
    : [];
  const cast = o.castShape || { leadDesireZh: "", pressureZh: "" };
  const classification = parseManhuaTemplateClassification(o.classification);
  const revision = parseManhuaViralTemplateRevision(o.revision);
  // 只要声明了 revision 或使用修订 id，就必须完整通过修订契约，禁止降级成普通提案。
  if ((o.revision != null || /^tpl_revision_/i.test(id)) && !revision) return null;
  return {
    id: id.slice(0, 64),
    nameZh: nameZh.slice(0, 32),
    laneZh,
    classification,
    storyStructure: parseManhuaTemplateStoryStructure(o.storyStructure),
    summaryZh: String(o.summaryZh || "").trim().slice(0, 120),
    hook3sZh: String(o.hook3sZh || "").trim().slice(0, 200),
    beatGrid,
    subtitleTrack: (Array.isArray(o.subtitleTrack) ? o.subtitleTrack : [])
      .map((row) => ({
        atSec: Math.max(0, Number((row as { atSec?: unknown }).atSec) || 0),
        textZh: String((row as { textZh?: unknown }).textZh || "").trim().slice(0, 160),
      }))
      .filter((row) => row.textZh)
      .slice(0, 512),
    reusableZh: String(o.reusableZh || "").trim().slice(0, 600) || undefined,
    genPromptHintZh: String(o.genPromptHintZh || "").trim().slice(0, 600) || undefined,
    audioStory: parseManhuaNativeAudioAnalysis(o.audioStory),
    scenePoolHints: (Array.isArray(o.scenePoolHints) ? o.scenePoolHints : [])
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 16),
    castShape: {
      leadDesireZh: String(cast.leadDesireZh || "").trim().slice(0, 80),
      pressureZh: String(cast.pressureZh || "").trim().slice(0, 80),
      foilZh: String(cast.foilZh || "").trim().slice(0, 80) || undefined,
    },
    densityHints: {
      minBodyChars: Math.max(
        80,
        Math.floor(Number(o.densityHints?.minBodyChars) || DEFAULT_DENSITY.minBodyChars),
      ),
      minDialogueLines: Math.max(
        2,
        Math.floor(Number(o.densityHints?.minDialogueLines) || DEFAULT_DENSITY.minDialogueLines),
      ),
      minLocationHits: Math.max(
        1,
        Math.floor(Number(o.densityHints?.minLocationHits) || DEFAULT_DENSITY.minLocationHits),
      ),
    },
    sourceRefs: (Array.isArray(o.sourceRefs) ? o.sourceRefs : [])
      .map((r) => ({
        url: String((r as ManhuaViralTemplateSourceRef).url || "").trim().slice(0, 500),
        fetchedAt: String((r as ManhuaViralTemplateSourceRef).fetchedAt || "").trim().slice(0, 32),
        noteZh: String((r as ManhuaViralTemplateSourceRef).noteZh || "").trim().slice(0, 120) || undefined,
      }))
      .filter((r) => r.url)
      .slice(0, 8),
    status,
    publicCode: /^[A-Z0-9]{4,16}$/.test(String(o.publicCode || "")) ? String(o.publicCode) : undefined,
    approvedAt: o.approvedAt ? String(o.approvedAt) : undefined,
    updatedAt: o.updatedAt ? String(o.updatedAt) : undefined,
    provenance: parseManhuaViralTemplateProvenance(o.provenance),
    revision,
  };
}

function parseManhuaTemplateClassification(
  raw: unknown,
): ManhuaViralTemplateClassification | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaViralTemplateClassification>;
  const tags = (value: unknown, max: number) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((tag) => String(tag || "").trim().slice(0, 24))
      .filter(Boolean),
  )).slice(0, max);
  const classification: ManhuaViralTemplateClassification = {
    emotionTagsZh: tags(o.emotionTagsZh, 8),
    narrativeFeatureTagsZh: tags(o.narrativeFeatureTagsZh, 8),
    performanceTagsZh: tags(o.performanceTagsZh, 8),
    audiovisualTagsZh: tags(o.audiovisualTagsZh, 8),
    audienceExperienceTagsZh: tags(o.audienceExperienceTagsZh, 8),
  };
  return flattenManhuaTemplateClassification(classification).length ? classification : undefined;
}

function parseManhuaTemplateStoryStructure(
  raw: unknown,
): ManhuaViralTemplateStoryStructure | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaViralTemplateStoryStructure>;
  const text = (value: unknown, max: number) => String(value || "").trim().slice(0, max);
  const list = (value: unknown, maxItems: number, maxChars: number) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((row) => text(row, maxChars))
      .filter(Boolean),
  )).slice(0, maxItems);
  const story: ManhuaViralTemplateStoryStructure = {
    corePromiseZh: text(o.corePromiseZh, 240),
    conflictEngineZh: text(o.conflictEngineZh, 320),
    relationshipEngineZh: text(o.relationshipEngineZh, 320),
    episodeProgressionZh: list(o.episodeProgressionZh, 16, 180),
    variationRulesZh: list(o.variationRulesZh, 16, 180),
  };
  return story.corePromiseZh
    && story.conflictEngineZh
    && story.relationshipEngineZh
    && story.episodeProgressionZh.length
    && story.variationRulesZh.length
    ? story
    : undefined;
}

function parseManhuaViralTemplateRevision(
  raw: unknown,
): ManhuaViralTemplateRevision | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaViralTemplateRevision>;
  const parentTemplateId = String(o.parentTemplateId || "").trim();
  const requestId = String(o.requestId || "").trim();
  const promptZh = String(o.promptZh || "").trim();
  const modelName = String(o.modelName || "").trim();
  const createdAt = String(o.createdAt || "").trim();
  const model = o.model;
  const modelValues: readonly ManhuaViralTemplateOptimizeModel[] = [
    "terra_high",
    "kimi_k3_max",
    "claude_opus_5_high",
    "deepseek_v4_0813_high",
  ];
  const effort = o.reasoningEffort;
  if (
    !/^tpl_[a-z0-9_-]{1,60}$/i.test(parentTemplateId)
    || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)
    || !modelValues.includes(model as ManhuaViralTemplateOptimizeModel)
    || (effort !== "medium" && effort !== "high" && effort !== "max")
    || !promptZh
    || !modelName
    || modelName.length > 80
    || !createdAt
    || createdAt.length > 40
    || !Number.isFinite(Date.parse(createdAt))
    || !Number.isInteger(o.createdByUserId)
    || Number(o.createdByUserId) <= 0
  ) {
    return undefined;
  }
  const changedFields = (Array.isArray(o.changedFields) ? o.changedFields : [])
    .filter((field): field is ManhuaViralTemplateOptimizeField =>
      MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS.includes(field as ManhuaViralTemplateOptimizeField),
    );
  const reasons = (Array.isArray(o.reasons) ? o.reasons : [])
    .map((reason) => ({
      field: String((reason as ManhuaViralTemplateChangeReason).field || "") as ManhuaViralTemplateOptimizeField,
      reasonZh: String((reason as ManhuaViralTemplateChangeReason).reasonZh || "").trim().slice(0, 240),
    }))
    .filter((reason) =>
      MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS.includes(reason.field) && Boolean(reason.reasonZh),
    );
  if (!changedFields.length || changedFields.some((field) => !reasons.some((r) => r.field === field))) {
    return undefined;
  }
  return {
    parentTemplateId: parentTemplateId.slice(0, 64),
    requestId: requestId.slice(0, 80),
    model: model as ManhuaViralTemplateOptimizeModel,
    modelName,
    reasoningEffort: effort,
    promptZh: promptZh.slice(0, 2_000),
    changedFields: Array.from(new Set(changedFields)),
    reasons,
    createdByUserId: Number(o.createdByUserId),
    createdAt,
  };
}

/**
 * 公开功能卡（普通用户唯一可见形态）。商业机密边界：内部 id / 真名 / 来源 / 学习出处 /
 * 节拍与场景自由文本一概不出现——字段显式逐个构造，禁止从内部卡展开（fail-closed）。
 */
export type PublicManhuaViralTemplateCard = {
  /** 稳定公开句柄：`mt_${publicCode 小写}`；扩写入参可直接用它选模板 */
  publicId: string;
  /** 匿名展示名：`${laneZh}·爆款节奏 ${publicCode}` */
  nameZh: string;
  laneZh: ManhuaViralTemplateLane;
  classificationTagsZh: string[];
  beatCount: number;
  densityLevel: "standard" | "dense";
  /** 前台文案（人工润色的零具名稿，服务端文案表供给） */
  featureZh: string;
  introZh: string;
};

export function makePublicTemplateId(publicCode: string): string {
  return `mt_${String(publicCode || "").trim().toLowerCase()}`;
}

export function makeAnonymousTemplateNameZh(
  laneZh: ManhuaViralTemplateLane,
  publicCode: string,
): string {
  return `${laneZh}·爆款节奏 ${String(publicCode || "").trim().toUpperCase()}`;
}

/** 无 publicCode 的卡返回 null（调用方跳过并告警）——逼着回填先行，绝不回退成可反查的内部 id */
export function toPublicManhuaViralTemplateCard(
  card: ManhuaViralTemplateCard,
  copy?: { featureZh?: string; introZh?: string } | null,
): PublicManhuaViralTemplateCard | null {
  const code = String(card.publicCode || "").trim();
  if (!/^[A-Z0-9]{4,16}$/.test(code)) return null;
  const learnedClassificationTagsZh = flattenManhuaTemplateClassification(card.classification);
  // 存量 approved 卡没有新 classification 字段时，公开面必须与私有分组采用同一
  // 兼容口径；否则卡虽然能显示，却永远无法被编剧室推荐器命中。
  const classificationTagsZh = learnedClassificationTagsZh.length
    ? learnedClassificationTagsZh
    : [String(card.laneZh || "未分类").trim() || "未分类"];
  const primary = classificationTagsZh[0]!;
  return {
    publicId: makePublicTemplateId(code),
    nameZh: `${primary}·创作模板 ${code}`,
    laneZh: card.laneZh,
    classificationTagsZh,
    beatCount: Array.isArray(card.beatGrid) ? card.beatGrid.length : 0,
    densityLevel: (card.densityHints?.minDialogueLines ?? 0) >= 10 ? "dense" : "standard",
    featureZh: String(copy?.featureZh || `${card.beatGrid.length} 拍连载节奏骨架`).slice(0, 120),
    introZh: String(
      copy?.introZh || `按 ${card.beatGrid.length} 个证据节拍组织剧情，核心特征：${classificationTagsZh.slice(0, 5).join("、") || "待重新学习"}。`,
    ).slice(0, 200),
  };
}

function parseManhuaViralTemplateProvenance(
  raw: unknown,
): ManhuaViralTemplateProvenance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as ManhuaViralTemplateProvenance;
  const out: ManhuaViralTemplateProvenance = {};
  if (o.frameVision && typeof o.frameVision === "object") {
    out.frameVision = {
      provider: String(o.frameVision.provider || "").slice(0, 20),
      model: String(o.frameVision.model || "").slice(0, 60),
      attemptedChunks: Math.max(0, Math.floor(Number(o.frameVision.attemptedChunks) || 0)),
      successChunks: Math.max(0, Math.floor(Number(o.frameVision.successChunks) || 0)),
    };
  }
  if (o.nativeVideoDeepRead && typeof o.nativeVideoDeepRead === "object") {
    const n = o.nativeVideoDeepRead;
    out.nativeVideoDeepRead = {
      model: String(n.model || "").slice(0, 60),
      attemptedSegments: Math.max(0, Math.floor(Number(n.attemptedSegments) || 0)),
      successSegments: Math.max(0, Math.floor(Number(n.successSegments) || 0)),
      shotCount: Math.max(0, Math.floor(Number(n.shotCount) || 0)),
      droppedCount: Math.max(0, Math.floor(Number(n.droppedCount) || 0)),
      truncated: Boolean(n.truncated),
      batchRequestId: /^[0-9a-f-]{16,64}$/i.test(String(n.batchRequestId || ""))
        ? String(n.batchRequestId)
        : undefined,
      batchEpisodeCount: Number.isInteger(Number(n.batchEpisodeCount))
        ? Math.max(1, Math.min(200, Number(n.batchEpisodeCount)))
        : undefined,
      usingPlanQuota: typeof n.usingPlanQuota === "boolean" ? n.usingPlanQuota : undefined,
      costCny: Math.max(0, Number(n.costCny) || 0),
    };
  }
  if (o.nativeAudioDeepRead && typeof o.nativeAudioDeepRead === "object") {
    const a = o.nativeAudioDeepRead;
    out.nativeAudioDeepRead = {
      model: String(a.model || "").slice(0, 60),
      hasAudio: a.hasAudio === true,
      alignmentMethod: String(a.alignmentMethod || "").slice(0, 60),
      chunkCount: Math.max(0, Math.floor(Number(a.chunkCount) || 0)),
      beatCount: Math.max(0, Math.floor(Number(a.beatCount) || 0)),
      costCny: Math.max(0, Number(a.costCny) || 0),
    };
  }
  if (o.nativeSeriesAggregation && typeof o.nativeSeriesAggregation === "object") {
    const s = o.nativeSeriesAggregation;
    const snapshotSha256 = String(s.snapshotSha256 || "").trim().toLowerCase();
    const aggregatedAt = String(s.aggregatedAt || "").trim();
    if (
      (s.route === "beijing_token_plan_text" || s.route === "openrouter_text")
      && typeof s.usingPlanQuota === "boolean"
      && /^[a-f0-9]{64}$/.test(snapshotSha256)
      && Number.isFinite(Date.parse(aggregatedAt))
    ) {
      out.nativeSeriesAggregation = {
        model: String(s.model || "").slice(0, 60),
        route: s.route,
        sourceEpisodeCount: Math.max(0, Math.floor(Number(s.sourceEpisodeCount) || 0)),
        firstEpisodeIndex: Math.max(0, Math.floor(Number(s.firstEpisodeIndex) || 0)),
        lastEpisodeIndex: Math.max(0, Math.floor(Number(s.lastEpisodeIndex) || 0)),
        inputTokens: Math.max(0, Math.floor(Number(s.inputTokens) || 0)),
        outputTokens: Math.max(0, Math.floor(Number(s.outputTokens) || 0)),
        costUsd: Number.isFinite(Number(s.costUsd)) ? Math.max(0, Number(s.costUsd)) : undefined,
        priceEquivalentCny: Math.max(0, Number(s.priceEquivalentCny) || 0),
        usingPlanQuota: s.usingPlanQuota,
        snapshotSha256,
        aggregatedAt,
      };
    }
  }
  if (o.proposalPolish && typeof o.proposalPolish === "object") {
    out.proposalPolish = {
      provider: String(o.proposalPolish.provider || "").slice(0, 20),
      model: String(o.proposalPolish.model || "").slice(0, 60),
      attempted: o.proposalPolish.attempted === true,
      success: o.proposalPolish.success === true,
      degraded: o.proposalPolish.degraded === true || undefined,
    };
  }
  if (o.seriesAggregation && typeof o.seriesAggregation === "object") {
    out.seriesAggregation = {
      mode: "frame_vision_deterministic",
      sourceChunks: Math.max(0, Math.floor(Number(o.seriesAggregation.sourceChunks) || 0)),
      success: o.seriesAggregation.success === true,
    };
  }
  // 判据收口（0824）：原先在这里逐个列举已知字段，等于把「这份 provenance 有没有内容」
  // 写了第二遍——加 nativeVideoDeepRead 时只改了上面的解析分支，这里没跟着改，
  // 结果卡片写得进、读出来 provenance 恒为 undefined，且**不报错**。
  // 改成按键数判断：以后再加来源，不需要再同步改这一行。
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 种子库 ∪ 动态 extras；同 id 以 extras 为准（后写覆盖）。
 * 用于 GCS approved 与出厂种子合并，避免改 TypeScript 数组。
 */
export function mergeManhuaViralTemplateBanks(
  seed: readonly ManhuaViralTemplateCard[],
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard[] {
  const map = new Map<string, ManhuaViralTemplateCard>();
  for (const t of seed) {
    if (t?.id) map.set(t.id, t);
  }
  for (const t of extras || []) {
    if (t?.id) map.set(t.id, t);
  }
  return Array.from(map.values());
}

export function getManhuaViralTemplate(
  id?: string | null,
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard | null {
  const key = String(id || "").trim();
  if (!key) return null;
  const bank = mergeManhuaViralTemplateBanks(MANHUA_VIRAL_TEMPLATE_BANK, extras);
  return bank.find((t) => t.id === key) || null;
}

/** 产品可选列表：仅 approved（可注入 GCS 动态库） */
export function listApprovedManhuaViralTemplates(
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard[] {
  return mergeManhuaViralTemplateBanks(MANHUA_VIRAL_TEMPLATE_BANK, extras).filter(
    (t) => t.status === "approved",
  );
}

export function listApprovedManhuaViralTemplatesGrouped(
  extras?: readonly ManhuaViralTemplateCard[] | null,
): Array<{
  /** 保留字段名兼容现有 tRPC/UI；值已是模型多标签，不再是旧题材赛道。 */
  laneZh: string;
  items: ManhuaViralTemplateCard[];
}> {
  const approved = listApprovedManhuaViralTemplates(extras);
  const groups = new Map<string, ManhuaViralTemplateCard[]>();
  for (const card of approved) {
    const classificationTags = flattenManhuaTemplateClassification(card.classification);
    const groupingTags = classificationTags.length
      ? classificationTags
      : [String(card.laneZh || "未分类").trim() || "未分类"];
    for (const tag of groupingTags) {
      const rows = groups.get(tag) || [];
      rows.push(card);
      groups.set(tag, rows);
    }
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([laneZh, items]) => ({ laneZh, items }));
}

/** 编剧室“推荐 Skill”：只在题材明确命中时推荐，不为凑数强塞模板。 */
export function recommendApprovedManhuaViralTemplate(
  cards: readonly ManhuaViralTemplateCard[],
  topic: string | null | undefined,
): ManhuaViralTemplateCard | null {
  const text = String(topic || "").trim();
  if (!text) return null;
  return cards
    .filter((card) => card.status === "approved")
    .map((card) => ({
      card,
      score: (flattenManhuaTemplateClassification(card.classification).length
        ? flattenManhuaTemplateClassification(card.classification)
        : [String(card.laneZh || "").trim()].filter(Boolean))
        .reduce((sum, tag) => sum + (text.includes(tag) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .find((row) => row.score > 0)?.card || null;
}

/** 公开卡版推荐器：服务端只下发 approved，故无需 status 过滤；按赛道正则匹配题材 */
export function recommendPublicManhuaViralTemplate(
  cards: readonly PublicManhuaViralTemplateCard[],
  topic: string | null | undefined,
): PublicManhuaViralTemplateCard | null {
  const text = String(topic || "").trim();
  if (!text) return null;
  return cards
    .map((card) => ({
      card,
      score: card.classificationTagsZh.reduce((sum, tag) => sum + (text.includes(tag) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .find((row) => row.score > 0)?.card || null;
}

/** 卡片里的骨架与密度都按长档 12 段填写，折算短档时以它为分母 */
const LONG_TIER_SEGMENTS = manhuaEpisodeSegmentsForTier("long");

/**
 * 把模板节拍格套到目标段数上。
 *
 * 卡片里存的是长档骨架（12 拍 × 15s = 180s）。短档一集只有 6 段，若原样注入，
 * 编剧会照着 165s 的弧线写，后半永远拍不出来。段长恒定 15s，所以这里只做两件事：
 * 按目标段数等距抽稀（必留开场与片尾钩子），再按 15s 重打时间戳。
 */
export function fitManhuaViralBeatGridToSegments(
  beatGrid: readonly ManhuaViralTemplateBeat[],
  segments: number,
): ManhuaViralTemplateBeat[] {
  // 原来先 slice(0,16) 再等距抽：抽帧 24 拍时无碍，但精读 95 镜会只用到前 16 个
  // （相当于只看全片前 1/6），后段的爆点与收束全部拿不到。改为在完整镜头集上等距采样。
  const src = beatGrid.filter(Boolean);
  const want = Math.max(1, Math.floor(segments));
  if (!src.length) return [];
  const picked =
    src.length <= want
      ? src.slice()
      : Array.from({ length: want }, (_, i) =>
          src[
            want === 1 ? 0 : Math.round((i * (src.length - 1)) / (want - 1))
          ],
        );
  return picked.map((b, i) => ({
    ...b,
    atSec: i * MANHUA_EPISODE_SEGMENT_DURATION_SEC,
  }));
}

/**
 * 把卡片的密度建议套到目标段数上，并抬到门禁线。
 *
 * 卡片里的 8 句对白是长档口径的手写估值，而门禁按每段 3 句算，长档要 30 句。
 * 直接把 8 句发给编剧，他写完就卡门禁，退回来重写——写多少都在门禁线下。
 */
export function fitManhuaViralDensityHintsToSegments(
  hints: ManhuaViralTemplateDensityHints,
  segments: number,
): ManhuaViralTemplateDensityHints {
  const want = Math.max(1, Math.floor(segments));
  const floors = manhuaEpisodeDensityFloors(want * MANHUA_EPISODE_SEGMENT_DURATION_SEC);
  const scale = want / LONG_TIER_SEGMENTS;
  return {
    minBodyChars: Math.max(floors.minBody, Math.round(hints.minBodyChars * scale)),
    minDialogueLines: Math.max(floors.minDlg, Math.round(hints.minDialogueLines * scale)),
    minLocationHits: Math.max(floors.minLoc, hints.minLocationHits),
  };
}

/** 由完整卡片生成编剧扩写注入块 */
export function formatManhuaViralTemplateWriterAddonFromCard(
  tpl: ManhuaViralTemplateCard | null | undefined,
  lengthTierId?: string | null,
): string {
  if (!tpl || tpl.status !== "approved") return "";
  const tier = getManhuaEpisodeLengthTier(lengthTierId);
  const segments = manhuaEpisodeSegmentsForTier(tier.id);
  const beats = fitManhuaViralBeatGridToSegments(tpl.beatGrid, segments)
    .map((b) => `- ${b.atSec}s｜${b.conflictZh}｜${b.visualZh}`)
    .join("\n");
  const d = fitManhuaViralDensityHintsToSegments(tpl.densityHints, segments);
  const audioBeats = tpl.audioStory?.hasAudio
    ? fitManhuaViralBeatGridToSegments(
        tpl.audioStory.audioTrack.map((track) => ({
          atSec: track.fromSec,
          endSec: track.toSec,
          conflictZh: track.emotionArcZh,
          visualZh: [
            track.toneZh,
            track.sfxZh,
            track.bgmZh,
            track.atmosphereZh,
            track.silenceZh,
          ].filter(Boolean).join("；"),
        })),
        segments,
      ).map((beat) => `- ${beat.atSec}s｜${beat.conflictZh}｜${beat.visualZh}`).join("\n")
    : "";
  return [
    "【节奏模板·骨架建议】",
    `模板：${tpl.nameZh}`,
    tpl.classification ? `多维特征：${flattenManhuaTemplateClassification(tpl.classification).join("、")}` : "",
    tpl.summaryZh ? `用途：${tpl.summaryZh}` : "",
    tpl.storyStructure?.corePromiseZh
      ? `核心故事承诺：${tpl.storyStructure.corePromiseZh}`
      : "",
    tpl.storyStructure?.conflictEngineZh
      ? `持续冲突引擎：${tpl.storyStructure.conflictEngineZh}`
      : "",
    tpl.storyStructure?.relationshipEngineZh
      ? `关系变化引擎：${tpl.storyStructure.relationshipEngineZh}`
      : "",
    tpl.storyStructure?.episodeProgressionZh.length
      ? `跨集推进规律：${tpl.storyStructure.episodeProgressionZh.join("；")}`
      : "",
    tpl.storyStructure?.variationRulesZh.length
      ? `避免重复规则：${tpl.storyStructure.variationRulesZh.join("；")}`
      : "",
    `前3秒钩子：${tpl.hook3sZh}`,
    `人设槽：欲望=${tpl.castShape.leadDesireZh}；压迫=${tpl.castShape.pressureZh}${
      tpl.castShape.foilZh ? `；对照=${tpl.castShape.foilZh}` : ""
    }`,
    tpl.scenePoolHints.length
      ? `场景池关键词（写入场景表，勿写外部剧名）：${tpl.scenePoolHints.join("、")}`
      : "",
    tpl.audioStory?.audioBeatStructureZh ? `声音节奏规律：${tpl.audioStory.audioBeatStructureZh}` : "",
    tpl.audioStory?.mixNotesZh ? `混音规律：${tpl.audioStory.mixNotesZh}` : "",
    tpl.audioStory?.reusableAudioZh ? `可复用声音手法：${tpl.audioStory.reusableAudioZh}` : "",
    `密度建议（约${tier.targetSec}秒/集·${segments}段）：正文≥${d.minBodyChars}字；「」对白≥${d.minDialogueLines}句；场景表命中≥${d.minLocationHits}`,
    beats ? `节拍格：\n${beats}` : "",
    audioBeats ? `声音节拍格（只借功能，不复刻原句）：\n${audioBeats}` : "",
    "硬规则：只借结构与节奏；禁止抄外部剧名/台词/商标；成稿只写可拍动作与关系。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 编剧室消费版 Skill：只给分类与能力简介，把具体情节和节拍留给当前大模型发挥。 */
export function formatManhuaViralTemplateWriterSkillFromCard(
  tpl: ManhuaViralTemplateCard | null | undefined,
): string {
  if (!tpl || tpl.status !== "approved") return "";
  return [
    tpl.classification ? `多维特征：${flattenManhuaTemplateClassification(tpl.classification).join("、")}` : "",
    `能力简介：${tpl.summaryZh}`,
    tpl.storyStructure?.corePromiseZh
      ? `核心故事承诺：${tpl.storyStructure.corePromiseZh}`
      : "",
    tpl.storyStructure?.conflictEngineZh
      ? `持续冲突引擎：${tpl.storyStructure.conflictEngineZh}`
      : "",
    tpl.storyStructure?.relationshipEngineZh
      ? `关系变化引擎：${tpl.storyStructure.relationshipEngineZh}`
      : "",
    tpl.storyStructure?.episodeProgressionZh.length
      ? `跨集推进规律：${tpl.storyStructure.episodeProgressionZh.join("；")}`
      : "",
    tpl.storyStructure?.variationRulesZh.length
      ? `避免重复规则：${tpl.storyStructure.variationRulesZh.join("；")}`
      : "",
    // 原生精读独有的两栏：不带进来，学到的导演手法就永远进不了扩写模型，
    // 等于花钱学了一份只能看不能用的报告
    tpl.reusableZh ? `可复用导演手法：${tpl.reusableZh}` : "",
    tpl.genPromptHintZh ? `生成画面要素：${tpl.genPromptHintZh}` : "",
    tpl.audioStory?.audioBeatStructureZh ? `声音节奏结构：${tpl.audioStory.audioBeatStructureZh}` : "",
    tpl.audioStory?.mixNotesZh ? `混音结构：${tpl.audioStory.mixNotesZh}` : "",
    tpl.audioStory?.reusableAudioZh ? `可复用声音手法：${tpl.audioStory.reusableAudioZh}` : "",
    "请结合当前题材自由发挥，不照搬来源剧情，不强制复刻固定节拍。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 注入编剧扩写：节拍格 + 密度 + 场景池关键词（不泄漏出处剧名） */
export function formatManhuaViralTemplateWriterAddon(
  id?: string | null,
  extras?: readonly ManhuaViralTemplateCard[] | null,
  lengthTierId?: string | null,
): string {
  return formatManhuaViralTemplateWriterAddonFromCard(
    getManhuaViralTemplate(id, extras),
    lengthTierId,
  );
}
