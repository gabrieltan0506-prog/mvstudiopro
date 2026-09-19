/**
 * 资产页分组视图（对 `buildManhuaAssetVersionStack` 的 **UI 投影**，仍然是纯函数）。
 *
 * 线上问题（0918 截图）：「我的角色」一栏把 18 张图平铺，同一个人的锁脸图、A-pose、
 * 状态图、多级「编辑」副本混在一起，用户得自己猜哪张在出片。
 *
 * 这里只做三件事，**不删图、不合并用途、不猜当前版本**：
 * 1. 按剧本实体（人物/场景/道具锚点）分组，组头写清当前采用的是哪个职责；
 * 2. 认领不到实体的图单独成组，明说它们不参与出片；
 * 3. 一张图被多个实体认领时**只渲染一次**（挂在锚点表里排第一的那个实体下），
 *    其余实体的组里写明「与 X 共用」——因为卡片带勾选框和删除按钮，
 *    同一张图渲染两次会让用户对着两张卡做一次删除（选择态是按 refId 去重的）。
 *
 * 没有锚点的栏（服装子类）不硬凑实体：退回单一平铺组，不给它盖「未认领」的帽子。
 */
import type { ManhuaCustomAssetRef, ManhuaCustomAssetRole } from "@shared/manhuaCustomAssetRefs";
import type { ManhuaWriterAssetCanon } from "@shared/manhuaWriterAssetCanon";
import {
  buildManhuaAssetVersionStack,
  manhuaAssetVersionUse,
  type ManhuaAssetVersionUse,
} from "@shared/manhuaAssetVersionStack";

export type ManhuaAssetGroupKind = "entity" | "unclaimed" | "flat";

export const MANHUA_ASSET_VERSION_USE_LABEL_ZH: Record<ManhuaAssetVersionUse, string> = {
  identity: "锁脸",
  look: "妆造",
  apose: "A-pose",
  state: "状态",
  other: "其它版本",
};

export type ManhuaAssetEntityGroup = {
  key: string;
  kind: ManhuaAssetGroupKind;
  anchorId: string | null;
  /** 组头标题：实体名 / 未认领栏标题 / 平铺组为空串 */
  titleZh: string;
  /** 当前采用版本的说明。缺就明说缺，不写「已就绪」 */
  currentZh: string;
  hasCurrent: boolean;
  /** 这一组要渲染的图；每张图全栏只出现一次 */
  refs: ManhuaCustomAssetRef[];
  /** refId → 用途标（锁脸/A-pose/状态…） */
  useZhByRefId: Record<string, string>;
  /** refId → 「同时是『李四』的参考图」；没有共用时不出现 */
  alsoInZhByRefId: Record<string, string>;
  /** 本组的图都挂在别的实体下时的说明；正常为空串 */
  sharedNoteZh: string;
};

export type ManhuaAssetRoleGroups = {
  groups: ManhuaAssetEntityGroup[];
  /** 实体数（人物个数），不是图片数 */
  entityCount: number;
  imageCount: number;
  /** 还没定下当前采用版本的实体数 */
  missingCurrentCount: number;
  /** 组头计数文案：「3 个人物 · 18 张图」；无实体维度的栏只报张数 */
  headerCountZh: string;
};

const ROLE_UNIT_ZH: Partial<Record<ManhuaCustomAssetRole, string>> = {
  character: "个人物",
  scene: "个场景",
  prop: "件道具",
};

function currentZhOf(role: ManhuaCustomAssetRole, duties: ReadonlySet<string>): string {
  const hasIdentity = duties.has("identity");
  const hasLook = duties.has("look");
  if (role !== "character") return hasIdentity || hasLook ? "当前版本已定" : "未定当前版本";
  if (hasIdentity && hasLook) return "当前：锁脸 + 妆造";
  if (hasIdentity) return "当前：锁脸（妆造未定）";
  if (hasLook) return "当前：妆造（锁脸未定）";
  return "未定当前版本";
}

export function buildManhuaAssetRoleGroups(input: {
  refs: readonly ManhuaCustomAssetRef[];
  assetCanon?: ManhuaWriterAssetCanon | null;
  role: ManhuaCustomAssetRole;
}): ManhuaAssetRoleGroups {
  const roleRefs = input.refs.filter((ref) => ref.role === input.role);
  const stack = buildManhuaAssetVersionStack({
    refs: roleRefs,
    assetCanon: input.assetCanon,
    roles: [input.role],
  });

  // 没有实体维度（服装子类，或剧本还没有这类锚点）：平铺，不假装分组
  if (!stack.entities.length) {
    return {
      groups: [
        {
          key: "__flat",
          kind: "flat",
          anchorId: null,
          titleZh: "",
          currentZh: "",
          hasCurrent: false,
          refs: [...roleRefs],
          useZhByRefId: Object.fromEntries(
            roleRefs.map((ref) => [ref.id, MANHUA_ASSET_VERSION_USE_LABEL_ZH[manhuaAssetVersionUse(ref)]]),
          ),
          alsoInZhByRefId: {},
          sharedNoteZh: "",
        },
      ],
      entityCount: 0,
      imageCount: roleRefs.length,
      missingCurrentCount: 0,
      headerCountZh: `${roleRefs.length} 张图`,
    };
  }

  // 一张图归属第一个认领它的实体；其余实体只写共用说明
  const ownerByRefId = new Map<string, string>();
  const namesByRefId = new Map<string, string[]>();
  for (const entity of stack.entities) {
    for (const version of entity.versions) {
      if (!ownerByRefId.has(version.ref.id)) ownerByRefId.set(version.ref.id, entity.anchorId);
      const names = namesByRefId.get(version.ref.id) || [];
      names.push(entity.nameZh);
      namesByRefId.set(version.ref.id, names);
    }
  }

  const entityGroups: ManhuaAssetEntityGroup[] = stack.entities.map((entity) => {
    const duties = new Set<string>();
    for (const version of entity.versions) for (const duty of version.currentDuties) duties.add(duty);
    const owned = entity.versions.filter((v) => ownerByRefId.get(v.ref.id) === entity.anchorId);
    const useZhByRefId: Record<string, string> = {};
    const alsoInZhByRefId: Record<string, string> = {};
    for (const version of owned) {
      // 当前采用版本的用途以「它正在担的职责」为准：refDuty 有没有填都不影响这张卡的标签，
      // 否则线上会出现「当前锁脸图」却标成「其它版本」（本地探针抓到）。
      const dutyUse = version.currentDuties[0];
      useZhByRefId[version.ref.id] = dutyUse
        ? MANHUA_ASSET_VERSION_USE_LABEL_ZH[dutyUse]
        : MANHUA_ASSET_VERSION_USE_LABEL_ZH[version.use];
      const others = (namesByRefId.get(version.ref.id) || []).filter((n) => n !== entity.nameZh);
      if (others.length) alsoInZhByRefId[version.ref.id] = `同时是「${others.join("、")}」的参考图`;
    }
    const sharedNames = entity.versions
      .filter((v) => ownerByRefId.get(v.ref.id) !== entity.anchorId)
      .flatMap((v) => (namesByRefId.get(v.ref.id) || []).filter((n) => n !== entity.nameZh));
    return {
      key: entity.anchorId,
      kind: "entity" as const,
      anchorId: entity.anchorId,
      titleZh: entity.nameZh,
      currentZh: currentZhOf(entity.role, duties),
      hasCurrent: entity.hasCurrent,
      refs: owned.map((v) => v.ref),
      useZhByRefId,
      alsoInZhByRefId,
      sharedNoteZh:
        !owned.length && sharedNames.length
          ? `参考图与「${Array.from(new Set(sharedNames)).join("、")}」共用，卡片在上面那组`
          : "",
    };
  });

  // 缺当前版本的排前面（这是真正卡住出片的那几个），其余保持剧本锚点表顺序
  const ordered = [
    ...entityGroups.filter((g) => !g.hasCurrent),
    ...entityGroups.filter((g) => g.hasCurrent),
  ];

  if (stack.unclaimed.length) {
    ordered.push({
      key: "__unclaimed",
      kind: "unclaimed",
      anchorId: null,
      titleZh: `未认领到剧本${input.role === "scene" ? "场景" : input.role === "prop" ? "道具" : "人物"}`,
      currentZh: "不参与出片：静帧不会拿它当垫图",
      hasCurrent: false,
      refs: [...stack.unclaimed],
      useZhByRefId: Object.fromEntries(
        stack.unclaimed.map((ref) => [ref.id, MANHUA_ASSET_VERSION_USE_LABEL_ZH[manhuaAssetVersionUse(ref)]]),
      ),
      alsoInZhByRefId: {},
      sharedNoteZh: "",
    });
  }

  const entityCount = stack.entities.length;
  const unitZh = ROLE_UNIT_ZH[input.role] || "个";
  return {
    groups: ordered,
    entityCount,
    imageCount: roleRefs.length,
    missingCurrentCount: entityGroups.filter((g) => !g.hasCurrent).length,
    headerCountZh: `${entityCount} ${unitZh} · ${roleRefs.length} 张图`,
  };
}
