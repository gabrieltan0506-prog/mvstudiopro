/** 整形分析的消费校验；原始响应须由调用方先持久化，不改写、裁剪输入。 */
const dimensions = {
  emotionTagsZh: "emotionZh",
  narrativeFeatureTagsZh: "narrativeZh",
  performanceTagsZh: "performanceZh",
  audiovisualTagsZh: "audiovisualZh",
  audienceExperienceTagsZh: "audienceZh",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export class NativeStructuringAnalysisError extends Error {
  constructor(detail: string) {
    super(`学习分析不完整：${detail}；已保存的原始证据保留`);
    this.name = "NativeStructuringAnalysisError";
    Object.setPrototypeOf(this, NativeStructuringAnalysisError.prototype);
  }
}

export function assertNativeStructuringAnalysis(value: unknown, options: { requireGeneratedAnalysis?: boolean } = {}): void {
  const reject = (detail: string): never => {
    throw new NativeStructuringAnalysisError(detail);
  };
  if (!isRecord(value)) reject("整形结果必须为对象");
  const card = value as Record<string, unknown>;
  const hasTitle = Object.prototype.hasOwnProperty.call(card, "templateTitleZh");
  if (options.requireGeneratedAnalysis && !hasTitle) reject("新整形结果必须包含 templateTitleZh");
  if (hasTitle) {
    const title = card.templateTitleZh;
    if (typeof title !== "string" || !title.trim() || Array.from(title.trim()).length > 60) {
      reject("templateTitleZh 必须为 1–60 字的标题，不得混入长篇正文");
    }
  }
  const hasProse = Object.prototype.hasOwnProperty.call(card, "classificationProseZh");
  if (options.requireGeneratedAnalysis && !hasProse) reject("新整形结果必须包含 classificationProseZh");
  const prose = isRecord(card.classificationProseZh) ? card.classificationProseZh : {};
  if (hasProse && (!isRecord(card.classificationProseZh)
    || Object.values(dimensions).some((key) => typeof prose[key] !== "string"))) {
    reject("classificationProseZh 必须包含五个字符串维度");
  }
  // 无标题的旧分段卡、确定性拼接结果仍可消费；新分析有证据的维度不得空缺。
  if (hasTitle) {
    const classification = isRecord(card.classification) ? card.classification : {};
    for (const [tagKey, proseKey] of Object.entries(dimensions)) {
      const tags = classification[tagKey];
      const hasEvidence = Array.isArray(tags)
        && tags.some((tag) => typeof tag === "string" && Boolean(tag.trim()));
      if (hasEvidence && (typeof prose[proseKey] !== "string" || !prose[proseKey].trim())) {
        reject(`${proseKey} 已有分类证据，必须包含非空分析`);
      }
    }
  }
}
