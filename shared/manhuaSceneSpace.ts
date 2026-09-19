import { z } from "zod";

export const manhuaSpatialScopeSchema = z.object({
  episode: z.number().int().positive(),
  segmentIndex: z.number().int().positive(),
  shotId: z.string().min(1).optional(),
  sourceRevision: z.string().min(1).optional(),
});
export type ManhuaSpatialScope = z.infer<typeof manhuaSpatialScopeSchema>;
const manhuaSpatialContextSchema = z.object({
  episode: z.number().int().positive(),
  segmentIndex: z.number().int().positive(),
  sourceRevision: z.string().min(1).optional(),
  shotIds: z.array(z.string().min(1)),
  actorIds: z.array(z.string().min(1)),
  sceneIds: z.array(z.string().min(1)),
});
export type ManhuaSpatialContext = z.infer<typeof manhuaSpatialContextSchema>;
export function normalizeManhuaSpatialContext(
  raw: unknown
): ManhuaSpatialContext | undefined {
  const parsed = manhuaSpatialContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
export function matchesManhuaSpatialScope(
  scope: ManhuaSpatialScope,
  context: ManhuaSpatialContext
): boolean {
  return (
    scope.episode === context.episode &&
    scope.segmentIndex === context.segmentIndex &&
    scope.sourceRevision === context.sourceRevision &&
    (!scope.shotId || Boolean(context.shotIds?.includes(scope.shotId)))
  );
}

/** 非比例空间拓扑；不推断图片深度、碰撞面或真实尺度。 */
export const manhuaSceneSpaceSchema = z.object({
  version: z.literal(1),
  sourceRefId: z.string().min(1),
  sourceVersion: z.string().min(1),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  sourceNoteZh: z.string(),
  zones: z.array(
    z.object({
      id: z.string().min(1),
      labelZh: z.string(),
      fixedFeaturesZh: z.string(),
    })
  ),
  passages: z.array(
    z.object({
      id: z.string().min(1),
      fromId: z.string(),
      toId: z.string(),
      labelZh: z.string(),
      bidirectional: z.boolean(),
      directionZh: z.string().optional(),
      designDistanceM: z.number().finite().positive().optional(),
      slopeZh: z.string().optional(),
      designBasisZh: z.string().optional(),
    })
  ),
  actorPositions: z
    .array(
      z.object({
        id: z.string().min(1),
        scope: manhuaSpatialScopeSchema,
        actorId: z.string().min(1),
        zoneId: z.string(),
        positionZh: z.string(),
        designPosition: z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1), facingDegrees: z.number().finite().min(0).lt(360) }).optional(),
        facingZh: z.string(),
        visibility: z.enum(["visible", "offscreen", "occluded"]),
        occlusionZh: z.string(),
        sourceZh: z.string(),
      })
    )
    .optional(),
  storyCues: z
    .array(
      z.object({
        id: z.string().min(1),
        scope: manhuaSpatialScopeSchema,
        passageId: z.string(),
        actorId: z.string().min(1),
        eventZh: z.string(),
        emotionZh: z.string(),
        musicCue: z.enum(["rise", "turn", "fall", "breath"]),
        musicNoteZh: z.string(),
        sourceZh: z.string(),
      })
    )
    .optional(),
});
export type ManhuaSceneSpace = z.infer<typeof manhuaSceneSpaceSchema>;
export type ManhuaSceneSpaceRef = {
  id: string;
  role: string;
  url: string;
  gcsUri?: string;
  reviewStatus?: string;
  sceneSpace?: ManhuaSceneSpace;
};

export function normalizeManhuaSceneSpace(
  raw: unknown
): ManhuaSceneSpace | undefined {
  const parsed = manhuaSceneSpaceSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
export function manhuaSceneSpaceSourceVersion(
  ref: ManhuaSceneSpaceRef
): string {
  if (ref.gcsUri) return ref.gcsUri;
  try {
    const url = new URL(ref.url);
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        /^(x-goog-|x-amz-)/i.test(key) ||
        /^(sig|signature|exp|expires|token|googleaccessid)$/i.test(key)
      )
        url.searchParams.delete(key);
    }
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return ref.url;
  }
}
export function inspectManhuaSceneSpace(space: ManhuaSceneSpace): string[] {
  const issues: string[] = [];
  if (!space.sourceNoteZh.trim()) issues.push("请填写剧本或参考图的来源依据");
  if (!space.zones.length) issues.push("至少填写一个实际区域");
  const ids = new Set(space.zones.map(zone => zone.id));
  if (ids.size !== space.zones.length) issues.push("区域身份重复");
  if (space.zones.some(zone => !zone.labelZh.trim()))
    issues.push("区域名称待补");
  if (new Set(space.passages.map(p => p.id)).size !== space.passages.length)
    issues.push("出入口身份重复");
  if (
    space.passages.some(
      p =>
        !ids.has(p.fromId) ||
        !ids.has(p.toId) ||
        p.fromId === p.toId ||
        !p.labelZh.trim()
    )
  )
    issues.push("出入口须有名称，并连接两个不同的现有区域");
  if (
    space.passages.some(
      p =>
        (p.directionZh?.trim() ||
          p.designDistanceM != null ||
          p.slopeZh?.trim()) &&
        !p.designBasisZh?.trim()
    )
  )
    issues.push("路线方向、设计距离与坡向须填写设计依据");
  const positions = space.actorPositions ?? [],
    cues = space.storyCues ?? [];
  if (
    new Set(positions.map(p => p.id)).size !== positions.length ||
    new Set(cues.map(c => c.id)).size !== cues.length
  )
    issues.push("站位或事件身份重复");
  if (
    new Set(
      positions.map(
        p =>
          `${p.scope.episode}/${p.scope.segmentIndex}/${p.scope.shotId ?? ""}/${p.actorId}`
      )
    ).size !== positions.length
  )
    issues.push("同一镜段人物站位重复，请合并为一条");
  if (
    positions.some(
      p =>
        !ids.has(p.zoneId) ||
        !p.actorId.trim() ||
        !p.positionZh.trim() ||
        !p.facingZh.trim() ||
        !p.sourceZh.trim() ||
        (p.visibility !== "visible" && !p.occlusionZh.trim())
    )
  )
    issues.push(
      "人物站位须绑定区域、角色、位置、朝向和依据；画外或遮挡须说明去向"
    );
  if (
    cues.some(
      c =>
        !space.passages.some(p => p.id === c.passageId) ||
        !c.actorId.trim() ||
        !c.eventZh.trim() ||
        !c.emotionZh.trim() ||
        !c.musicNoteZh.trim() ||
        !c.sourceZh.trim()
    )
  )
    issues.push("路线事件须绑定通路、角色、剧情变化、情绪、音乐意图和依据");
  return issues;
}
export function manhuaSceneSpaceState(
  ref: ManhuaSceneSpaceRef
): "missing" | "draft" | "stale" | "approved" {
  const space = ref.sceneSpace;
  if (!space) return "missing";
  if (
    space.sourceRefId !== ref.id ||
    space.sourceVersion !== manhuaSceneSpaceSourceVersion(ref)
  )
    return "stale";
  if (
    ref.role !== "scene" ||
    ref.reviewStatus === "needs_review" ||
    space.status !== "approved" ||
    inspectManhuaSceneSpace(space).length
  )
    return "draft";
  return "approved";
}
/** 沿本段实际采用的场景身份消费，不能按中文同名跨场景借图。 */
export function compileManhuaSceneSpace(
  refs: readonly ManhuaSceneSpaceRef[],
  sceneIds: readonly string[],
  context?: ManhuaSpatialContext
): string {
  const selected = new Set(sceneIds);
  return refs
    .filter(
      ref => selected.has(ref.id) && manhuaSceneSpaceState(ref) === "approved"
    )
    .map(ref => {
      const space = ref.sceneSpace!;
      const names = new Map(space.zones.map(z => [z.id, z.labelZh.trim()]));
      const positions = context
        ? (space.actorPositions ?? []).filter(
            p =>
              matchesManhuaSpatialScope(p.scope, context) &&
              context.actorIds?.includes(p.actorId)
          )
        : [];
      const cues = context
        ? (space.storyCues ?? []).filter(
            c =>
              matchesManhuaSpatialScope(c.scope, context) &&
              context.actorIds?.includes(c.actorId)
          )
        : [];
      const staging = positions
        .map(
          p =>
            `${p.scope.shotId || "本段"}：${p.actorId}在${names.get(p.zoneId)}·${p.positionZh}，朝向${p.facingZh}${p.designPosition ? `（示意坐标x=${p.designPosition.x},y=${p.designPosition.y}；图上朝向${p.designPosition.facingDegrees}度，0度向上顺时针；非世界标定）` : ""}，${{ visible: "在画", offscreen: "画外", occluded: "被遮挡" }[p.visibility]}${p.occlusionZh ? `（${p.occlusionZh}）` : ""}；依据：${p.sourceZh}`
        )
        .join("；");
      const events = cues
        .map(
          c =>
            `${c.scope.shotId || "本段"}：${c.actorId}经${space.passages.find(p => p.id === c.passageId)?.labelZh}，${c.eventZh}；情绪：${c.emotionZh}；音乐意图：${c.musicNoteZh}；依据：${c.sourceZh}`
        )
        .join("；");
      return `【场景空间·${ref.id}·v${space.revision}】非比例拓扑，不代表实测几何。依据：${space.sourceNoteZh}。区域：${space.zones.map(z => `${z.labelZh}${z.fixedFeaturesZh ? `（固定结构：${z.fixedFeaturesZh}）` : ""}`).join("；")}。通路：${space.passages.length ? space.passages.map(p => `${names.get(p.fromId)}${p.bidirectional ? "↔" : "→"}${names.get(p.toId)}（${p.labelZh}）${p.directionZh ? `方向：${p.directionZh}；` : ""}${p.designDistanceM != null ? `设计距离${p.designDistanceM}米（非实测）；` : ""}${p.slopeZh ? `设计坡向：${p.slopeZh}；` : ""}${p.designBasisZh ? `设计依据：${p.designBasisZh}` : ""}`).join("；") : "未标通路，不推断区域间可穿行"}。不得穿越未标明的墙体或出入口。${staging ? `人物调度：${staging}。` : ""}${events ? `路线剧情：${events}。` : ""}`;
    })
    .join("\n");
}

/**
 * 空间调度使用剧本人物身份；参考图身份只通过明确认领转换。
 * primaryBindings 是当前采用关系，须同时满足认领与参考职责；历史
 * primarySelectionScopes、中文名、来源库名称均不构成人物身份。
 * 未建立人物法典的旧项目可显式省略 canonicalActorIds，保留既有 registry 身份；
 * 已有法典但角色删空必须传 []，不能回退到图身份。
 */
export function resolveManhuaSpatialActorIds(
  selectedRefIds: readonly string[],
  refs: readonly {
    id: string;
    role: string;
    reviewStatus?: string;
    refDuty?: string | null;
    claimedAnchorIds?: readonly string[];
    primaryBindings?: readonly { anchorId: string; duty: string; stateId?: string }[];
  }[],
  canonicalActorIds?: readonly string[],
): string[] {
  if (canonicalActorIds === undefined) return Array.from(new Set(selectedRefIds.filter(Boolean)));
  const canonical = new Set(canonicalActorIds);
  const actors = new Set<string>();
  for (const selectedId of selectedRefIds) {
    if (canonical.has(selectedId)) {
      actors.add(selectedId);
      continue;
    }
    const matches = refs.filter(ref => ref.id === selectedId);
    if (matches.length !== 1) continue;
    const ref = matches[0];
    if (ref.role !== "character" || ref.reviewStatus === "needs_review") continue;
    const claims = new Set((ref.claimedAnchorIds ?? []).filter(Boolean));
    const primary = new Set((ref.primaryBindings ?? [])
      .filter(binding => (ref.refDuty === "identity" || ref.refDuty === "look") && binding.duty === ref.refDuty && claims.has(binding.anchorId))
      .map(binding => binding.anchorId));
    // 多人共同采用或多名认领不意味着本镜所有人都在场，也不能取第一人。
    const candidates = primary.size ? primary : claims;
    if (candidates.size !== 1) continue;
    const actorId = candidates.values().next().value;
    if (actorId && canonical.has(actorId)) actors.add(actorId);
  }
  return Array.from(actors);
}
