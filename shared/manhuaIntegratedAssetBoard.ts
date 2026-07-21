/**
 * 「一体参考板」数据：把角色 / 服装锚点 / 道具 / 场景收成一张快览结构。
 * 不生成真实拼图文件；UI 用此模型拼板，并产出可注入静帧的参考摘要。
 */

import {
  getManhuaCharacterById,
  getManhuaCharacterDisplayName,
  getManhuaCharacterPreviewUrl,
  type ManhuaCharacterTemplate,
} from "./manhuaCharacterAssetLibrary.js";
import { getAncientArchetypeById } from "./manhuaAncientArchetypeLibrary.js";
import { getManhuaSceneTemplate, type ManhuaSceneTemplate } from "./manhuaSceneAssetLibrary.js";
import {
  getManhuaDemoAsset,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
  MANHUA_CONTENT_LANE_LABEL_ZH,
  type ManhuaDemoAsset,
} from "./manhuaScenePropDemoCatalog.js";

export type ManhuaIntegratedBoardSlot = {
  role: "hero" | "turnaround" | "detail" | "prop" | "scene" | "palette";
  titleZh: string;
  subtitleZh?: string;
  imageUrl?: string;
  bodyZh?: string;
};

export type ManhuaIntegratedAssetBoard = {
  titleZh: string;
  hero: ManhuaIntegratedBoardSlot;
  turnaroundHints: string[];
  characters: Array<{
    id: string;
    nameZh: string;
    previewUrl?: string;
    jobZh?: string;
    tags: string[];
  }>;
  scene: {
    id?: string;
    nameZh: string;
    promptZh: string;
    coreElements: string[];
  } | null;
  props: Array<{ id: string; nameZh: string; previewUrl?: string; laneZh?: string }>;
  /** 配色/关键词（从角色气质 + 场景元素抽） */
  keywordsZh: string[];
  /** 注入静帧前的一行摘要 */
  injectSummaryZh: string;
  slots: ManhuaIntegratedBoardSlot[];
};

export type BuildIntegratedBoardOpts = {
  characterIds?: string[];
  ancientArchetypeIds?: string[];
  sceneId?: string;
  propIds?: string[];
  seriesTitle?: string;
  artStyleLabelZh?: string;
};

function propLaneZh(a: ManhuaDemoAsset): string {
  if (a.kind === "scene") return "场景";
  return MANHUA_CONTENT_LANE_LABEL_ZH[a.lane] || "道具";
}

export function buildManhuaIntegratedAssetBoard(
  opts: BuildIntegratedBoardOpts,
): ManhuaIntegratedAssetBoard {
  const chars: ManhuaCharacterTemplate[] = (opts.characterIds || [])
    .map((id) => getManhuaCharacterById(id))
    .filter(Boolean) as ManhuaCharacterTemplate[];
  const archs = (opts.ancientArchetypeIds || [])
    .map((id) => getAncientArchetypeById(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  const scene: ManhuaSceneTemplate | null = opts.sceneId
    ? getManhuaSceneTemplate(opts.sceneId) || null
    : null;

  let props = (opts.propIds || [])
    .map((id) => getManhuaDemoAsset(id))
    .filter(Boolean) as ManhuaDemoAsset[];
  if (!props.length && scene) {
    props = listManhuaDemoAssetsForSceneTemplate(scene.id).slice(0, 6);
  }

  const primary = chars[0];
  const heroName = primary
    ? getManhuaCharacterDisplayName(primary.id) || primary.nameZh
    : archs[0]
      ? archs[0].nameZh
      : "待选角色";
  const heroUrl = primary
    ? getManhuaCharacterPreviewUrl(primary.id)
    : undefined;

  const sceneName = scene?.nameZh || "待选场景";
  const keywords = Array.from(
    new Set([
      ...(primary?.temperamentTags || []).slice(0, 4),
      ...(scene?.coreElements || []).slice(0, 4),
      ...(opts.artStyleLabelZh ? [opts.artStyleLabelZh] : []),
    ]),
  ).slice(0, 8);

  const propSlots: ManhuaIntegratedBoardSlot[] = props.slice(0, 6).map((p) => ({
    role: "prop" as const,
    titleZh: p.nameZh,
    subtitleZh: propLaneZh(p),
    imageUrl: getManhuaDemoAssetPublicUrl(p.id) || undefined,
  }));

  const slots: ManhuaIntegratedBoardSlot[] = [
    {
      role: "hero",
      titleZh: heroName,
      subtitleZh: sceneName,
      imageUrl: heroUrl,
      bodyZh: primary?.jobZh || undefined,
    },
    {
      role: "turnaround",
      titleZh: "三视图提示",
      bodyZh: "正 / 侧 / 背：出图时保持发型、领口、腰饰与主图一致。",
    },
    ...(scene
      ? [
          {
            role: "scene" as const,
            titleZh: scene.nameZh,
            bodyZh: scene.coreElements.slice(0, 5).join(" · "),
          },
        ]
      : []),
    ...propSlots,
    {
      role: "palette",
      titleZh: "关键词锚",
      bodyZh: keywords.join(" · ") || "确认资产后自动汇总",
    },
  ];

  const injectSummaryZh = [
    `【一体参考·快览】`,
    `角色：${heroName}${chars.length > 1 ? ` 等${chars.length}人` : ""}`,
    `场景：${sceneName}`,
    props.length ? `道具：${props.slice(0, 4).map((p) => p.nameZh).join("、")}` : "",
    keywords.length ? `关键词：${keywords.join("、")}` : "",
    `出静帧时人物服装道具与场景同框自洽；禁止画面烧字。`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    titleZh: opts.seriesTitle
      ? `${opts.seriesTitle} · 一体参考板`
      : "本集一体参考板",
    hero: slots[0]!,
    turnaroundHints: ["正视图：脸与服饰正面可读", "侧视图：发髻/披风厚度", "背视图：腰带与披风层"],
    characters: [
      ...chars.map((c) => ({
        id: c.id,
        nameZh: getManhuaCharacterDisplayName(c.id) || c.nameZh,
        previewUrl: getManhuaCharacterPreviewUrl(c.id),
        jobZh: c.jobZh,
        tags: c.temperamentTags.slice(0, 3),
      })),
      ...archs.map((a) => ({
        id: a.id,
        nameZh: a.nameZh,
        previewUrl: undefined as string | undefined,
        jobZh: a.positioning[0] || "",
        tags: a.coreTags.slice(0, 3),
      })),
    ],
    scene: scene
      ? {
          id: scene.id,
          nameZh: scene.nameZh,
          promptZh: scene.promptZh,
          coreElements: scene.coreElements.slice(0, 6),
        }
      : null,
    props: props.slice(0, 8).map((p) => ({
      id: p.id,
      nameZh: p.nameZh,
      previewUrl: getManhuaDemoAssetPublicUrl(p.id) || undefined,
      laneZh: propLaneZh(p),
    })),
    keywordsZh: keywords,
    injectSummaryZh,
    slots,
  };
}
