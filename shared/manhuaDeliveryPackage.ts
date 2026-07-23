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

const LOCALES: ManhuaDeliveryLocale[] = ["zh", "en", "ja", "ko", "es", "ru"];

export function normalizeManhuaDeliveryLocale(raw: unknown): ManhuaDeliveryLocale {
  const s = String(raw || "").trim() as ManhuaDeliveryLocale;
  return LOCALES.includes(s) ? s : "zh";
}

/** 合并用户编辑与默认模板（落盘/剪辑台共用） */
export function normalizeManhuaDeliveryPackage(
  raw: unknown,
  opts?: { seriesTitle?: string; episodeIndexes?: number[]; locale?: ManhuaDeliveryLocale },
): ManhuaDeliveryPackage {
  const base = defaultManhuaDeliveryPackage(opts);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<ManhuaDeliveryPackage> & {
    color?: Partial<ManhuaColorHandoffNotes>;
    subtitle?: Partial<ManhuaSubtitleDeliveryNotes>;
    dubbing?: Partial<ManhuaDubbingDeliveryNotes>;
  };
  const locale = normalizeManhuaDeliveryLocale(
    o.subtitle?.locale || o.dubbing?.dialogueLanguage || opts?.locale || base.subtitle.locale,
  );
  return {
    seriesTitle: String(o.seriesTitle || opts?.seriesTitle || base.seriesTitle).trim() || base.seriesTitle,
    episodeIndexes: Array.isArray(o.episodeIndexes)
      ? o.episodeIndexes.filter((n) => typeof n === "number" && n >= 1)
      : opts?.episodeIndexes || base.episodeIndexes,
    color: {
      lookIntentZh: String(o.color?.lookIntentZh ?? base.color.lookIntentZh).trim() || base.color.lookIntentZh,
      workingSpaceHint:
        String(o.color?.workingSpaceHint ?? base.color.workingSpaceHint).trim() ||
        base.color.workingSpaceHint,
      deliveryContainer:
        String(o.color?.deliveryContainer ?? base.color.deliveryContainer).trim() ||
        base.color.deliveryContainer,
      heroColorLocksZh:
        String(o.color?.heroColorLocksZh ?? base.color.heroColorLocksZh).trim() ||
        base.color.heroColorLocksZh,
      notesZh: o.color?.notesZh != null ? String(o.color.notesZh).trim() : base.color.notesZh,
    },
    subtitle: {
      needSubtitles: o.subtitle?.needSubtitles ?? base.subtitle.needSubtitles,
      needSdh: o.subtitle?.needSdh ?? base.subtitle.needSdh,
      needForcedNarrative: o.subtitle?.needForcedNarrative ?? base.subtitle.needForcedNarrative,
      burnInForbidden: o.subtitle?.burnInForbidden ?? base.subtitle.burnInForbidden,
      locale,
      notesZh: o.subtitle?.notesZh != null ? String(o.subtitle.notesZh).trim() : base.subtitle.notesZh,
    },
    dubbing: {
      needDubbing: o.dubbing?.needDubbing ?? base.dubbing.needDubbing,
      needMeStem: o.dubbing?.needMeStem ?? base.dubbing.needMeStem,
      dialogueLanguage: normalizeManhuaDeliveryLocale(
        o.dubbing?.dialogueLanguage || locale,
      ),
      loudnessTargetHint:
        String(o.dubbing?.loudnessTargetHint ?? base.dubbing.loudnessTargetHint).trim() ||
        base.dubbing.loudnessTargetHint,
      notesZh: o.dubbing?.notesZh != null ? String(o.dubbing.notesZh).trim() : base.dubbing.notesZh,
    },
    qcChecklistZh: Array.isArray(o.qcChecklistZh) && o.qcChecklistZh.length
      ? o.qcChecklistZh.map((x) => String(x || "").trim()).filter(Boolean)
      : base.qcChecklistZh,
    updatedAtIso: String(o.updatedAtIso || "").trim() || new Date().toISOString(),
  };
}

/** 字幕开关与交付包双向同步 */
export function syncDeliveryPackageSubtitleEnabled(
  pkg: ManhuaDeliveryPackage,
  subtitleEnabled: boolean,
): ManhuaDeliveryPackage {
  return normalizeManhuaDeliveryPackage({
    ...pkg,
    subtitle: { ...pkg.subtitle, needSubtitles: Boolean(subtitleEnabled) },
    updatedAtIso: new Date().toISOString(),
  });
}

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
      notesZh:
        "对白以可拍表「」为准；成片有声用引擎同轮 Audio，暂不另做后期配音；群杂如需再后补。",
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
    Boolean(pkg.color.heroColorLocksZh.trim()),
    pkg.subtitle.burnInForbidden,
    pkg.subtitle.needSubtitles ? Boolean(pkg.subtitle.locale) : true,
    pkg.dubbing.needDubbing ? Boolean(pkg.dubbing.loudnessTargetHint.trim()) : true,
    pkg.qcChecklistZh.length >= 4,
  ];
  const done = flags.filter(Boolean).length;
  return {
    total: flags.length,
    done,
    labelZh: `交付包 ${done}/${flags.length} 项已就绪`,
  };
}
