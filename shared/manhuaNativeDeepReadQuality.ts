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
 * 参与「取值种类是否塌缩」的字段。
 *
 * ⚠️ 只放**描述性**字段，**绝不放枚举字段**。0831 首跑实测教训：
 * 初版把 shotSizeZh（景别）、angleZh（机位角度）、cameraMoveZh（运镜）、
 * unitTypeZh（单元类型）、transitionInZh（入镜转场）也放了进来，
 * 结果一份 66 镜的优质产出被判 5 个字段塌缩——纯属误报：
 * 景别就特写/中景/全景那几种，66 镜里只出现十几种取值本来就是正常的。
 * 枚举字段天然低基数，拿多样性衡量它等于惩罚模型正确使用枚举。
 */
const VARIETY_FIELDS = DESCRIPTION_FIELDS.filter(
  // transitionInZh（入镜转场）虽在描述字段里参与整行雷同判断，但取值本身是枚举性质
  // （「直接切入」「承接上一镜」那几种），同样不该用多样性衡量。0831 实测误报过一次。
  (field) => field !== "transitionInZh",
);

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
  /** 后半段镜数 ÷ 前半段镜数。明显小于 1 说明模型写到后面开始敷衍。 */
  tailDensityRatio: number;
  /** 重复镜头中落在后半段的比例。接近 1 说明重复不是散布全段，而是尾段模板化。 */
  duplicateTailShare: number;
  /**
   * 最长「连续等长镜头」串的长度。真实剪辑的镜头长度不会规律相等，
   * 一长串完全等长的镜头是模型按固定步长切出来的，不是看出来的。
   */
  longestEqualLengthRun: number;
  /** 上述等长串的镜头时长（秒）；0 表示没有等长串。 */
  equalLengthRunSec: number;
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
  /**
   * 后半段镜数低于前半段这个比例即判尾段敷衍。
   * 0831 首跑实测 0.38（48 镜 → 18 镜），那一段确认是模板循环。
   * 定 0.5 而不是更松：真实剧集后段就算安静，镜头也不该只剩前段的三分之一。
   */
  minTailDensityRatio: 0.5,
  /** 重复镜有这么高比例挤在后半段，就不是偶发重复而是尾段整片糊弄。 */
  tailConcentrationTrigger: 0.6,
  /**
   * 连续等长镜超过这个条数即判按固定步长编造。
   * 0831 漏网案例是 25 条连续 10 秒；真实剪辑偶有 3–5 条同长属正常，定 8 条。
   */
  maxEqualLengthRun: 8,
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

  /**
   * 尾段模板化检测。0831 首跑实测的真实失效形态，记下来免得下次又漏：
   * 一份 319 秒的产出，前 160 秒给了 48 镜（真实剪辑点，秒位不规则），
   * 后 159 秒只给 18 镜，其中 12 镜是三条描述**严格 10 秒等分循环四遍**
   * （200-210 / 230-240 / 260-270 / 290-300 全写「少主在魔界发号施令」）。
   * 同时段字幕有 44 条且内容是热闹的对话戏——模型听到了、也逐字转写了，
   * 只是不肯再为后段写镜头，改用模板顶上，写的内容跟字幕完全对不上。
   *
   * 所以整体雷同率不够用：它分不出「散布全段的偶发重复」和「尾段整片糊弄」。
   */
  const midSec = input.startSec + spanSec / 2;
  const inTail = (shot: Record<string, unknown>) => Number(shot.startSec) >= midSec;
  const headCount = shots.filter((shot) => !inTail(shot)).length;
  const tailCount = shotCount - headCount;
  const duplicateKeys = new Set(
    Array.from(counts.entries()).filter(([, n]) => n > 1).map(([key]) => key));
  const duplicateTailRows = shots.filter(
    (shot, i) => inTail(shot) && duplicateKeys.has(keys[i]!)).length;

  /**
   * 等长镜串检测。0831 实测漏网案例：一份产出有 **25 条连续 10 秒等长镜**，
   * 但每条描述都不同，所以雷同率是 0、尾段密度比 0.84，验收器判了 pass。
   * 光看文字重复抓不住它——模型换了手法，用固定步长切时间轴，
   * 描述则各写各的。真实剪辑的镜头长度不会规律相等，一长串等长就是编的。
   */
  const durations = shots
    .slice()
    .sort((a, b) => Number(a.startSec) - Number(b.startSec))
    .map((shot) => Math.round((Number(shot.endSec) - Number(shot.startSec)) * 10) / 10);
  let longestEqualLengthRun = durations.length ? 1 : 0;
  let equalLengthRunSec = durations.length ? durations[0]! : 0;
  let currentRun = 1;
  for (let i = 1; i < durations.length; i += 1) {
    if (durations[i] === durations[i - 1] && durations[i]! > 0) {
      currentRun += 1;
      if (currentRun > longestEqualLengthRun) {
        longestEqualLengthRun = currentRun;
        equalLengthRunSec = durations[i]!;
      }
    } else {
      currentRun = 1;
    }
  }

  return {
    longestEqualLengthRun,
    equalLengthRunSec,
    tailDensityRatio: headCount
      ? Math.round((tailCount / headCount) * 100) / 100
      : (tailCount ? 1 : 0),
    duplicateTailShare: duplicateRows
      ? Math.round((duplicateTailRows / (duplicateRows + duplicateKeys.size)) * 100) / 100
      : 0,
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
  if (metrics.shotCount >= t.varietyMinShots && metrics.tailDensityRatio < t.minTailDensityRatio) {
    failures.push({
      code: "quality_tail_density_collapsed",
      detailZh: `后半段镜数只有前半段的 ${Math.round(metrics.tailDensityRatio * 100)}%`
        + `（低于 ${t.minTailDensityRatio * 100}%），模型可能写到后段就改用模板顶替`
        + (metrics.duplicateTailShare >= t.tailConcentrationTrigger
          ? `；且 ${Math.round(metrics.duplicateTailShare * 100)}% 的重复镜挤在后半段` : ""),
    });
  }
  if (metrics.longestEqualLengthRun > t.maxEqualLengthRun) {
    failures.push({
      code: "quality_equal_length_run",
      detailZh: `有 ${metrics.longestEqualLengthRun} 条连续镜头时长完全相同`
        + `（各 ${metrics.equalLengthRunSec} 秒，上限 ${t.maxEqualLengthRun} 条）；`
        + `真实剪辑的镜头长度不会规律相等，这是按固定步长切出来的时间轴`,
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
