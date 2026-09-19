/**
 * 资产实体版本栈（对现有 refs 的**纯函数派生**，不新增存储、不迁移 schema）。
 *
 * 线上暴露的问题：资产页把 refs 平铺，角色 18 张里混着同名和多级「编辑」版本，
 * 用户得自己判断哪张是真源。但真源其实已经有了——
 *   归属：`customAssetRefClaimsAnchor(ref, anchor)`（认领到哪个剧本人物/场景/道具）
 *   当前采用：`ref.primaryBindings`（按人物锚点 + 锁脸/妆造职责唯一）
 * 缺的只是「按实体聚合」这一层视图。所以这里只做派生，不碰数据。
 *
 * 三条边界（README 点名，写死）：
 * - **用途不同的图不合并、不删**：A-pose、锁脸、状态图各自是独立用途，只是同属一个实体。
 * - 认领不到任何实体的图**单独列出**，不塞进某个实体充数——它们不参与出片。
 * - 当前采用版本只认 `primaryBindings`，**不猜**（不按时间新旧、不按文件名）。
 */
import type { ManhuaCustomAssetRef, ManhuaCustomAssetRole } from "./manhuaCustomAssetRefs.js";
import type { ManhuaWriterAssetAnchor, ManhuaWriterAssetCanon } from "./manhuaWriterAssetCanon.js";
import { customAssetRefClaimsAnchor } from "./manhuaAssetScriptSync.js";

/** 一张图在实体里的用途。不同用途并存，互不覆盖。 */
export type ManhuaAssetVersionUse = "identity" | "look" | "apose" | "state" | "other";

export type ManhuaAssetVersion = {
  ref: ManhuaCustomAssetRef;
  /** 这张图在本实体里干什么用的 */
  use: ManhuaAssetVersionUse;
  /** 是否本实体某个职责的当前采用版本 */
  isCurrent: boolean;
  /** 当前采用的是哪个职责（identity=锁脸，look=妆造）；非当前版本为空 */
  currentDuties: Array<"identity" | "look">;
  /** 待人工确认的图：不参与出片 */
  needsReview: boolean;
};

export type ManhuaAssetEntity = {
  anchorId: string;
  nameZh: string;
  role: ManhuaCustomAssetRole;
  /** 版本按「当前采用 → 其它」排；同组内保持原顺序，不按时间猜新旧 */
  versions: ManhuaAssetVersion[];
  /** 有没有任何一个职责定下了当前版本 */
  hasCurrent: boolean;
};

export type ManhuaAssetVersionStack = {
  entities: ManhuaAssetEntity[];
  /** 认领不到任何实体的图：不挡出片，但不会被用作参考 */
  unclaimed: ManhuaCustomAssetRef[];
};

/**
 * 判断一张图在这个实体里的用途。
 * A-pose 与状态图靠既有字段识别，识别不出就是 other —— **宁可说不知道，也不乱归类**。
 */
export function manhuaAssetVersionUse(ref: ManhuaCustomAssetRef): ManhuaAssetVersionUse {
  if (ref.refDuty === "identity") return "identity";
  if (ref.refDuty === "look") return "look";
  const label = String(ref.labelZh || "");
  if (/a[-\s]?pose|A姿|展臂/i.test(label)) return "apose";
  if (/状态|受伤|破损|湿身|脏污/.test(label)) return "state";
  return "other";
}

function anchorsOf(canon: ManhuaWriterAssetCanon | null | undefined, role: ManhuaCustomAssetRole) {
  if (!canon) return [] as ManhuaWriterAssetAnchor[];
  if (role === "character") return canon.characters || [];
  if (role === "scene") return canon.locations || [];
  if (role === "prop") return canon.props || [];
  return [] as ManhuaWriterAssetAnchor[];
}

/**
 * 按实体聚合。一张图可以同时认领多个实体（一张合影/一块道具拼板），
 * 此时它在每个实体里各出现一次——这是真实情况，不是重复。
 */
export function buildManhuaAssetVersionStack(input: {
  refs: readonly ManhuaCustomAssetRef[];
  assetCanon?: ManhuaWriterAssetCanon | null;
  /** 只看这些角色（缺省全看） */
  roles?: readonly ManhuaCustomAssetRole[];
}): ManhuaAssetVersionStack {
  const roles = input.roles?.length
    ? input.roles
    : (["character", "scene", "prop", "wardrobe"] as const);
  const entities: ManhuaAssetEntity[] = [];
  const claimedRefIds = new Set<string>();

  for (const role of roles) {
    for (const anchor of anchorsOf(input.assetCanon, role)) {
      const claimed = input.refs.filter(
        (ref) => ref.role === role && customAssetRefClaimsAnchor(ref, anchor),
      );
      if (!claimed.length) continue;
      const versions: ManhuaAssetVersion[] = claimed.map((ref) => {
        claimedRefIds.add(ref.id);
        const duties = (ref.primaryBindings || [])
          .filter((b) => b.anchorId === anchor.id)
          .map((b) => b.duty);
        return {
          ref,
          use: manhuaAssetVersionUse(ref),
          isCurrent: duties.length > 0,
          currentDuties: duties,
          needsReview: ref.reviewStatus === "needs_review",
        };
      });
      // 当前采用的排前面；其余保持原顺序（不按时间/文件名猜新旧）
      versions.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
      entities.push({
        anchorId: anchor.id,
        nameZh: anchor.nameZh,
        role,
        versions,
        hasCurrent: versions.some((v) => v.isCurrent),
      });
    }
  }

  const unclaimed = input.refs.filter(
    (ref) => roles.includes(ref.role as ManhuaCustomAssetRole) && !claimedRefIds.has(ref.id),
  );
  return { entities, unclaimed };
}

/** UI 计数：人物(18) 这种。统计的是**实体数**，不是图片数。 */
export function countManhuaAssetEntities(
  stack: ManhuaAssetVersionStack,
  role: ManhuaCustomAssetRole,
): number {
  return stack.entities.filter((e) => e.role === role).length;
}
