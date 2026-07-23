/**
 * 关键静帧源头短包：每张只带短锁 + 本镜分镜 + 短融图指令。
 * 完整角色/场景/剧种长文留在 bible/beats，不进每张 keyart（避免克隆肥 base → 全军超限）。
 */

import { getAncientArchetypeById } from "./manhuaAncientArchetypeLibrary";
import {
  getManhuaArtStylePreset,
  getManhuaCharacterById,
  getManhuaCharacterDisplayName,
  normalizeManhuaArtStyleId,
} from "./manhuaCharacterAssetLibrary";
import type { ManhuaCustomAssetRef } from "./manhuaCustomAssetRefs";
import {
  planManhuaKeyartEditFusion,
  type ManhuaKeyartEditPlan,
} from "./manhuaKeyartEditFusion";
import { getManhuaSceneTemplate } from "./manhuaSceneAssetLibrary";
import { getManhuaDemoAsset } from "./manhuaScenePropDemoCatalog";
import {
  formatWorkbenchShotInjectBlock,
  type ManhuaWorkbenchShot,
} from "./manhuaScriptWorkbench";

/** 源头短包：单镜出图目标远低于上游 32k */
export const MANHUA_KEYART_SLIM_SOFT_MAX = 8_000;

const STYLE_PROMPT_CAP = 220;
const EDIT_ADDON_CAP = 900;

function capText(s: string, max: number): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function buildManhuaKeyartSlimStyleLock(artStyleId?: string | null): string {
  const style = getManhuaArtStylePreset(artStyleId);
  const body = capText(style.promptZh, STYLE_PROMPT_CAP);
  return `【画风硬锁】${style.labelZh}\n${body}`;
}

export function buildManhuaKeyartSlimIdentityLock(opts: {
  characterIds?: string[] | null;
  ancientArchetypeIds?: string[] | null;
  artStyleId?: string | null;
}): string {
  const ancientIds = (opts.ancientArchetypeIds || []).map(String).filter(Boolean).slice(0, 2);
  if (ancientIds.length) {
    const names = ancientIds
      .map((id) => getAncientArchetypeById(id)?.nameZh)
      .filter(Boolean);
    if (!names.length) return "";
    return `【身份短锁】古风原型：${names.join("、")}。外形服化以垫图/融图为准，保持身份连续。`;
  }
  const ids = (opts.characterIds || []).map(String).filter(Boolean).slice(0, 4);
  const names = ids
    .map((id) =>
      getManhuaCharacterById(id)
        ? getManhuaCharacterDisplayName(id, { artStyleId: opts.artStyleId })
        : "",
    )
    .filter(Boolean);
  if (!names.length) return "";
  return `【身份短锁】${names.join("、")}。五官服化以人物库垫图为准，禁止换脸换装。`;
}

export function buildManhuaKeyartSlimSceneLock(sceneId?: string | null): string {
  const scene = getManhuaSceneTemplate(sceneId);
  if (!scene) return "";
  return `【场景短锁】${scene.nameZh}。环境材质光色承接本集主场景；角色融入场景，禁止跳棚。`;
}

export function buildManhuaKeyartSlimPropLock(propIds?: string[] | null): string {
  const names = (propIds || [])
    .map((id) => getManhuaDemoAsset(String(id || "").trim())?.nameZh)
    .filter(Boolean)
    .slice(0, 4);
  if (!names.length) return "";
  return `【道具短锁】${names.join("、")}。本镜尽量出现一次可读交互或环境落点。`;
}

/** 融图/垫图短指令：去掉冗长资产锁全文 */
export function buildManhuaKeyartSlimEditAddon(plan: ManhuaKeyartEditPlan): string {
  const raw = String(plan.editPromptAddonZh || "").trim();
  if (!raw) return "";
  // 优先保留垫图/CG/人数硬锁首段，整段硬 cap
  const lines = raw.split("\n").filter(Boolean);
  const keep: string[] = [];
  for (const ln of lines) {
    // 跳过冗长资产锁对照表正文（编号列表），只留垫图/画风/人数硬指令
    if (/^【资产锁/.test(ln)) continue;
    if (/^以下编号对应|^@角色|^@场景|^@道具/.test(ln)) continue;
    if (/静帧·|画风执行|人数硬锁|底图|融图参考|暂无可用/.test(ln) || ln.startsWith("【")) {
      keep.push(ln);
    }
  }
  const picked = (keep.length ? keep : lines.slice(0, 6)).slice(0, 10).join("\n");
  return capText(picked, EDIT_ADDON_CAP);
}

export type ManhuaKeyartSlimPromptInput = {
  artStyleId?: string | null;
  characterIds?: string[] | null;
  ancientArchetypeIds?: string[] | null;
  sceneId?: string | null;
  propIds?: string[] | null;
  customRefs?: ManhuaCustomAssetRef[] | null;
  /** 有则附本镜分镜；无则只写短核（expand 前） */
  shot?: ManhuaWorkbenchShot | null;
  /** 已算好的 edit 计划；不传则内部重算 */
  editPlan?: ManhuaKeyartEditPlan | null;
};

/**
 * 组装关键静帧源头短包（可直接写入 block.prompt）。
 */
export function buildManhuaKeyartSlimPrompt(input: ManhuaKeyartSlimPromptInput): string {
  const editPlan =
    input.editPlan ||
    planManhuaKeyartEditFusion({
      characterIds: input.characterIds,
      ancientArchetypeIds: input.ancientArchetypeIds,
      artStyleId: input.artStyleId,
      sceneId: input.sceneId,
      propIds: input.propIds,
      customRefs: input.customRefs,
    });

  const isCg = normalizeManhuaArtStyleId(input.artStyleId) === "cg_drama";
  const parts = [
    "【静帧·源头短包】只含本镜画面指令与短锁；完整设定见角色卡/节拍，勿重复长文。",
    buildManhuaKeyartSlimStyleLock(input.artStyleId),
    buildManhuaKeyartSlimIdentityLock({
      characterIds: input.characterIds,
      ancientArchetypeIds: input.ancientArchetypeIds,
      artStyleId: input.artStyleId,
    }),
    buildManhuaKeyartSlimSceneLock(input.sceneId),
    buildManhuaKeyartSlimPropLock(input.propIds),
    isCg
      ? "【画风执行·CG】半写实二次元/国乙厚涂；禁止仿真人皮肤与纪实摄影。"
      : "",
    buildManhuaKeyartSlimEditAddon(editPlan),
    input.shot ? formatWorkbenchShotInjectBlock(input.shot) : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

/** 去掉本镜分镜段，得到可复用短核（供 expand 换镜） */
export function stripManhuaKeyartShotInject(prompt: string): string {
  return String(prompt || "")
    .replace(/\n*【分镜\s*\d+·静帧[\s\S]*$/i, "")
    .trim();
}

export function attachManhuaKeyartShotInject(
  corePrompt: string,
  shot: ManhuaWorkbenchShot,
): string {
  const core = stripManhuaKeyartShotInject(corePrompt);
  const inject = formatWorkbenchShotInjectBlock(shot);
  return [core, inject].filter(Boolean).join("\n\n");
}

export function estimateManhuaKeyartSlimPromptChars(input: ManhuaKeyartSlimPromptInput): number {
  return buildManhuaKeyartSlimPrompt(input).length;
}
