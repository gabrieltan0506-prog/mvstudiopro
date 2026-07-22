/**
 * 漫剧风格包（产品化）：可复用视觉 DNA + 10 色（3 主 + 5 辅 + 2 点缀）。
 * 只借色彩/光影/构图/材质节奏，不复制原片场景与可识别元素。
 * 前台零技术泄漏；色卡 PNG 验收脚本可离线用 Agent skill，本模块管结构化注入。
 */

export const MANHUA_STYLE_PACK_PRIMARY_COUNT = 3;
export const MANHUA_STYLE_PACK_SECONDARY_COUNT = 5;
export const MANHUA_STYLE_PACK_ACCENT_COUNT = 2;

export type ManhuaStylePack = {
  nameZh: string;
  /** 一句强视觉锁：色彩+光源+构图+情绪 */
  artLockZh: string;
  primaryColors: string[];
  secondaryColors: string[];
  accentColors: string[];
  lightingZh: string;
  textureZh: string;
  compositionZh: string;
  cameraRhythmZh: string;
  /** 内部备注（可空；勿写供应商/模型名） */
  sourceNoteZh?: string;
};

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export function normalizeManhuaStyleHex(raw: string): string | null {
  const t = String(raw || "").trim();
  if (!HEX_RE.test(t)) return null;
  const hex = t.startsWith("#") ? t.slice(1) : t;
  return `#${hex.toUpperCase()}`;
}

function normalizeColorList(list: unknown, count: number): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const hex = normalizeManhuaStyleHex(String(item || ""));
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length >= count) break;
  }
  return out;
}

export function parseManhuaStylePack(raw: unknown): ManhuaStylePack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nameZh = String(o.nameZh || "").trim().slice(0, 40);
  const artLockZh = String(o.artLockZh || "").trim().slice(0, 200);
  if (!nameZh || artLockZh.length < 8) return null;
  const primaryColors = normalizeColorList(o.primaryColors, MANHUA_STYLE_PACK_PRIMARY_COUNT);
  const secondaryColors = normalizeColorList(o.secondaryColors, MANHUA_STYLE_PACK_SECONDARY_COUNT);
  const accentColors = normalizeColorList(o.accentColors, MANHUA_STYLE_PACK_ACCENT_COUNT);
  if (primaryColors.length < MANHUA_STYLE_PACK_PRIMARY_COUNT) return null;
  if (secondaryColors.length < MANHUA_STYLE_PACK_SECONDARY_COUNT) return null;
  if (accentColors.length < MANHUA_STYLE_PACK_ACCENT_COUNT) return null;
  const lightingZh = String(o.lightingZh || "").trim().slice(0, 160);
  const textureZh = String(o.textureZh || "").trim().slice(0, 120);
  const compositionZh = String(o.compositionZh || "").trim().slice(0, 120);
  const cameraRhythmZh = String(o.cameraRhythmZh || "").trim().slice(0, 120);
  if (!lightingZh || !textureZh || !compositionZh || !cameraRhythmZh) return null;
  const sourceNoteZh = String(o.sourceNoteZh || "").trim().slice(0, 120) || undefined;
  return {
    nameZh,
    artLockZh,
    primaryColors,
    secondaryColors,
    accentColors,
    lightingZh,
    textureZh,
    compositionZh,
    cameraRhythmZh,
    sourceNoteZh,
  };
}

export type ManhuaStylePackQuality = {
  ok: boolean;
  issues: string[];
};

export function evaluateManhuaStylePackQuality(
  pack: ManhuaStylePack | null | undefined,
): ManhuaStylePackQuality {
  const issues: string[] = [];
  if (!pack) return { ok: false, issues: ["尚未填写风格包"] };
  if (pack.artLockZh.length < 12) issues.push("强视觉锁过短，须写清色彩+光源+构图+情绪");
  if (pack.primaryColors.length < MANHUA_STYLE_PACK_PRIMARY_COUNT) {
    issues.push(`主色须 ${MANHUA_STYLE_PACK_PRIMARY_COUNT} 个 HEX`);
  }
  if (pack.secondaryColors.length < MANHUA_STYLE_PACK_SECONDARY_COUNT) {
    issues.push(`辅助色须 ${MANHUA_STYLE_PACK_SECONDARY_COUNT} 个 HEX`);
  }
  if (pack.accentColors.length < MANHUA_STYLE_PACK_ACCENT_COUNT) {
    issues.push(`点缀色须 ${MANHUA_STYLE_PACK_ACCENT_COUNT} 个 HEX`);
  }
  if (!pack.lightingZh.trim()) issues.push("缺光影描述");
  if (!pack.textureZh.trim()) issues.push("缺材质描述");
  if (!pack.compositionZh.trim()) issues.push("缺构图描述");
  if (!pack.cameraRhythmZh.trim()) issues.push("缺镜头节奏描述");
  return { ok: issues.length === 0, issues };
}

/** 注入静帧 / 成片 / 视觉简报（只写可拍视觉语法） */
export function formatManhuaStylePackInjectBlock(pack: ManhuaStylePack | null | undefined): string {
  if (!pack) return "";
  const q = evaluateManhuaStylePackQuality(pack);
  if (!q.ok) return "";
  return [
    `【风格包·${pack.nameZh}】`,
    `强视觉锁：${pack.artLockZh}`,
    `主色：${pack.primaryColors.join(" · ")}`,
    `辅助色：${pack.secondaryColors.join(" · ")}`,
    `点缀色：${pack.accentColors.join(" · ")}`,
    `光影：${pack.lightingZh}`,
    `材质：${pack.textureZh}`,
    `构图：${pack.compositionZh}`,
    `镜头节奏：${pack.cameraRhythmZh}`,
    "禁止复用参考片可识别场景/角色造型/商标；只延续本风格包视觉语法。",
  ].join("\n");
}

/**
 * 从画风标签 + 场景关键词生成可编辑草稿（非终验；须用户补全 HEX 与锁句）。
 * 色值给占位，parse 不会通过，直到用户填满。
 */
export function buildManhuaStylePackDraft(opts: {
  nameZh?: string;
  artStyleLabelZh?: string;
  sceneKeywordsZh?: string[];
  lightingHintZh?: string;
}): Partial<ManhuaStylePack> {
  const art = String(opts.artStyleLabelZh || "统一画风").trim();
  const keys = (opts.sceneKeywordsZh || []).filter(Boolean).slice(0, 4);
  const light = String(opts.lightingHintZh || "主光方向清晰，明暗比服务情绪").trim();
  return {
    nameZh: String(opts.nameZh || `${art}风格包`).trim().slice(0, 40),
    artLockZh: `${art}；${keys.length ? keys.join("、") + "；" : ""}${light}；竖屏主体清晰。`.slice(0, 200),
    primaryColors: [],
    secondaryColors: [],
    accentColors: [],
    lightingZh: light.slice(0, 160),
    textureZh: keys[0] ? `${keys[0]}材质可读` : "材质层次清晰",
    compositionZh: "竖屏中景偏近，前景可遮挡，纵深分层",
    cameraRhythmZh: "段内主运镜一事，景别递进",
    sourceNoteZh: "草稿：请补齐 3+5+2 HEX 色并收紧强视觉锁",
  };
}
