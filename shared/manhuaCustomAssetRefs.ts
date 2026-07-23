/**
 * 用户上传参考图：勾选人物 / 场景 / 服装道具后，直接进关键静帧融图。
 * 仅接受 HTTPS；unset 不进融图与门禁。
 */

import { getAncientArchetypeById } from "./manhuaAncientArchetypeLibrary.js";
import { getManhuaCharacterById } from "./manhuaCharacterAssetLibrary.js";
import { getManhuaSceneTemplate, MANHUA_SCENE_ASSET_LIBRARY } from "./manhuaSceneAssetLibrary.js";
import {
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
} from "./manhuaScriptWorkbench.js";

export const MANHUA_CUSTOM_ASSET_ROLES = ["character", "scene", "prop"] as const;
export type ManhuaCustomAssetRole = (typeof MANHUA_CUSTOM_ASSET_ROLES)[number];
export type ManhuaCustomAssetRoleOrUnset = ManhuaCustomAssetRole | "unset";

export type ManhuaCustomAssetSource = "upload" | "generated";

/** 成片垫图职责（与人物/场景/道具分栏正交） */
export type ManhuaCustomAssetRefDuty =
  | "identity"
  | "space"
  | "motion"
  | "first_frame"
  | "last_frame"
  | "style";

export const MANHUA_CUSTOM_ASSET_REF_DUTY_LABEL_ZH: Record<ManhuaCustomAssetRefDuty, string> = {
  identity: "身份锁",
  space: "空间锁",
  motion: "运动参考",
  first_frame: "首帧",
  last_frame: "尾帧",
  style: "画风参考",
};

export type ManhuaCustomAssetRef = {
  id: string;
  /** HTTPS 可读地址（GCS 等） */
  url: string;
  role: ManhuaCustomAssetRoleOrUnset;
  labelZh?: string;
  /** upload=用户上传；generated=基于库参考新生成（库仅为参考，不硬锁） */
  source?: ManhuaCustomAssetSource;
  /** 生成时参考的库资产 id（可选） */
  seedLibraryId?: string;
  /** 视频生成时的参考职责 */
  refDuty?: ManhuaCustomAssetRefDuty | null;
};

export const MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH: Record<ManhuaCustomAssetRoleOrUnset, string> = {
  character: "人物",
  scene: "场景",
  prop: "服装道具",
  unset: "未勾选",
};

/** 从资产列表编译【参考职责】注入块（无职责则空串） */
export function formatCustomAssetRefsDutyBlock(
  refs: Array<Pick<ManhuaCustomAssetRef, "refDuty" | "labelZh" | "role"> | null | undefined>,
): string {
  const duties = (refs || [])
    .filter(Boolean)
    .map((r) => {
      const duty = r!.refDuty;
      if (!duty) return null;
      return {
        duty,
        labelZh: String(r!.labelZh || MANHUA_CUSTOM_ASSET_ROLE_LABEL_ZH[r!.role] || "").trim(),
      };
    })
    .filter(Boolean) as Array<{ duty: ManhuaCustomAssetRefDuty; labelZh: string }>;
  if (!duties.length) return "";
  const lines = duties.map((d) => {
    const dutyLabel = MANHUA_CUSTOM_ASSET_REF_DUTY_LABEL_ZH[d.duty] || d.duty;
    return `- ${dutyLabel}${d.labelZh ? `：${d.labelZh}` : ""}`;
  });
  return [
    "【参考职责】",
    "各参考只服务标注职责；身份锁不改脸，空间锁不改陈设布局，首尾帧管起止构图。",
    ...lines,
  ].join("\n");
}

function isHttpsUrl(u: string): boolean {
  return /^https:\/\//i.test(u);
}

export function makeManhuaCustomAssetId(): string {
  return `cust_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeManhuaCustomAssetRole(
  raw: unknown,
): ManhuaCustomAssetRoleOrUnset {
  const s = String(raw || "").trim();
  if (s === "character" || s === "scene" || s === "prop") return s;
  return "unset";
}

/** 去掉「新人物·」「新场景·」前缀，便于对齐库内场景名 */
export function stripManhuaCustomAssetLabelPrefix(labelZh: string | undefined | null): string {
  return String(labelZh || "")
    .trim()
    .replace(/^新(?:人物|场景|服装道具)·/, "");
}

/**
 * 按库 seed / 标签把误标资产拉回正确分栏。
 * 例：皇宫大殿（scene_06）不得停在「我的角色」。
 */
export function inferManhuaCustomAssetRole(opts: {
  role?: unknown;
  seedLibraryId?: string | null;
  labelZh?: string | null;
}): ManhuaCustomAssetRoleOrUnset {
  const seed = String(opts.seedLibraryId || "").trim();
  const label = String(opts.labelZh || "").trim();
  const bare = stripManhuaCustomAssetLabelPrefix(label);
  const declared = normalizeManhuaCustomAssetRole(opts.role);

  if (
    seed.startsWith("scene_") ||
    seed.startsWith("wa_loc") ||
    seed.startsWith("wa_scene") ||
    Boolean(getManhuaSceneTemplate(seed))
  ) {
    return "scene";
  }
  if (
    seed.startsWith("demo_prop_") ||
    seed.startsWith("wa_prop") ||
    seed.startsWith("prop_")
  ) {
    return "prop";
  }
  if (
    seed.startsWith("char_") ||
    seed.startsWith("arch_") ||
    seed.startsWith("wa_char")
  ) {
    return "character";
  }

  if (bare) {
    const byName = MANHUA_SCENE_ASSET_LIBRARY.find(
      (s) => s.nameZh === bare || s.nameZh === label,
    );
    if (byName) return "scene";
    // 强场景词：编剧把地点写进人物表时的兜底
    if (
      /大殿|街市|府邸|战场|洞府|宗门|宫殿|空镜|边关|豪宅|办公室|会议室|朝堂|金銮|山门|云海|废墟|回廊|闺阁/.test(
        bare,
      )
    ) {
      return "scene";
    }
  }

  return declared;
}

/**
 * 库条目展示名：禁止把 arch_/char_/scene_ 英文 id 直接露给用户。
 * 库内只有中文人名/场景名，没有「标题」。
 */
export function resolveManhuaCustomAssetDisplayLabelZh(opts: {
  labelZh?: string | null;
  seedLibraryId?: string | null;
}): string | undefined {
  const seed = String(opts.seedLibraryId || "").trim();
  const label = String(opts.labelZh || "").trim();
  const bare = stripManhuaCustomAssetLabelPrefix(label);
  const looksLikeId = (s: string) =>
    /^(arch_|char_|scene_|wa_|demo_)/i.test(s) || /^[a-z][a-z0-9_]{6,}$/i.test(s);

  const fromSeed = (id: string): string | undefined => {
    const arch = getAncientArchetypeById(id);
    if (arch) return arch.nameZh;
    const char = getManhuaCharacterById(id);
    if (char) return char.nameZh;
    const scene = getManhuaSceneTemplate(id);
    if (scene) return scene.nameZh;
    return undefined;
  };

  if (seed) {
    const named = fromSeed(seed);
    if (named && (!label || looksLikeId(bare) || bare === seed)) return named;
  }
  if (bare && looksLikeId(bare)) {
    const named = fromSeed(bare);
    if (named) return named;
  }
  return label ? label.slice(0, 40) : undefined;
}

/** 清洗并截断用户上传参考列表（只留 HTTPS）；并按 seed/标签纠偏角色分栏 */
export function normalizeManhuaCustomAssetRefs(
  raw: unknown,
  opts?: { max?: number },
): ManhuaCustomAssetRef[] {
  const max = Math.max(1, Math.min(24, opts?.max ?? 16));
  if (!Array.isArray(raw)) return [];
  const out: ManhuaCustomAssetRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Partial<ManhuaCustomAssetRef>;
    const url = String(o.url || "").trim();
    if (!isHttpsUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const id = String(o.id || "").trim() || makeManhuaCustomAssetId();
    const seedLibraryId = String(o.seedLibraryId || "").trim() || undefined;
    const labelZh = resolveManhuaCustomAssetDisplayLabelZh({
      labelZh: o.labelZh,
      seedLibraryId,
    });
    const source =
      o.source === "generated" || o.source === "upload" ? o.source : undefined;
    const refDutyRaw = String(o.refDuty || "").trim();
    const refDuty = (
      [
        "identity",
        "space",
        "motion",
        "first_frame",
        "last_frame",
        "style",
      ] as const
    ).includes(refDutyRaw as ManhuaCustomAssetRefDuty)
      ? (refDutyRaw as ManhuaCustomAssetRefDuty)
      : undefined;
    out.push({
      id,
      url,
      role: inferManhuaCustomAssetRole({
        role: o.role,
        seedLibraryId,
        labelZh,
      }),
      labelZh,
      source,
      seedLibraryId,
      refDuty: refDuty || null,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 基于库参考生成「新」资产图的提示（库只作气质/环境参考，禁止复刻同一张） */
export function buildManhuaCustomAssetGenFromLibraryPrompt(opts: {
  role: ManhuaCustomAssetRole;
  seedLabelZh?: string;
  seedPromptZh?: string;
  topic?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
}): string {
  const roleZh =
    opts.role === "character" ? "人物" : opts.role === "scene" ? "场景" : "服装道具";
  const seedLabel = String(opts.seedLabelZh || "").trim();
  const seedPrompt = String(opts.seedPromptZh || "").trim();
  const topic = String(opts.topic || "").trim();
  const styleLabel = String(opts.artStyleLabelZh || "").trim();
  const stylePrompt = String(opts.artStylePromptZh || "").trim();
  return [
    `生成一张竖版漫剧·新${roleZh}参考图：`,
    "库条目仅作气质/环境/材质参考，请生成**新**形象或新空镜，避免复刻同一张脸或同一张示范封面。",
    opts.role === "character"
      ? "按人物本体来画，服化道清楚；对白、姓名与海报句作隐藏意图，绝不能烧进画面。"
      : opts.role === "scene"
        ? "按场景本体来画，空镜层次清楚；大纲与场景名作隐藏说明，禁止标题大字/书法/路牌可读字。"
        : "道具主体居中、材质清楚，背景干净，禁止可读文字。",
    seedLabel ? `（隐藏库参考名·不必画出：${seedLabel}）` : "",
    seedPrompt ? `请画出的视觉参考：${seedPrompt.slice(0, 500)}` : "",
    topic ? `（隐藏题材氛围·不必写成标题：${topic.slice(0, 120)}）` : "",
    styleLabel ? `【画风】${styleLabel}` : "",
    stylePrompt || "",
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 已勾选角色的参考（进融图 / 门禁） */
export function taggedManhuaCustomAssetRefs(
  refs: ManhuaCustomAssetRef[] | null | undefined,
): Array<ManhuaCustomAssetRef & { role: ManhuaCustomAssetRole }> {
  return normalizeManhuaCustomAssetRefs(refs).filter(
    (r): r is ManhuaCustomAssetRef & { role: ManhuaCustomAssetRole } =>
      r.role === "character" || r.role === "scene" || r.role === "prop",
  );
}

export function customRefsByRole(
  refs: ManhuaCustomAssetRef[] | null | undefined,
  role: ManhuaCustomAssetRole,
): Array<ManhuaCustomAssetRef & { role: ManhuaCustomAssetRole }> {
  return taggedManhuaCustomAssetRefs(refs).filter((r) => r.role === role);
}

export function hasCustomCastAndScene(
  refs: ManhuaCustomAssetRef[] | null | undefined,
): boolean {
  const tagged = taggedManhuaCustomAssetRefs(refs);
  return (
    tagged.some((r) => r.role === "character") && tagged.some((r) => r.role === "scene")
  );
}

export function summarizeCustomAssetRefsZh(
  refs: ManhuaCustomAssetRef[] | null | undefined,
): string {
  const tagged = taggedManhuaCustomAssetRefs(refs);
  if (!tagged.length) return "";
  const nChar = tagged.filter((r) => r.role === "character").length;
  const nScene = tagged.filter((r) => r.role === "scene").length;
  const nProp = tagged.filter((r) => r.role === "prop").length;
  const parts: string[] = [];
  if (nChar) parts.push(`人物 ${nChar}`);
  if (nScene) parts.push(`场景 ${nScene}`);
  if (nProp) parts.push(`服装道具 ${nProp}`);
  return parts.join(" · ");
}

/**
 * 剧本自动出的角色/场景图写入「我的参考」（customAssetRefs）。
 * 同 seedLibraryId 或同 URL 则覆盖更新，避免重复占槽；角色按 seed/标签纠偏。
 */
export function upsertGeneratedManhuaCustomAssetRef(
  prev: ManhuaCustomAssetRef[] | null | undefined,
  input: {
    url: string;
    role: ManhuaCustomAssetRole;
    labelZh?: string;
    seedLibraryId?: string;
    refDuty?: ManhuaCustomAssetRefDuty | null;
  },
): ManhuaCustomAssetRef[] {
  const url = String(input.url || "").trim();
  if (!isHttpsUrl(url)) return normalizeManhuaCustomAssetRefs(prev);
  const labelZh = String(input.labelZh || "").trim().slice(0, 40) || undefined;
  const seedLibraryId = String(input.seedLibraryId || "").trim() || undefined;
  const role = inferManhuaCustomAssetRole({
    role: input.role,
    seedLibraryId,
    labelZh,
  });
  if (role === "unset") {
    return normalizeManhuaCustomAssetRefs(prev);
  }
  const base = normalizeManhuaCustomAssetRefs(prev);
  const matchIdx = base.findIndex((r) => {
    if (r.url === url) return true;
    if (seedLibraryId && r.source === "generated" && r.seedLibraryId === seedLibraryId) {
      return true;
    }
    return false;
  });
  const next: ManhuaCustomAssetRef = {
    id: matchIdx >= 0 ? base[matchIdx]!.id : makeManhuaCustomAssetId(),
    url,
    role,
    labelZh: labelZh || (matchIdx >= 0 ? base[matchIdx]!.labelZh : undefined),
    source: "generated",
    seedLibraryId:
      seedLibraryId || (matchIdx >= 0 ? base[matchIdx]!.seedLibraryId : undefined),
    refDuty:
      input.refDuty !== undefined
        ? input.refDuty
        : matchIdx >= 0
          ? base[matchIdx]!.refDuty
          : role === "character"
            ? "identity"
            : role === "scene"
              ? "space"
              : null,
  };
  if (matchIdx >= 0) {
    const copy = [...base];
    copy[matchIdx] = next;
    return normalizeManhuaCustomAssetRefs(copy);
  }
  return normalizeManhuaCustomAssetRefs([...base, next]);
}
