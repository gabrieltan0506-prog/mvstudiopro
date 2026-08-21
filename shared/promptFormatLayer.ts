/**
 * 格式层规则引擎(零 token 零计费):标记归一化、避审替换、引擎钳制、
 * 多模态参考数量与时长校验。确定性纯函数,「整理格式(免费)」按钮直调。
 */
import {
  COMPILER_ENGINE_LIMITS,
  type CompilerEngineId,
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
  const limits = COMPILER_ENGINE_LIMITS[engine];
  const issues: FormatIssue[] = [];
  let text = String(raw || "").trim();

  text = normalizeImageRefs(text);
  if (limits.dialect === "seedance") {
    text = normalizeDialogueMarkers(text);
  } else {
    // H3/wan 自然语言方向:三类参考编号化,剥四标记与括号
    text = normalizeH3ReferenceMarkers(text);
    text = text.replace(/\{([^{}]{1,80})\}/g, "“$1”");
    text = text.replace(/[<＜]([^<>＜＞]{1,80})[>＞]/g, "$1");
    text = text.replace(/【([^【】]{1,80})】/g, "$1");
    text = text.replace(/[（(]([^()（）]{1,80})[)）]/g, "$1");
  }

  const censored = applyCensorReplacements(text);
  text = censored.text;
  for (const r of censored.replaced) {
    issues.push({ kind: "censor", detailZh: `已替换易拒审措辞(${r})` });
  }

  let clampedDurationSec: number | undefined;
  const dur = Number(opts?.durationSec);
  if (Number.isFinite(dur) && dur > limits.maxSegmentSec) {
    clampedDurationSec = limits.maxSegmentSec;
    issues.push({
      kind: "duration",
      detailZh: `该引擎单段上限 ${limits.maxSegmentSec}s,已按上限钳制(原 ${dur}s)`,
    });
  }
  const refs = Number(opts?.imageRefCount);
  if (Number.isFinite(refs) && refs > limits.references.image) {
    issues.push({
      kind: "image_refs",
      detailZh: `该引擎参考图上限 ${limits.references.image} 张,当前 ${refs} 张,请精简`,
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

  const uniqueRefs = (kind: ShotMediaRefKind) =>
    Array.from(
      new Map(
        refs.filter((ref) => ref.kind === kind).map((ref) => [`${ref.kind}:${ref.n}`, ref]),
      ).values(),
    );

  const images = uniqueRefs("image");
  const videos = uniqueRefs("video");
  const audios = uniqueRefs("audio");
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
