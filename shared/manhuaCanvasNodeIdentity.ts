/**
 * 画布节点 → 它到底是哪一段哪一镜（纯函数）。
 *
 * 对照图 02 第一格 + README：「沿用本集画布和段身份，聚焦本段镜头关联；**侧栏显示所选镜头**」。
 * 线上现状：本集画布是主预览，用户在上面点中一个节点，工作台侧栏什么都不说 ——
 * 节点 id 形如 `keyart-e01-s03-…`／`clip-e01-g02-…`，身份其实写在 id 里，只是没人读给用户听。
 *
 * 这里只**读身份**，不改选中、不跳转、不生成。判不出来就如实说判不出来，不猜。
 */
import {
  resolveClipLocalSegmentIndex,
  resolveKeyartShotIndex,
  resolveSegmentIndexFromShotIndex,
  type ManhuaWorkbenchSegment,
} from "./manhuaScriptWorkbench.js";

export type ManhuaCanvasNodeKind = "keyart" | "clip" | "final" | "story" | "reverse" | "asset" | "other";

export const MANHUA_CANVAS_NODE_KIND_ZH: Record<ManhuaCanvasNodeKind, string> = {
  keyart: "关键静帧",
  clip: "段成片",
  final: "整集成片",
  story: "剧本节点",
  reverse: "反推节点",
  asset: "资产图",
  other: "其它节点",
};

export type ManhuaCanvasNodeIdentity = {
  kind: ManhuaCanvasNodeKind;
  kindZh: string;
  episode: number | null;
  /** 段号：只有段成片与能解析出段的静帧才有 */
  segmentIndex: number | null;
  /** 镜号：只有关键静帧才有 */
  shotIndex: number | null;
  /** 一行人话：「第1集 · 第2段 · 镜03 关键静帧」 */
  labelZh: string;
};

function episodeOf(blockId: string, episodeIndex?: number | null): number | null {
  const n = Math.floor(Number(episodeIndex) || 0);
  if (n > 0) return n;
  const m = /-e(\d{1,3})(?:-|$)/i.exec(blockId);
  return m ? Number(m[1]) : null;
}

function kindOf(blockId: string): ManhuaCanvasNodeKind {
  if (blockId.startsWith("keyart-")) return "keyart";
  if (blockId.startsWith("clip-")) return "clip";
  if (blockId.startsWith("final-")) return "final";
  if (blockId.startsWith("story-")) return "story";
  if (blockId.startsWith("reverse-")) return "reverse";
  if (/^(char|scene|prop|asset|sheet)-/.test(blockId)) return "asset";
  return "other";
}

export function readManhuaCanvasNodeIdentity(input: {
  blockId?: string | null;
  prompt?: string | null;
  episodeIndex?: number | null;
  /** 真实段表：给了就按它把镜号映射到段号，不给就按每段镜数推 */
  segments?: ManhuaWorkbenchSegment[];
}): ManhuaCanvasNodeIdentity | null {
  const blockId = String(input.blockId || "").trim();
  if (!blockId) return null;
  const kind = kindOf(blockId);
  const kindZh = MANHUA_CANVAS_NODE_KIND_ZH[kind];
  const episode = episodeOf(blockId, input.episodeIndex);

  let shotIndex: number | null = null;
  let segmentIndex: number | null = null;
  if (kind === "keyart") {
    // 注意：keyart id 里的 `-sNN` 是**镜号**（`resolveKeyartShotIndex` 就是这么读的），
    // 不是段号。段号只能由镜号映射，或由真实段表给出 —— 直接拿 sNN 当段号会整段标错。
    const shot = resolveKeyartShotIndex(blockId, input.prompt || "");
    shotIndex = shot > 0 ? shot : null;
    segmentIndex = shotIndex ? resolveSegmentIndexFromShotIndex(shotIndex, input.segments) : null;
  } else if (kind === "clip") {
    const seg = resolveClipLocalSegmentIndex(blockId, input.prompt || "", episode || 1);
    segmentIndex = seg > 0 ? seg : null;
  }

  const parts = [
    episode ? `第${episode}集` : "",
    segmentIndex ? `第${segmentIndex}段` : "",
    shotIndex ? `镜${String(shotIndex).padStart(2, "0")}` : "",
    kindZh,
  ].filter(Boolean);
  return { kind, kindZh, episode, segmentIndex, shotIndex, labelZh: parts.join(" · ") };
}

/**
 * 选中的节点属不属于用户此刻正在编辑的那一段。
 * 判不出段号时返回 "unknown" —— 不许默认当成「就是本段」，那会让人以为改对了地方。
 */
export function manhuaCanvasNodeBelongsToSegment(
  identity: ManhuaCanvasNodeIdentity | null,
  current: { episode: number; segmentIndex: number },
): "current" | "other" | "unknown" {
  if (!identity) return "unknown";
  if (identity.episode && identity.episode !== current.episode) return "other";
  if (!identity.episode || !identity.segmentIndex) return "unknown";
  return identity.segmentIndex === current.segmentIndex ? "current" : "other";
}
