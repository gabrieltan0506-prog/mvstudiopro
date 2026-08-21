/**
 * 防废片编译器·确定性拼装层(零 LLM):镜级 IR → 段提示词(双方言)+TTS 台词表+
 * BGM brief + referencePlans(参考绑定计划,交提交适配器解析 URL)。
 * 本层不解析 URL、不提交任务、不计费;格式问题经 formatIssues 全量上抛不丢弃。
 */
import {
  assertCompilerEngineReady,
  COMPILER_ENGINE_LIMITS,
  packShotsIntoSegments,
  type CompilerEngineId,
  type CompilerEngineProfile,
  type EpisodeIR,
  type SegmentPlan,
  type ShotMediaRef,
} from "./manhuaShotIR";
import {
  formatPromptForEngine,
  validateSegmentMediaRefs,
  type FormatIssue,
} from "./promptFormatLayer";

/** 固定铁令段(法典七段式:画质/演技/正向锁定,常量拼装) */
const QUALITY_LOCK_ZH =
  "画面:1/500s 快门级清晰,开场三秒极致锐利;人物保留真实毛孔与皮肤质感,任何时刻活着,禁止蜡像式僵直。";
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
  startSec: number;
  endSec: number;
  speakerZh: string;
  textZh: string;
  instructionZh?: string;
};

export type BgmBrief = {
  styleTags: string[];
  negativeTags: string;
  segments: Array<{ index: number; durationSec: number; moodZh: string }>;
  suno: { instrumental: true; durationSec: number; customMode: false };
};

export type CompiledReferencePlan = {
  segmentIndex: number;
  mode:
    | "seedance_reference"
    | "h3_reference_to_video"
    | "h3_text_to_video"
    | "wan_reserved";
  bindings: ShotMediaRef[];
};

export type CompiledEpisode = {
  engine: CompilerEngineId;
  segments: SegmentPlan[];
  segmentPrompts: string[];
  ttsCueSheet: TtsCue[];
  bgmBrief: BgmBrief;
  formatIssues: Array<FormatIssue & { segmentIndex: number }>;
  referencePlans: CompiledReferencePlan[];
};

function formatSeedanceMediaReference(ref: ShotMediaRef): string {
  const marker =
    ref.kind === "image" ? `@图${ref.n}` : ref.kind === "video" ? `@视频${ref.n}` : `@音频${ref.n}`;
  return `${marker} 定义${ref.roleZh}，仅本窗生效`;
}

function formatH3MediaReference(ref: ShotMediaRef): string {
  const marker =
    ref.kind === "image" ? `Image ${ref.n}` : ref.kind === "video" ? `Video ${ref.n}` : `Audio ${ref.n}`;
  return `${marker} 仅用于${ref.roleZh}`;
}

type PositionedShot = SegmentPlan["shots"][number] & { startSec: number };

function shotLineSeedance(shot: PositionedShot): string {
  const end = shot.startSec + shot.durationSec;
  const parts = [
    `[${shot.startSec}-${end}s 第${shot.index}镜]`,
    `场景:${shot.sceneZh}`,
    `动作:${shot.actionZh}`,
    shot.cameraZh ? `运镜:${shot.cameraZh}` : "",
    shot.microExpressionZh ? `表演:${shot.microExpressionZh}` : "",
    shot.dialogue
      ? `${shot.dialogue.speakerZh}${shot.dialogue.emotionZh ? `(${shot.dialogue.emotionZh})` : ""}说 {${shot.dialogue.textZh}}`
      : "",
    shot.sfxZh ? `<${shot.sfxZh}>` : "",
    (shot.mediaRefs ?? []).map(formatSeedanceMediaReference).join("；"),
  ].filter(Boolean);
  return parts.join(" · ");
}

function shotLineH3(shot: PositionedShot): string {
  const end = shot.startSec + shot.durationSec;
  const parts = [
    `[00:${String(shot.startSec).padStart(2, "0")}-00:${String(end).padStart(2, "0")}]`,
    `场景为${shot.sceneZh}`,
    `人物动作是${shot.actionZh}`,
    shot.cameraZh ? `镜头${shot.cameraZh}` : "",
    shot.microExpressionZh || "",
    shot.dialogue
      ? `${shot.dialogue.speakerZh}${shot.dialogue.emotionZh ? `以${shot.dialogue.emotionZh}的语气` : ""}说：“${shot.dialogue.textZh}”`
      : "",
    shot.sfxZh ? `环境声为${shot.sfxZh}` : "",
    (shot.mediaRefs ?? []).map(formatH3MediaReference).join("，"),
  ].filter(Boolean);
  return parts.join(",");
}

/**
 * 公开单段入口的完整结构终检。
 * compileSegmentPrompt 是公开函数，必须自行拒绝 NaN、空镜、
 * 镜头时长不一致和镜号倒序。
 */
function assertSegmentPlanValid(segment: SegmentPlan, profile: CompilerEngineProfile): void {
  const duration = Number(segment.durationSec);

  if (!Number.isFinite(duration)) {
    throw new RangeError(`第 ${segment.index} 段时长必须为有限数字`);
  }

  if (!Array.isArray(segment.shots) || segment.shots.length === 0) {
    throw new RangeError(`第 ${segment.index} 段至少需要一镜`);
  }

  let shotTotalSec = 0;
  let previousShotIndex = -Infinity;

  for (const shot of segment.shots) {
    const shotDuration = Number(shot.durationSec);

    if (!Number.isFinite(shotDuration) || shotDuration <= 0) {
      throw new RangeError(`第 ${shot.index} 镜时长必须为有限正数`);
    }

    if (!Number.isInteger(shot.index) || shot.index < 1) {
      throw new RangeError(`镜号必须为从 1 开始的正整数，当前为 ${shot.index}`);
    }

    if (shot.index <= previousShotIndex) {
      throw new RangeError(`第 ${segment.index} 段镜号必须严格递增`);
    }

    if (!String(shot.sceneZh || "").trim() || !String(shot.actionZh || "").trim()) {
      throw new RangeError(`第 ${shot.index} 镜缺少场景或动作`);
    }

    previousShotIndex = shot.index;
    shotTotalSec += shotDuration;
  }

  if (Math.abs(shotTotalSec - duration) > 0.000001) {
    throw new RangeError(
      `第 ${segment.index} 段声明时长 ${duration}s，与镜头时长合计 ${shotTotalSec}s 不一致`,
    );
  }

  if (duration < profile.minSegmentSec) {
    throw new RangeError(
      `第 ${segment.index} 段为 ${duration}s，低于该引擎单段最短 ${profile.minSegmentSec}s，请合并镜头或调整节拍`,
    );
  }

  if (duration > profile.maxSegmentSec) {
    throw new RangeError(
      `第 ${segment.index} 段为 ${duration}s，超过该引擎单段最长 ${profile.maxSegmentSec}s`,
    );
  }

  if (profile.requiresIntegerSegmentSec && !Number.isInteger(duration)) {
    throw new RangeError(
      `第 ${segment.index} 段为 ${duration}s，该引擎只接受整数时长，请调整镜时长`,
    );
  }
}

/** 单段提示词(方言分流;头=风格句+画质铁令,尾=正向锁定);内部版连问题一起返回 */
function compileSegmentPromptResult(
  segment: SegmentPlan,
  engine: CompilerEngineId,
  styleZh?: string,
): { prompt: string; issues: FormatIssue[] } {
  assertCompilerEngineReady(engine);
  const profile = COMPILER_ENGINE_LIMITS[engine];
  assertSegmentPlanValid(segment, profile);

  const dialect = profile.dialect;
  let startSec = 0;
  const lines: string[] = [];
  for (const shot of segment.shots) {
    const withStart: PositionedShot = { ...shot, startSec };
    lines.push(dialect === "seedance" ? shotLineSeedance(withStart) : shotLineH3(withStart));
    startSec += shot.durationSec;
  }
  const head =
    dialect === "seedance"
      ? `【第${String(segment.index).padStart(2, "0")}段·${segment.durationSec}s】${styleZh ? ` ${styleZh}` : ""}`
      : `${styleZh ? `${styleZh}。` : ""}本段时长约${segment.durationSec}秒。`;
  const raw = [head, QUALITY_LOCK_ZH, ...lines, POSITIVE_LOCK_ZH].join("\n");
  const formatted = formatPromptForEngine(raw, engine, { durationSec: segment.durationSec });
  return { prompt: formatted.text, issues: formatted.issues };
}

/** 单段提示词公开入口:与内部版同一道闸(reserved 拒 + 时长终检) */
export function compileSegmentPrompt(
  segment: SegmentPlan,
  engine: CompilerEngineId,
  styleZh?: string,
): string {
  return compileSegmentPromptResult(segment, engine, styleZh).prompt;
}

/** TTS 台词表:段内起止秒位(秒锁母轨用) */
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
          endSec: startSec + shot.durationSec,
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

/** 段内参考原始收集(不去重,供冲突校验) */
function collectRawSegmentRefs(segment: SegmentPlan): ShotMediaRef[] {
  return segment.shots.flatMap((shot) => shot.mediaRefs ?? []);
}

/** 段内参考去重收集(kind:n 同槽保留第一项,与格式层口径一致) */
function collectSegmentRefs(rawRefs: ShotMediaRef[]): ShotMediaRef[] {
  const slotMap = new Map<string, ShotMediaRef>();
  for (const ref of rawRefs) {
    const key = `${ref.kind}:${ref.n}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, ref);
    }
  }
  return Array.from(slotMap.values());
}

/** 总入口:IR + 引擎 → 编译产物;reserved 引擎(wan-3.0)明确拒绝不产伪结果 */
export function compileEpisode(ir: EpisodeIR, engine: CompilerEngineId): CompiledEpisode {
  assertCompilerEngineReady(engine);

  if (ir.shots.length === 0) {
    throw new Error("剧集 IR 至少需要一镜");
  }
  ir.shots.forEach((shot, index) => {
    if (shot.index !== index + 1) {
      throw new Error(`镜号必须从 1 连续排列，当前位置收到 ${shot.index}`);
    }
    if (!shot.sceneZh.trim() || !shot.actionZh.trim()) {
      throw new Error(`第 ${shot.index} 镜缺少场景或动作`);
    }
  });

  const profile = COMPILER_ENGINE_LIMITS[engine];
  const segments = packShotsIntoSegments(ir.shots, profile.maxSegmentSec);

  const compiled = segments.map((segment) => {
    const rawRefs = collectRawSegmentRefs(segment);
    const refs = collectSegmentRefs(rawRefs);
    const promptResult = compileSegmentPromptResult(segment, engine, ir.styleZh);
    return {
      segment,
      prompt: promptResult.prompt,
      refs,
      issues: [
        ...promptResult.issues,
        ...validateSegmentMediaRefs(rawRefs, profile.references),
      ],
    };
  });

  return {
    engine,
    segments,
    segmentPrompts: compiled.map((item) => item.prompt),
    formatIssues: compiled.flatMap((item) =>
      item.issues.map((issue) => ({ ...issue, segmentIndex: item.segment.index })),
    ),
    referencePlans: compiled.map((item) => ({
      segmentIndex: item.segment.index,
      mode:
        profile.dialect === "h3"
          ? item.refs.length > 0
            ? "h3_reference_to_video"
            : "h3_text_to_video"
          : "seedance_reference",
      bindings: item.refs,
    })),
    ttsCueSheet: buildTtsCueSheet(segments),
    bgmBrief: buildBgmBrief(ir, segments),
  };
}
