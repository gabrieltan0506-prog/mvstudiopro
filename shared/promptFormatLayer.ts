/**
 * 格式层规则引擎(防废片编译器第一道防线,零 token 零计费):
 * 把用户随手写的提示词规整成目标引擎方言——标记归一化、@图N 绑定句式、
 * 引擎钳制、避审词替换。确定性纯函数,产品侧「整理格式(免费)」按钮直调。
 */
import { COMPILER_ENGINE_LIMITS, type CompilerEngineId } from "./manhuaShotIR";

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
    // H3:无特殊标记;{}回转为引号台词,@图N → Image N
    text = text.replace(/\{([^{}]{1,80})\}/g, "“$1”");
    text = text.replace(/@图(\d+)/g, "Image $1");
    text = text.replace(/[<＜]([^<>＜＞]{1,40})[>＞]/g, "$1");
    text = text.replace(/【([^【】]{1,40})】/g, "$1");
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
  if (Number.isFinite(refs) && refs > limits.maxImageRefs) {
    issues.push({
      kind: "image_refs",
      detailZh: `该引擎参考图上限 ${limits.maxImageRefs} 张,当前 ${refs} 张,请精简`,
    });
  }

  return { text, issues, clampedDurationSec };
}
