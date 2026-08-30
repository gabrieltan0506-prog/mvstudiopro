/**
 * 原生精读**内容质量**验收器。
 *
 * 为什么要有这个文件：探针 P1–P10 全是机制正确性（证据可对账、思考不混进
 * JSON、分片保留、费用入账），`summary.qualityAcceptance` 长期是
 * `not_reviewed`——也就是说「这一片读得好不好」从来没有任何一个函数在量，
 * 全靠人眼扫一遍说「感觉还行」。三天调参调不出稳定结果，一半原因在这里：
 * 没有基准点，也没有客观过关线。
 *
 * 边界（重要，别把这里写成第二把尺）：
 * · 30 秒证据段上限、段级覆盖率地板、JSON schema —— 归 advisory 门禁管，
 *   本文件**不重复实现**，用户立过「同一判断只能一个函数」。
 * · 证据可对账、费用回执、分片保留 —— 归探针 P 项管。
 * · 本文件只管 advisory 完全没有覆盖的那一块：**内容是不是被通用词填出来的**。
 *
 * 判准来自 0831 实锤（2026Aug31/PR1328-第1片重试退化诊断-20260831.json）：
 * 同一片重试后 shots 从 32 掉到 15，其中 12 条**逐字相同**，从 30 秒一路
 * 铺到 319 秒，finishReason=STOP（不是截断，是模型主动写少）。
 */

/** 参与「这两条镜头是不是同一段文字」判断的字段。只取描述性的，不取纯枚举。 */
const DESCRIPTION_FIELDS = [
  "actionZh", "blockingZh", "bodyActionZh", "compositionZh", "gazeBreathZh",
  "lightingZh", "limbPropActionZh", "microExpressionZh", "relationshipReactionZh",
  "transitionInZh", "visualZh", "conflictZh",
] as const;

/**
 * 字段取值多样性也要看的枚举字段。
 * ⚠️ 单独命中「中景」「平视」「固定机位」**不是**问题——它们是合法枚举值，
 * 真实镜头本来就大量使用。只有当整段几乎只有一种取值时才是填充信号。
 */
const VARIETY_FIELDS = [
  ...DESCRIPTION_FIELDS, "shotSizeZh", "angleZh", "cameraMoveZh", "unitTypeZh",
] as const;

export type NativeDeepReadQualityInput = {
  readonly shots: ReadonlyArray<Record<string, unknown>>;
  /** 段界，来自计划分片而不是模型产出——分母取模型自报会让烂结果自己给自己打高分。 */
  readonly startSec: number;
  readonly endSec: number;
};

export type NativeDeepReadQualityMetrics = {
  shotCount: number;
  spanSec: number;
  /** 段长 ÷ 镜数。0831 实测：健康约 10 秒/镜（32 镜/319 秒），退化到 21.3（15 镜）。 */
  secondsPerShot: number;
  /** 描述完全相同的行数，不含每组的首次出现。12 是那次灾难的数字。 */
  duplicateRows: number;
  duplicateRatio: number;
  /** 不同描述组合的种类数。=1 表示整段只有一种写法。 */
  uniqueDescriptionSets: number;
  /** 取值种类数塌缩的字段（≤ 镜数的 20%），镜数 <10 时不判。 */
  lowVarietyFields: string[];
  /** 描述字段的平均字数。0830 实测模型有输出总量自我配额：镜数越多每条越短。 */
  meanDescriptionChars: number;
};

export type NativeDeepReadQualityFailure = { code: string; detailZh: string };

export type NativeDeepReadQualityVerdict = {
  metrics: NativeDeepReadQualityMetrics;
  failures: NativeDeepReadQualityFailure[];
  /** pass=可以进下一关；fail=这一片不合格，别拿它当基准。 */
  status: "pass" | "fail";
};

/**
 * 过关线。**初版按 0831 已付费实测标定，第一片实跑后须回来复校。**
 * 每一条都写明来源，不写「凭感觉」的数字。
 */
export const NATIVE_DEEP_READ_QUALITY_THRESHOLDS = {
  /** 灾难那次是 0.80（12/15）。健康产出应接近 0，留 0.10 给真实的重复空镜。 */
  maxDuplicateRatio: 0.1,
  /** 健康 10 秒/镜，退化 21.3。定 18 秒，够宽但拦得住「12 条铺满 289 秒」。 */
  maxSecondsPerShot: 18,
  /** 整段只有一两种写法必然是填充，与比例无关，单独兜底。 */
  minUniqueDescriptionSets: 3,
  /** 镜数达到这个量才判字段多样性，否则短段会被误杀。 */
  varietyMinShots: 10,
  /** 取值种类数低于镜数的这个比例即视为塌缩。 */
  varietyRatio: 0.2,
} as const;

const text = (value: unknown): string => String(value ?? "").trim();

const descriptionKey = (shot: Record<string, unknown>): string =>
  DESCRIPTION_FIELDS.map((field) => text(shot[field])).join("");

export function measureNativeDeepReadQuality(
  input: NativeDeepReadQualityInput,
): NativeDeepReadQualityMetrics {
  const shots = input.shots.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object" && !Array.isArray(row)));
  const shotCount = shots.length;
  const spanSec = Math.max(0, input.endSec - input.startSec);

  const keys = shots.map(descriptionKey);
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
  // 每组只有首次出现算「原创」，其余都是重复。
  const duplicateRows = Array.from(counts.values()).reduce(
    (sum, n) => sum + Math.max(0, n - 1), 0);

  const lowVarietyFields: string[] = [];
  if (shotCount >= NATIVE_DEEP_READ_QUALITY_THRESHOLDS.varietyMinShots) {
    for (const field of VARIETY_FIELDS) {
      const values = new Set(shots.map((shot) => text(shot[field])).filter(Boolean));
      // 字段整段为空不算塌缩（模型可能就是没填这一栏），只判「填了但只填一种」。
      if (values.size && values.size <= Math.max(1, Math.floor(
        shotCount * NATIVE_DEEP_READ_QUALITY_THRESHOLDS.varietyRatio))) {
        lowVarietyFields.push(field);
      }
    }
  }

  const charCounts = shots.map((shot) =>
    DESCRIPTION_FIELDS.reduce((sum, field) => sum + text(shot[field]).length, 0));

  return {
    shotCount,
    spanSec: Math.round(spanSec * 10) / 10,
    secondsPerShot: shotCount ? Math.round((spanSec / shotCount) * 10) / 10 : 0,
    duplicateRows,
    duplicateRatio: shotCount ? Math.round((duplicateRows / shotCount) * 1000) / 1000 : 0,
    uniqueDescriptionSets: counts.size,
    lowVarietyFields,
    meanDescriptionChars: shotCount
      ? Math.round((charCounts.reduce((a, b) => a + b, 0) / shotCount) * 10) / 10
      : 0,
  };
}

export function judgeNativeDeepReadQuality(
  input: NativeDeepReadQualityInput,
): NativeDeepReadQualityVerdict {
  const metrics = measureNativeDeepReadQuality(input);
  const t = NATIVE_DEEP_READ_QUALITY_THRESHOLDS;
  const failures: NativeDeepReadQualityFailure[] = [];

  if (!metrics.shotCount) {
    failures.push({ code: "quality_no_shots", detailZh: "镜头表为空，没有任何可验收的内容" });
    return { metrics, failures, status: "fail" };
  }
  if (metrics.duplicateRatio > t.maxDuplicateRatio) {
    failures.push({
      code: "quality_duplicate_rows",
      detailZh: `${metrics.shotCount} 镜里 ${metrics.duplicateRows} 镜描述逐字重复`
        + `（${(metrics.duplicateRatio * 100).toFixed(1)}%，上限 ${t.maxDuplicateRatio * 100}%）`,
    });
  }
  if (metrics.uniqueDescriptionSets < t.minUniqueDescriptionSets) {
    failures.push({
      code: "quality_unique_sets_thin",
      detailZh: `整段只有 ${metrics.uniqueDescriptionSets} 种描述写法，低于 ${t.minUniqueDescriptionSets}`,
    });
  }
  if (metrics.secondsPerShot > t.maxSecondsPerShot) {
    failures.push({
      code: "quality_shot_density_thin",
      detailZh: `平均 ${metrics.secondsPerShot} 秒/镜，超过 ${t.maxSecondsPerShot} 秒`
        + `（${metrics.spanSec} 秒只给了 ${metrics.shotCount} 镜）`,
    });
  }
  if (metrics.lowVarietyFields.length) {
    failures.push({
      code: "quality_field_variety_collapsed",
      detailZh: `${metrics.lowVarietyFields.length} 个字段取值种类塌缩：`
        + `${metrics.lowVarietyFields.slice(0, 6).join("、")}`,
    });
  }

  return { metrics, failures, status: failures.length ? "fail" : "pass" };
}
