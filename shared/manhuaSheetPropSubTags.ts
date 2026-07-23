/**
 * 定妆卡特写格 → 道具子编号：
 * - 全局 @道具N（跨集锁定同一件）
 * - 子号 @角色K·道具i（标明挂在哪张定妆卡的特写格）
 * 特写与人物同图时 path 用定妆卡 URL；无图时用 logical:// 占位，只进编号不进融图下载。
 */

import type { ManhuaWriterAssetAnchor, ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon.js";
import { pickPropsForCharacterSheet } from "./manhuaMultiViewAssetSheets.js";

export type ManhuaSheetPropSubSlot = {
  propId: string;
  propNameZh: string;
  characterId: string;
  characterNameZh: string;
  /** 全局 @道具N */
  propTag: string;
  /** 子编号 @角色K·道具i */
  subTag: string;
  localIndex: number;
  parentCharacterTag: string;
  /** 定妆卡图或 logical:// */
  path: string;
};

const SHEET_PROP_MARK = "【定妆特写·道具子编号·跨集锁】";

export function isManhuaSheetPropLogicalPath(path: string): boolean {
  return /^logical:\/\//i.test(String(path || "").trim());
}

export function manhuaSheetPropLogicalPath(characterId: string, propId: string): string {
  return `logical://sheet-prop/${encodeURIComponent(characterId)}/${encodeURIComponent(propId)}`;
}

/**
 * 从系列人物表 + 道具表生成特写格子编号。
 * characterTagById / sheetUrlByCharacterId 缺省时仍出逻辑号（角色按表序 @角色1…）。
 */
export function buildManhuaSheetPropSubSlots(opts: {
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** wa_char_* → @角色N */
  characterTagById?: Record<string, string> | null;
  /** wa_char_* → 定妆卡 HTTPS */
  sheetUrlByCharacterId?: Record<string, string> | null;
  /** 每角色最多特写道具数 */
  perCharacterLimit?: number;
}): ManhuaSheetPropSubSlot[] {
  const canon = opts.assetCanon;
  if (!canon?.characters?.length || !canon.props?.length) return [];

  const perChar = Math.max(1, Math.min(6, Math.floor(opts.perCharacterLimit ?? 3)));
  const tagById = opts.characterTagById || {};
  const urlById = opts.sheetUrlByCharacterId || {};

  // 先按角色表序定 @角色（无外来 tag 时）
  const charOrder = canon.characters.map((c, i) => ({
    ...c,
    fallbackTag: `@角色${i + 1}`,
  }));

  type Pair = {
    character: ManhuaWriterAssetAnchor;
    parentCharacterTag: string;
    prop: ManhuaWriterAssetAnchor;
    localIndex: number;
    path: string;
  };
  const pairs: Pair[] = [];
  for (const ch of charOrder) {
    const parentTag = String(tagById[ch.id] || ch.fallbackTag).trim();
    const props = pickPropsForCharacterSheet(ch, canon.props, perChar);
    props.forEach((p, idx) => {
      const url = String(urlById[ch.id] || "").trim();
      pairs.push({
        character: ch,
        parentCharacterTag: parentTag,
        prop: p,
        localIndex: idx + 1,
        path: url || manhuaSheetPropLogicalPath(ch.id, p.id),
      });
    });
  }

  // 全局 @道具N：按 propId 稳定排序后首次出现分配，跨角色复用同号
  const propIdOrder = Array.from(new Set(pairs.map((x) => x.prop.id))).sort((a, b) =>
    a.localeCompare(b),
  );
  const propTagById = new Map<string, string>();
  propIdOrder.forEach((id, i) => {
    propTagById.set(id, `@道具${i + 1}`);
  });

  return pairs.map((x) => {
    const propTag = propTagById.get(x.prop.id) || "@道具1";
    const localIndex = x.localIndex;
    return {
      propId: x.prop.id,
      propNameZh: x.prop.nameZh,
      characterId: x.character.id,
      characterNameZh: x.character.nameZh,
      propTag,
      subTag: `${x.parentCharacterTag}·道具${localIndex}`,
      localIndex,
      parentCharacterTag: x.parentCharacterTag,
      path: x.path,
    };
  });
}

/** 写入定妆卡 prompt：特写格 ↔ @道具 对照（画面不烧字，给导戏/跨集锁用） */
export function stampManhuaSheetPropSubTagsOnPrompt(
  prompt: string,
  slots: ManhuaSheetPropSubSlot[],
  parentCharacterTag?: string,
): string {
  const mine = parentCharacterTag
    ? slots.filter((s) => s.parentCharacterTag === parentCharacterTag)
    : slots;
  if (!mine.length) {
    return String(prompt || "")
      .replace(new RegExp(`${SHEET_PROP_MARK}[\\s\\S]*?(?=\\n【|$)`), "")
      .trim();
  }
  const body = String(prompt || "")
    .replace(new RegExp(`${SHEET_PROP_MARK}[\\s\\S]*?(?=\\n【|$)`), "")
    .trim();
  const lines = [
    SHEET_PROP_MARK,
    "定妆特写格已自动编入全局道具号（跨集同号锁定）；子号标明挂在本角色卡：",
    ...mine.map(
      (s) =>
        `${s.subTag}=${s.propTag}=${s.propNameZh}（跟定妆特写格；跨集锁 ${s.propTag}，勿另造同名道具）`,
    ),
  ];
  return `${lines.join("\n")}\n${body}`.trim();
}

/** 资产锁总表附加段 */
export function formatManhuaSheetPropSubTagsLockBlock(
  slots: ManhuaSheetPropSubSlot[],
): string {
  if (!slots.length) return "";
  // 按全局道具号去重展示主行，再附子号
  const byProp = new Map<string, ManhuaSheetPropSubSlot[]>();
  for (const s of slots) {
    const list = byProp.get(s.propTag) || [];
    list.push(s);
    byProp.set(s.propTag, list);
  }
  const lines: string[] = [
    "【定妆特写·道具子编号·跨集锁】",
    "特写格道具进全局 @道具N；换集仍用同一号，禁止漂移另造。",
  ];
  const propRows = Array.from(byProp.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  );
  for (const [propTag, list] of propRows) {
    const name = list[0]!.propNameZh;
    const subs = list.map((slot) => slot.subTag).join("、");
    lines.push(`${propTag}=${name} ← ${subs}`);
  }
  return lines.join("\n");
}

/** 从定妆 prompt 解析已盖章的子编号行 */
export function parseManhuaSheetPropSubTagsFromPrompt(
  prompt: string | null | undefined,
): Array<{ subTag: string; propTag: string; labelZh: string }> {
  const raw = String(prompt || "");
  const out: Array<{ subTag: string; propTag: string; labelZh: string }> = [];
  const re =
    /(@角色\d+·道具\d+)=(@道具\d+)=([^\n（(]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out.push({
      subTag: m[1]!,
      propTag: m[2]!,
      labelZh: m[3]!.trim().slice(0, 40),
    });
  }
  return out;
}
