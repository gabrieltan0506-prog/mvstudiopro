/**
 * 格式层规则引擎(零 token 零计费):标记归一化、避审替换、引擎钳制、
 * 多模态参考数量与时长校验。确定性纯函数,「整理格式(免费)」按钮直调。
 */
import {
  assertCompilerEngineReady,
  COMPILER_ENGINE_LIMITS,
  type CompilerEngineId,
  type CompilerEngineProfile,
  type CompilerReferenceLimits,
  type ShotMediaRef,
  type ShotMediaRefKind,
} from "./manhuaShotIR";

/** 避审替换表(知识库·避审词库精选;音频层也咬危词) */
const CENSOR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/子弹时间/g, "极慢速凝滞瞬间"],
  [/开枪|枪击/g, "武器击发"],
  [/爆头/g, "命中要害"],
  [/血浆|血肉横飞/g, "战损痕迹"],
  [/陪葬|去死/g, "付出代价"],
  [/杀了(他|她|你)/g, "制服$1"],
];

/** 图引用归一:图一/图 1/图片1/@图片1/[图1] → @图1 */
const IMAGE_REF_RE = /[@［\[]?\s*图(?:片)?\s*([0-9一二三四五六七八九十]+)[\]］]?[:：]?/g;
const CN_NUM: Record<string, string> = {
  一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10",
};

function toArabic(n: string): string {
  return CN_NUM[n] ?? n;
}

/** 中文引号台词 → Seedance {} 对白标记;已是 {} 的不动 */
function normalizeDialogueMarkers(text: string): string {
  return text.replace(/[「『]([^」』{}]{1,80})[」』]/g, "{$1}");
}

/** 图引用统一为 @图N */
export function normalizeImageRefs(text: string): string {
  return text.replace(IMAGE_REF_RE, (_m, num: string) => `@图${toArabic(num)}`);
}

/** H3 三类参考标记:@图N/@视频N/@音频N → Image/Video/Audio N */
export function normalizeH3ReferenceMarkers(text: string): string {
  return text
    .replace(/@(?:图|图片)(\d+)/g, "Image $1")
    .replace(/@(?:视频|影片)(\d+)/g, "Video $1")
    .replace(/@(?:音频|声音)(\d+)/g, "Audio $1");
}

/** 避审替换(逐条查表;新词只进表不散写) */
export function applyCensorReplacements(text: string): { text: string; replaced: string[] } {
  let out = text;
  const replaced: string[] = [];
  for (const [re, to] of CENSOR_REPLACEMENTS) {
    if (re.test(out)) {
      replaced.push(re.source);
      out = out.replace(re, to);
    }
    re.lastIndex = 0;
  }
  return { text: out, replaced };
}

export type FormatIssue = { kind: string; detailZh: string };

/**
 * censor 表示确定性替换已经完成，只作为变更记录。
 * 其余问题默认阻止后续提交。
 */
const NON_BLOCKING_FORMAT_ISSUE_KINDS = new Set<string>(["censor"]);

export function isBlockingFormatIssue(issue: FormatIssue): boolean {
  return !NON_BLOCKING_FORMAT_ISSUE_KINDS.has(issue.kind);
}

export function hasBlockingFormatIssues(issues: readonly FormatIssue[]): boolean {
  return issues.some(isBlockingFormatIssue);
}

export type FormatResult = {
  text: string;
  issues: FormatIssue[];
  /** 引擎钳制后的建议时长(超上限时) */
  clampedDurationSec?: number;
};

/**
 * 一键整理:归一化标记 + 避审替换 + 引擎钳制检查。
 * H3 方言不吃 {}<>()【】标记 → 反向转回自然语言。
 */
export function formatPromptForEngine(
  raw: string,
  engine: CompilerEngineId,
  opts?: { durationSec?: number; imageRefCount?: number },
): FormatResult {
  // 任何公开入口先拦 reserved:Wan 不许落进 H3 分支产伪结果
  assertCompilerEngineReady(engine);

  const limits: CompilerEngineProfile = COMPILER_ENGINE_LIMITS[engine];
  const issues: FormatIssue[] = [];
  let text = String(raw || "").trim();

  if (!text) {
    return {
      text: "",
      issues: [{ kind: "prompt_empty", detailZh: "提示词不能为空" }],
    };
  }

  text = normalizeImageRefs(text);
  if (limits.dialect === "seedance") {
    text = normalizeDialogueMarkers(text);
  } else if (limits.dialect === "h3") {
    // H3 自然语言方向:三类参考编号化,剥四标记与括号
    text = normalizeH3ReferenceMarkers(text);
    text = text.replace(/\{([^{}]{1,80})\}/g, "“$1”");
    text = text.replace(/[<＜]([^<>＜＞]{1,80})[>＞]/g, "$1");
    text = text.replace(/【([^【】]{1,80})】/g, "$1");
    text = text.replace(/[（(]([^()（）]{1,80})[)）]/g, "$1");
  } else {
    throw new Error(`${engine} 的提示词方言尚未接线`);
  }

  const censored = applyCensorReplacements(text);
  text = censored.text;
  for (const r of censored.replaced) {
    issues.push({ kind: "censor", detailZh: `已替换易拒审措辞(${r})` });
  }

  let clampedDurationSec: number | undefined;
  const duration = Number(opts?.durationSec);
  if (Number.isFinite(duration)) {
    if (duration < limits.minSegmentSec) {
      issues.push({
        kind: "duration_min",
        detailZh: `该引擎单段最短 ${limits.minSegmentSec}s，当前 ${duration}s`,
      });
    }
    if (duration > limits.maxSegmentSec) {
      clampedDurationSec = limits.maxSegmentSec;
      issues.push({
        kind: "duration_max",
        detailZh: `该引擎单段最长 ${limits.maxSegmentSec}s，当前 ${duration}s`,
      });
    }
    if (limits.requiresIntegerSegmentSec && !Number.isInteger(duration)) {
      issues.push({
        kind: "duration_integer",
        detailZh: `该引擎输出时长必须为整数，当前 ${duration}s`,
      });
    }
  }
  const imageRefCount = Number(opts?.imageRefCount);
  if (Number.isFinite(imageRefCount) && imageRefCount > limits.references.image) {
    issues.push({
      kind: "image_refs",
      detailZh: `该引擎参考图上限 ${limits.references.image} 张，当前 ${imageRefCount} 张`,
    });
  }
  if (limits.maxPromptChars !== undefined && text.length > limits.maxPromptChars) {
    issues.push({
      kind: "prompt_length",
      detailZh: `该引擎提示词上限 ${limits.maxPromptChars} 字符，当前 ${text.length} 字符`,
    });
  }

  return { text, issues, clampedDurationSec };
}

/** 多模态参考统一校验(数量/合计/单段与合计时长);问题以 FormatIssue 返回供消费者读取 */
export function validateSegmentMediaRefs(
  refs: ShotMediaRef[],
  limits: CompilerReferenceLimits,
): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const slotMap = new Map<string, ShotMediaRef>();

  for (const ref of refs) {
    if (!Number.isInteger(ref.n) || ref.n < 1) {
      issues.push({
        kind: "reference_index",
        detailZh: `${ref.kind} 参考编号必须为从 1 开始的正整数，当前为 ${ref.n}`,
      });
      continue;
    }
    const key = `${ref.kind}:${ref.n}`;
    const previous = slotMap.get(key);
    if (previous) {
      const previousSource = String(previous.sourceAssetId || "").trim();
      const currentSource = String(ref.sourceAssetId || "").trim();
      if (previous.roleZh !== ref.roleZh || previousSource !== currentSource) {
        issues.push({
          kind: "reference_conflict",
          detailZh: `${ref.kind} ${ref.n} 同时绑定“${previous.roleZh}”与“${ref.roleZh}”，请拆成不同编号`,
        });
      }
      continue;
    }
    slotMap.set(key, ref);
  }

  const uniqueRefs = (kind: ShotMediaRefKind): ShotMediaRef[] =>
    Array.from(slotMap.values()).filter((ref) => ref.kind === kind);

  const validateSequence = (kind: ShotMediaRefKind, items: ShotMediaRef[]) => {
    const numbers = items.map((item) => item.n).sort((a, b) => a - b);
    const invalid = numbers.some((number, index) => number !== index + 1);
    if (invalid) {
      issues.push({
        kind: "reference_sequence",
        detailZh: `${kind} 参考编号必须从 1 连续排列，当前为 ${numbers.join(",")}`,
      });
    }
  };

  const images = uniqueRefs("image");
  const videos = uniqueRefs("video");
  const audios = uniqueRefs("audio");

  validateSequence("image", images);
  validateSequence("video", videos);
  validateSequence("audio", audios);

  const total = images.length + videos.length + audios.length;

  if (images.length > limits.image) {
    issues.push({
      kind: "image_refs",
      detailZh: `图片参考 ${images.length} 张，当前引擎上限 ${limits.image} 张`,
    });
  }
  if (videos.length > limits.video) {
    issues.push({
      kind: "video_refs",
      detailZh: `视频参考 ${videos.length} 段，当前引擎上限 ${limits.video} 段`,
    });
  }
  if (audios.length > limits.audio) {
    issues.push({
      kind: "audio_refs",
      detailZh: `音频参考 ${audios.length} 段，当前引擎上限 ${limits.audio} 段`,
    });
  }
  if (limits.total !== undefined && total > limits.total) {
    issues.push({
      kind: "total_refs",
      detailZh: `多模态参考合计 ${total} 项，当前引擎上限 ${limits.total} 项`,
    });
  }

  const validateTimedRefs = (
    items: ShotMediaRef[],
    labelZh: string,
    minItemSec: number | undefined,
    maxItemSec: number | undefined,
    maxTotalSec: number | undefined,
  ) => {
    const known = items.filter((item) => Number.isFinite(Number(item.durationSec)));
    for (const item of known) {
      const duration = Number(item.durationSec);
      if (minItemSec !== undefined && duration < minItemSec) {
        issues.push({
          kind: `${item.kind}_duration`,
          detailZh: `${labelZh} ${item.n} 时长 ${duration}s，最短 ${minItemSec}s`,
        });
      }
      if (maxItemSec !== undefined && duration > maxItemSec) {
        issues.push({
          kind: `${item.kind}_duration`,
          detailZh: `${labelZh} ${item.n} 时长 ${duration}s，最长 ${maxItemSec}s`,
        });
      }
    }
    const totalSec = known.reduce((sum, item) => sum + Number(item.durationSec), 0);
    if (maxTotalSec !== undefined && totalSec > maxTotalSec) {
      issues.push({
        kind: `${items[0]?.kind || "media"}_total_duration`,
        detailZh: `${labelZh}合计 ${totalSec}s，上限 ${maxTotalSec}s`,
      });
    }
  };

  validateTimedRefs(videos, "参考视频", limits.minVideoItemSec, limits.maxVideoItemSec, limits.maxVideoTotalSec);
  validateTimedRefs(audios, "参考音频", limits.minAudioItemSec, limits.maxAudioItemSec, limits.maxAudioTotalSec);

  return issues;
}
