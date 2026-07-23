/**
 * 漫剧交付包：成色交接 / 字幕 / 配音检查项与可导出摘要。
 * 成色字段对齐行业 ACES 交接习惯，前台对创作者用「成色交接」中性说法。
 */

export type ManhuaDeliveryLocale = "zh" | "en" | "ja" | "ko" | "es" | "ru";

export const MANHUA_DELIVERY_LOCALE_LABEL_ZH: Record<ManhuaDeliveryLocale, string> = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  ru: "Русский",
};

export type ManhuaColorHandoffNotes = {
  /** 成色意图一句（如冷月光+暖灯笼） */
  lookIntentZh: string;
  /** 工作色彩空间提示（内部可写 ACEScg / Rec.709 等） */
  workingSpaceHint: string;
  /** 交付容器：SDR / HDR 等 */
  deliveryContainer: string;
  /** 产品/服装必须保真的色 */
  heroColorLocksZh: string;
  notesZh?: string;
};

export type ManhuaSubtitleDeliveryNotes = {
  needSubtitles: boolean;
  needSdh: boolean;
  needForcedNarrative: boolean;
  burnInForbidden: boolean;
  locale: ManhuaDeliveryLocale;
  notesZh?: string;
};

export type ManhuaDubbingDeliveryNotes = {
  needDubbing: boolean;
  needMeStem: boolean;
  dialogueLanguage: ManhuaDeliveryLocale;
  loudnessTargetHint: string;
  notesZh?: string;
};

export type ManhuaDeliveryPackage = {
  seriesTitle: string;
  episodeIndexes: number[];
  color: ManhuaColorHandoffNotes;
  subtitle: ManhuaSubtitleDeliveryNotes;
  dubbing: ManhuaDubbingDeliveryNotes;
  qcChecklistZh: string[];
  updatedAtIso: string;
};

export function defaultManhuaDeliveryPackage(opts?: {
  seriesTitle?: string;
  episodeIndexes?: number[];
  locale?: ManhuaDeliveryLocale;
}): ManhuaDeliveryPackage {
  const locale = opts?.locale || "zh";
  return {
    seriesTitle: String(opts?.seriesTitle || "").trim() || "未命名系列",
    episodeIndexes: (opts?.episodeIndexes || []).filter((n) => n >= 1),
    color: {
      lookIntentZh: "系列主色与关键光比保持一致；脸部层次可读。",
      workingSpaceHint: "ACEScg working → Rec.709 / sRGB delivery（成色交接）",
      deliveryContainer: "SDR Rec.709",
      heroColorLocksZh: "主角服化主色、道具识别色不得漂移。",
    },
    subtitle: {
      needSubtitles: true,
      needSdh: false,
      needForcedNarrative: false,
      burnInForbidden: true,
      locale,
      notesZh: "成片不烧字幕；字幕轴后挂。",
    },
    dubbing: {
      needDubbing: false,
      needMeStem: true,
      dialogueLanguage: locale,
      loudnessTargetHint: "对话清晰优先；音乐床不盖过人声。",
      notesZh: "对白以可拍表「」为准；群杂可后配。",
    },
    qcChecklistZh: [
      "画幅与安全区：竖屏主体不贴边裁切",
      "成色：系列光比与主色连续",
      "音频：对白可懂、无异常爆音",
      "字幕：未烧进画面；轴与口型大致可对",
      "权利：无未授权商标/真人肖像",
      "命名：集号-段号-版本可追溯",
    ],
    updatedAtIso: new Date().toISOString(),
  };
}

/** 导出给剪辑/成色/字幕的中性交接摘要（可进工程包） */
export function formatManhuaDeliveryPackageMarkdown(pkg: ManhuaDeliveryPackage): string {
  const eps =
    pkg.episodeIndexes.length > 0
      ? pkg.episodeIndexes.map((n) => `第${n}集`).join("、")
      : "（未勾选集）";
  const sub = pkg.subtitle;
  const dub = pkg.dubbing;
  const color = pkg.color;
  return [
    `# 交付包 · ${pkg.seriesTitle}`,
    "",
    `覆盖：${eps}`,
    `更新：${pkg.updatedAtIso}`,
    "",
    "## 成色交接",
    `- 意图：${color.lookIntentZh}`,
    `- 工作/交付色域：${color.workingSpaceHint}`,
    `- 交付容器：${color.deliveryContainer}`,
    `- 保真色：${color.heroColorLocksZh}`,
    color.notesZh ? `- 备注：${color.notesZh}` : "",
    "",
    "## 字幕",
    `- 需要字幕：${sub.needSubtitles ? "是" : "否"}（${MANHUA_DELIVERY_LOCALE_LABEL_ZH[sub.locale]}）`,
    `- SDH/听障轴：${sub.needSdh ? "是" : "否"}`,
    `- 强制叙事字幕：${sub.needForcedNarrative ? "是" : "否"}`,
    `- 禁止烧进成片：${sub.burnInForbidden ? "是" : "否"}`,
    sub.notesZh ? `- 备注：${sub.notesZh}` : "",
    "",
    "## 配音",
    `- 需要配音：${dub.needDubbing ? "是" : "否"}（${MANHUA_DELIVERY_LOCALE_LABEL_ZH[dub.dialogueLanguage]}）`,
    `- 需要 M&E 分轨：${dub.needMeStem ? "是" : "否"}`,
    `- 响度/人声：${dub.loudnessTargetHint}`,
    dub.notesZh ? `- 备注：${dub.notesZh}` : "",
    "",
    "## 质检清单",
    ...pkg.qcChecklistZh.map((x) => `- [ ] ${x}`),
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export type ManhuaDeliveryPackageProgress = {
  total: number;
  done: number;
  labelZh: string;
};

export function summarizeManhuaDeliveryPackageProgress(
  pkg: ManhuaDeliveryPackage,
): ManhuaDeliveryPackageProgress {
  const flags = [
    Boolean(pkg.color.lookIntentZh.trim()),
    Boolean(pkg.color.workingSpaceHint.trim()),
    pkg.subtitle.burnInForbidden,
    pkg.qcChecklistZh.length >= 4,
  ];
  const done = flags.filter(Boolean).length;
  return {
    total: flags.length,
    done,
    labelZh: `交付包 ${done}/${flags.length} 项已就绪`,
  };
}
