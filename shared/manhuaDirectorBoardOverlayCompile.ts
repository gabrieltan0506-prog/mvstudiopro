/**
 * 从现有可拍表／镜级字段确定性编译导演板矢量层。
 *
 * 这里只识别明确方向、明确运镜或明确空间位置；“激烈、靠近、震撼”等
 * 没有起终点的词不会被猜成路线。编译不调用模型，也不产生任何计费副作用。
 */

import { splitManhuaCastZhNames } from "./manhuaAssetLockRegistry.js";
import type { ManhuaEpisodeSegmentBeat } from "./manhuaEpisodeSegmentPlan.js";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";
import {
  MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
  MANHUA_BOARD_MOTION_OVERLAY_LIMITS,
  parseManhuaBoardMotionOverlay,
  rebindManhuaBoardOverlayBase,
  type ManhuaBoardActionPhase,
  type ManhuaBoardActorRoute,
  type ManhuaBoardAspectRatio,
  type ManhuaBoardCameraMove,
  type ManhuaBoardCameraPath,
  type ManhuaBoardLandingKind,
  type ManhuaBoardLandingPoint,
  type ManhuaBoardMotionOverlayV1,
  type ManhuaBoardNormalizedPoint,
  type ManhuaBoardScreenDirection,
  type ManhuaBoardSpatialAxis,
} from "./manhuaDirectorBoardOverlay.js";

type SegmentMotionFields = Partial<
  Pick<
    ManhuaEpisodeSegmentBeat,
    | "index"
    | "performanceZh"
    | "castZh"
    | "wardrobePropZh"
    | "lightingCameraZh"
    | "sceneZh"
  >
>;

type ShotMotionFields = Partial<
  Pick<ManhuaWorkbenchShot, "index" | "actionZh" | "cameraZh">
>;

export type ManhuaBoardStructuredMotionInput = {
  actorRoutes?: Array<{
    entityId: string;
    entityKind: "character" | "prop";
    points: ManhuaBoardNormalizedPoint[];
    actionPhase?: ManhuaBoardActionPhase;
    confidence?: number;
  }>;
  cameraPath?: {
    move: ManhuaBoardCameraMove;
    points: ManhuaBoardNormalizedPoint[];
    confidence?: number;
  } | null;
  axis?: ManhuaBoardSpatialAxis | null;
  landingPoints?: Array<{
    kind: ManhuaBoardLandingKind;
    at: ManhuaBoardNormalizedPoint;
    entityIds?: string[];
  }>;
};

export type CompileManhuaDirectorBoardOverlayInput = {
  episodeIndex: number;
  segmentIndex: number;
  shotIndex?: number;
  baseAspectRatio?: ManhuaBoardAspectRatio;
  /** 底图稳定身份（应去掉签名查询参数）；重出底图时触发待复核。 */
  baseMediaIdentity?: string;
  sourceRevision?: string;
  beat?: SegmentMotionFields | null;
  shot?: ShotMotionFields | null;
  /** 新分镜可在既有请求中直接带明确坐标；不会新增模型调用。 */
  structuredMotion?: ManhuaBoardStructuredMotionInput | null;
  /** 人工调过的同镜 overlay 不被自动重编译覆盖。 */
  existingOverlay?: unknown;
};

export type CompileManhuaSegmentDirectorBoardOverlayInput = {
  episodeIndex: number;
  segmentIndex: number;
  /** 段级裁切导演板优先；没有时只允许回退同段首镜静帧。 */
  segmentBoardUrls?: Readonly<Record<number, string>> | null;
  segmentFirstShotStillUrl?: string | null;
  /** UI 传实测像素比例；消费端省略时只复用已保存 overlay 的实测比例。 */
  baseAspectRatio?: ManhuaBoardAspectRatio;
  beat?: SegmentMotionFields | null;
  /** 必须传整段镜头，revision 同时覆盖全部动作与运镜变化。 */
  shots?: ReadonlyArray<ShotMotionFields> | null;
  existingOverlay?: unknown;
};

type DirectionMatch = {
  points: ManhuaBoardNormalizedPoint[];
  screenDirection?: ManhuaBoardScreenDirection;
  confidence: number;
};

const GARMENT_RE = /衣|袍|甲|裙|服|巾|靴|冠|钗|饰|带|篷|裳|鞋|帽|袄|装/;
const CAMERA_CLAUSE_RE =
  /镜头|机位|摄影机|摄像机|运镜|推近|拉远|摇镜|摇摄|跟拍|环绕/;
const PROP_MOTION_RE = /掷|扔|抛|飞|射|滑|滚|坠|掉|落|递|交给|交接|接住|接过/;

function cleanText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 1200) : "";
}

function stableMediaIdentity(raw: unknown): string {
  return cleanText(raw).split(/[?#]/, 1)[0] || "";
}

function clampConfidence(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

function point(x: number, y: number): ManhuaBoardNormalizedPoint {
  return { x, y };
}

function directionFromExplicitText(text: string): DirectionMatch | null {
  const t = cleanText(text);
  if (!t) return null;
  if (
    /(?:从|自|由)(?:画面)?左(?:侧|边|方)?[^。；，,]{0,24}(?:到|至|向|往)(?:画面)?右(?:侧|边|方)?|自左向右|从左到右/.test(
      t
    )
  ) {
    return {
      points: [point(0.16, 0.66), point(0.82, 0.66)],
      screenDirection: "left_to_right",
      confidence: 0.82,
    };
  }
  if (
    /(?:从|自|由)(?:画面)?右(?:侧|边|方)?[^。；，,]{0,24}(?:到|至|向|往)(?:画面)?左(?:侧|边|方)?|自右向左|从右到左/.test(
      t
    )
  ) {
    return {
      points: [point(0.84, 0.66), point(0.18, 0.66)],
      screenDirection: "right_to_left",
      confidence: 0.82,
    };
  }
  if (/(?:向|往|朝)(?:画面)?右(?:侧|边|方)?/.test(t)) {
    return {
      points: [point(0.44, 0.66), point(0.82, 0.66)],
      screenDirection: "left_to_right",
      confidence: 0.64,
    };
  }
  if (/(?:向|往|朝)(?:画面)?左(?:侧|边|方)?/.test(t)) {
    return {
      points: [point(0.56, 0.66), point(0.18, 0.66)],
      screenDirection: "right_to_left",
      confidence: 0.64,
    };
  }
  if (
    /(?:从|自|由)(?:后景|远处|画面深处)[^。；，,]{0,24}(?:到|至|向|往)(?:前景|镜头|近处)/.test(
      t
    )
  ) {
    return {
      points: [point(0.5, 0.3), point(0.5, 0.78)],
      screenDirection: "toward",
      confidence: 0.82,
    };
  }
  if (
    /(?:从|自|由)(?:前景|镜头前|近处)[^。；，,]{0,24}(?:到|至|向|往)(?:后景|远处|画面深处)/.test(
      t
    )
  ) {
    return {
      points: [point(0.5, 0.78), point(0.5, 0.3)],
      screenDirection: "away",
      confidence: 0.82,
    };
  }
  if (/(?:朝|向|往)(?:镜头|前景|近处)|迎面(?:而来|冲来|走来)/.test(t)) {
    return {
      points: [point(0.5, 0.42), point(0.5, 0.78)],
      screenDirection: "toward",
      confidence: 0.66,
    };
  }
  if (/(?:背离|远离)(?:镜头|前景)|(?:朝|向|往)(?:远处|后景|画面深处)/.test(t)) {
    return {
      points: [point(0.5, 0.72), point(0.5, 0.32)],
      screenDirection: "away",
      confidence: 0.66,
    };
  }
  if (
    /(?:从|自|由)(?:上方|顶部)[^。；，,]{0,24}(?:到|至|向|往)(?:下方|底部)/.test(
      t
    )
  ) {
    return { points: [point(0.5, 0.2), point(0.5, 0.8)], confidence: 0.78 };
  }
  if (
    /(?:从|自|由)(?:下方|底部)[^。；，,]{0,24}(?:到|至|向|往)(?:上方|顶部)/.test(
      t
    )
  ) {
    return { points: [point(0.5, 0.8), point(0.5, 0.2)], confidence: 0.78 };
  }
  return null;
}

function splitTokens(raw: string): string[] {
  return cleanText(raw)
    .split(/[；;、，,/|\n]+/)
    .map(token => token.replace(/（[^）]*）|\([^)]*\)/g, "").trim())
    .filter(token => token.length >= 2 && token.length <= 24);
}

function propNamesFromWardrobe(raw: string): string[] {
  return splitTokens(raw).filter(token => !GARMENT_RE.test(token));
}

function chooseEntityForClause(
  clause: string,
  castNames: string[],
  propNames: string[]
): { entityId: string; entityKind: "character" | "prop" } | null {
  const namedProps = propNames.filter(name => clause.includes(name));
  if (namedProps.length === 1 && PROP_MOTION_RE.test(clause)) {
    return { entityId: namedProps[0]!, entityKind: "prop" };
  }
  const directionalCast = castNames.filter(name =>
    new RegExp(`${escapeRegExp(name)}(?:从|自|由|向|往|朝)`).test(clause)
  );
  if (directionalCast.length === 1) {
    return { entityId: directionalCast[0]!, entityKind: "character" };
  }
  const namedCast = castNames.filter(name => clause.includes(name));
  if (namedCast.length === 1)
    return { entityId: namedCast[0]!, entityKind: "character" };
  if (namedProps.length === 1 && !namedCast.length) {
    return { entityId: namedProps[0]!, entityKind: "prop" };
  }
  if (castNames.length === 1 && !namedProps.length) {
    return { entityId: castNames[0]!, entityKind: "character" };
  }
  return null;
}

function actionPhaseFromText(text: string): ManhuaBoardActionPhase {
  if (/碰撞|撞上|撞击|击中|接触|触碰|交给|递给|接住|抓住/.test(text))
    return "contact";
  if (/落地|落在|倒地|停下|站定|结果|后退至|抵达/.test(text)) return "result";
  return "path";
}

function compileLegacyActorRoutes(input: {
  actionText: string;
  castNames: string[];
  propNames: string[];
}): ManhuaBoardActorRoute[] {
  const clauses = cleanText(input.actionText)
    .split(/[。；;！!？?\n]+/)
    .map(clause => clause.trim())
    .filter(Boolean);
  const routes: ManhuaBoardActorRoute[] = [];
  const seen = new Set<string>();
  for (const clause of clauses) {
    if (CAMERA_CLAUSE_RE.test(clause)) continue;
    const direction = directionFromExplicitText(clause);
    if (!direction) continue;
    const entity = chooseEntityForClause(
      clause,
      input.castNames,
      input.propNames
    );
    if (!entity || seen.has(entity.entityId)) continue;
    seen.add(entity.entityId);
    routes.push({
      routeId: `route-${routes.length + 1}`,
      entityId: entity.entityId,
      entityKind: entity.entityKind,
      points: direction.points,
      actionPhase: actionPhaseFromText(clause),
      source: "legacy_explicit",
      confidence: direction.confidence,
    });
    if (routes.length >= MANHUA_BOARD_MOTION_OVERLAY_LIMITS.actorRoutes) break;
  }
  return routes;
}

function compileCameraPath(
  cameraText: string,
  actorRoutes: ManhuaBoardActorRoute[]
): ManhuaBoardCameraPath | null {
  const text = cleanText(cameraText);
  if (!text || /固定机位|固定镜头|锁定机位/.test(text)) return null;
  if (/推近|推进|前移|向前推/.test(text)) {
    return {
      move: "push",
      points: [point(0.5, 0.2), point(0.5, 0.58)],
      source: "legacy_explicit",
      confidence: 0.78,
    };
  }
  if (/拉远|后拉|后撤镜头|镜头后退/.test(text)) {
    return {
      move: "pull",
      points: [point(0.5, 0.58), point(0.5, 0.2)],
      source: "legacy_explicit",
      confidence: 0.78,
    };
  }
  const explicitDirection = directionFromExplicitText(text);
  if (/跟拍|跟随|追拍|贴身跟/.test(text) && actorRoutes[0]) {
    return {
      move: "track",
      points: actorRoutes[0].points.map(entry => ({ ...entry })),
      source: "legacy_explicit",
      confidence: Math.min(0.82, actorRoutes[0].confidence),
    };
  }
  if (
    /(?:顺时针|逆时针)[^。；]{0,12}(?:环绕|绕拍)|(?:环绕|绕拍)[^。；]{0,12}(?:顺时针|逆时针)/.test(
      text
    )
  ) {
    const clockwise = /顺时针/.test(text) && !/逆时针/.test(text);
    return {
      move: "orbit",
      points: clockwise
        ? [point(0.28, 0.62), point(0.5, 0.38), point(0.72, 0.62)]
        : [point(0.72, 0.62), point(0.5, 0.38), point(0.28, 0.62)],
      source: "legacy_explicit",
      confidence: 0.72,
    };
  }
  if (/(?:上摇|向上摇|抬镜)/.test(text)) {
    return {
      move: "tilt",
      points: [point(0.5, 0.7), point(0.5, 0.28)],
      source: "legacy_explicit",
      confidence: 0.72,
    };
  }
  if (/(?:下摇|向下摇|压镜)/.test(text)) {
    return {
      move: "tilt",
      points: [point(0.5, 0.28), point(0.5, 0.7)],
      source: "legacy_explicit",
      confidence: 0.72,
    };
  }
  if (/(?:升起|上升|升镜|升降机位)/.test(text)) {
    return {
      move: "crane",
      points: [point(0.5, 0.72), point(0.5, 0.24)],
      source: "legacy_explicit",
      confidence: 0.72,
    };
  }
  if (/(?:下降|降镜|俯冲下降)/.test(text)) {
    return {
      move: "crane",
      points: [point(0.5, 0.24), point(0.5, 0.72)],
      source: "legacy_explicit",
      confidence: 0.72,
    };
  }
  if (explicitDirection && /横移|摇摄|摇镜|平摇|侧移/.test(text)) {
    return {
      move: /横移|侧移/.test(text) ? "track" : "pan",
      points: explicitDirection.points,
      source: "legacy_explicit",
      confidence: explicitDirection.confidence,
    };
  }
  return null;
}

function explicitPointFromText(
  text: string
): ManhuaBoardNormalizedPoint | null {
  if (/画面中央|中心位置|正中央/.test(text)) return point(0.5, 0.58);
  if (/画面左侧|左边落点|左侧落点/.test(text)) return point(0.22, 0.62);
  if (/画面右侧|右边落点|右侧落点/.test(text)) return point(0.78, 0.62);
  if (/前景落点|停在前景|落在前景/.test(text)) return point(0.5, 0.78);
  if (/后景落点|停在后景|落在后景/.test(text)) return point(0.5, 0.32);
  return null;
}

function landingKindFromText(text: string): ManhuaBoardLandingKind | null {
  if (/碰撞|撞上|撞击/.test(text)) return "collision";
  if (/交给|递给|交接|接过/.test(text)) return "handoff";
  if (/击中|接触|触碰|接住|抓住|按住/.test(text)) return "contact";
  if (/停下|停住|站定|顿住|急停|停在/.test(text)) return "pause";
  if (/落地|倒地|落在|抵达|结果/.test(text)) return "result";
  return null;
}

function compileLegacyLandingPoints(
  actionText: string,
  actorRoutes: ManhuaBoardActorRoute[],
  castNames: string[],
  propNames: string[]
): ManhuaBoardLandingPoint[] {
  const kind = landingKindFromText(actionText);
  if (!kind) return [];
  const at =
    explicitPointFromText(actionText) ||
    actorRoutes[0]?.points[actorRoutes[0].points.length - 1];
  if (!at) return [];
  const mentioned = [...castNames, ...propNames]
    .filter(name => actionText.includes(name))
    .slice(0, 4);
  const entityIds = mentioned.length
    ? mentioned
    : actorRoutes.map(route => route.entityId).slice(0, 4);
  return [{ landingId: "landing-1", kind, at: { ...at }, entityIds }];
}

function anchorPointFromText(text: string): ManhuaBoardNormalizedPoint | null {
  if (/左侧|靠左|画面左边/.test(text)) return point(0.28, 0.62);
  if (/右侧|靠右|画面右边/.test(text)) return point(0.72, 0.62);
  if (/中央|居中|中心/.test(text)) return point(0.5, 0.6);
  if (/前景/.test(text)) return point(0.5, 0.76);
  if (/后景|远处|深处/.test(text)) return point(0.5, 0.34);
  return null;
}

function compileLegacyAxis(
  actionText: string,
  castNames: string[],
  actorRoutes: ManhuaBoardActorRoute[]
): ManhuaBoardSpatialAxis | null {
  const subjectAnchors: ManhuaBoardSpatialAxis["subjectAnchors"] = [];
  for (const name of castNames) {
    const aroundName =
      actionText.match(
        new RegExp(`${escapeRegExp(name)}[^。；;，,]{0,18}`)
      )?.[0] || "";
    const at = anchorPointFromText(aroundName);
    if (at) subjectAnchors.push({ entityId: name, at });
    if (
      subjectAnchors.length >= MANHUA_BOARD_MOTION_OVERLAY_LIMITS.subjectAnchors
    )
      break;
  }
  if (!subjectAnchors.length && castNames.length === 1) {
    const at = anchorPointFromText(actionText);
    if (at) subjectAnchors.push({ entityId: castNames[0]!, at });
  }
  const first = actorRoutes[0];
  const direction = first ? directionFromExplicitText(actionText) : null;
  const entrance =
    first && /进入|入画|闯入|登场/.test(actionText)
      ? first.points[0]
      : undefined;
  const exit =
    first && /离开|退出|出画|离场/.test(actionText)
      ? first.points[first.points.length - 1]
      : undefined;
  if (
    !subjectAnchors.length &&
    !direction?.screenDirection &&
    !entrance &&
    !exit
  )
    return null;
  return {
    ...(entrance ? { entrance: { ...entrance } } : {}),
    ...(exit ? { exit: { ...exit } } : {}),
    subjectAnchors,
    ...(direction?.screenDirection
      ? { screenDirection: direction.screenDirection }
      : {}),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableRevision(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `overlay-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compileStructuredRoutes(
  structured: ManhuaBoardStructuredMotionInput | null | undefined
): ManhuaBoardActorRoute[] {
  return (structured?.actorRoutes || [])
    .slice(0, MANHUA_BOARD_MOTION_OVERLAY_LIMITS.actorRoutes)
    .map((route, index) => ({
      routeId: `route-${index + 1}`,
      entityId: cleanText(route.entityId).slice(
        0,
        MANHUA_BOARD_MOTION_OVERLAY_LIMITS.idChars
      ),
      entityKind: route.entityKind,
      points: route.points,
      actionPhase: route.actionPhase || "path",
      source: "structured" as const,
      confidence: clampConfidence(route.confidence, 0.92),
    }));
}

function compileStructuredCamera(
  structured: ManhuaBoardStructuredMotionInput | null | undefined
): ManhuaBoardCameraPath | null {
  const camera = structured?.cameraPath;
  if (!camera || camera.move === "fixed") return null;
  return {
    move: camera.move,
    points: camera.points,
    source: "structured",
    confidence: clampConfidence(camera.confidence, 0.92),
  };
}

function compileStructuredLandings(
  structured: ManhuaBoardStructuredMotionInput | null | undefined
): ManhuaBoardLandingPoint[] {
  return (structured?.landingPoints || [])
    .slice(0, MANHUA_BOARD_MOTION_OVERLAY_LIMITS.landingPoints)
    .map((landing, index) => ({
      landingId: `landing-${index + 1}`,
      kind: landing.kind,
      at: landing.at,
      entityIds: (landing.entityIds || [])
        .map(cleanText)
        .filter(Boolean)
        .slice(0, 4),
    }));
}

function hasStructuredSource(
  input: ManhuaBoardStructuredMotionInput | null | undefined
): boolean {
  return Boolean(
    input &&
      ((input.actorRoutes?.length || 0) > 0 ||
        input.cameraPath ||
        input.axis ||
        (input.landingPoints?.length || 0) > 0)
  );
}

/**
 * 轨迹坐标只允许叠在同段导演板或该段首镜静帧上。
 * 整集共用板和别段静帧的布局不对应，不能用来承载当前段坐标。
 */
export function resolveManhuaDirectorOverlayBaseUrl(input: {
  segmentIndex: number;
  segmentBoardUrls?: Readonly<Record<number, string>> | null;
  segmentFirstShotStillUrl?: string | null;
}): string | null {
  const segmentIndex = Math.max(1, Math.floor(Number(input.segmentIndex) || 1));
  const segmentBoardUrl = cleanText(input.segmentBoardUrls?.[segmentIndex]);
  if (segmentBoardUrl) return segmentBoardUrl;
  return cleanText(input.segmentFirstShotStillUrl) || null;
}

/**
 * UI 预览与成片消费共用的段级编译入口。
 *
 * 消费端拿不到底图像素，但已保存 overlay 带有 UI 实测比例；仅在集／段身份匹配时
 * 才复用该比例。旧草稿没有 overlay 或没有同段底图时惰性返回 null，不新增语义。
 */
export function compileManhuaSegmentDirectorBoardOverlay(
  input: CompileManhuaSegmentDirectorBoardOverlayInput
): ManhuaBoardMotionOverlayV1 | null {
  const episodeIndex = Math.max(1, Math.floor(Number(input.episodeIndex) || 1));
  const segmentIndex = Math.max(1, Math.floor(Number(input.segmentIndex) || 1));
  const baseMediaIdentity = resolveManhuaDirectorOverlayBaseUrl({
    segmentIndex,
    segmentBoardUrls: input.segmentBoardUrls,
    segmentFirstShotStillUrl: input.segmentFirstShotStillUrl,
  });
  if (!baseMediaIdentity) return null;

  const existing = parseManhuaBoardMotionOverlay(input.existingOverlay);
  const savedAspectRatio =
    existing?.episodeIndex === episodeIndex && existing.segmentIndex === segmentIndex
      ? existing.baseAspectRatio
      : undefined;
  const baseAspectRatio = input.baseAspectRatio || savedAspectRatio;
  if (!baseAspectRatio) return null;

  const shots = input.shots || [];
  const firstShot = shots[0];
  return compileManhuaDirectorBoardOverlay({
    episodeIndex,
    segmentIndex,
    shotIndex: firstShot?.index,
    baseAspectRatio,
    baseMediaIdentity,
    beat: input.beat,
    shot: shots.length
      ? {
          index: firstShot?.index,
          actionZh: shots.map((shot) => cleanText(shot.actionZh)).filter(Boolean).join("；"),
          cameraZh: shots.map((shot) => cleanText(shot.cameraZh)).filter(Boolean).join("；"),
        }
      : null,
    existingOverlay: input.existingOverlay,
  });
}

/**
 * 同一输入得到同一 overlay。人工调过的同镜数据优先保留；来源或底图比例改变时
 * 仅 needsReview=true，不删除人工点位。
 */
export function compileManhuaDirectorBoardOverlay(
  input: CompileManhuaDirectorBoardOverlayInput
): ManhuaBoardMotionOverlayV1 | null {
  const episodeIndex = Math.max(1, Math.floor(Number(input.episodeIndex) || 1));
  const segmentIndex = Math.max(1, Math.floor(Number(input.segmentIndex) || 1));
  const shotIndex = Math.max(
    1,
    Math.floor(
      Number(input.shotIndex || input.shot?.index) || (segmentIndex - 1) * 3 + 1
    )
  );
  const baseAspectRatio = input.baseAspectRatio || "16:9";
  const beat = input.beat || {};
  const shot = input.shot || {};
  const actionText = [cleanText(shot.actionZh), cleanText(beat.performanceZh)]
    .filter(Boolean)
    .join("；");
  const cameraText = [
    cleanText(shot.cameraZh),
    cleanText(beat.lightingCameraZh),
  ]
    .filter(Boolean)
    .join("；");
  const sourceText = [
    actionText,
    cameraText,
    cleanText(beat.castZh),
    cleanText(beat.wardrobePropZh),
    cleanText(beat.sceneZh),
    stableMediaIdentity(input.baseMediaIdentity),
    JSON.stringify(input.structuredMotion || null),
  ].join("\n");
  const sourceRevision =
    cleanText(input.sourceRevision).slice(
      0,
      MANHUA_BOARD_MOTION_OVERLAY_LIMITS.sourceRevisionChars
    ) || stableRevision(sourceText);

  const existing = parseManhuaBoardMotionOverlay(input.existingOverlay);
  if (
    existing &&
    existing.episodeIndex === episodeIndex &&
    existing.segmentIndex === segmentIndex &&
    existing.shotIndex === shotIndex &&
    existing.sourceRevision === sourceRevision &&
    existing.baseAspectRatio === baseAspectRatio
  ) {
    return existing;
  }
  if (
    existing?.userAdjusted &&
    existing.episodeIndex === episodeIndex &&
    existing.segmentIndex === segmentIndex &&
    existing.shotIndex === shotIndex
  ) {
    return rebindManhuaBoardOverlayBase(existing, {
      sourceRevision,
      baseAspectRatio,
    });
  }

  const hasTextSource = Boolean(
    actionText ||
      cameraText ||
      cleanText(beat.castZh) ||
      cleanText(beat.wardrobePropZh)
  );
  if (!hasTextSource && !hasStructuredSource(input.structuredMotion))
    return null;

  const castNames = splitManhuaCastZhNames(cleanText(beat.castZh));
  const propNames = propNamesFromWardrobe(cleanText(beat.wardrobePropZh));
  const structuredRoutes = compileStructuredRoutes(input.structuredMotion);
  const actorRoutes = structuredRoutes.length
    ? structuredRoutes
    : compileLegacyActorRoutes({ actionText, castNames, propNames });
  const cameraPath =
    input.structuredMotion?.cameraPath !== undefined
      ? compileStructuredCamera(input.structuredMotion)
      : compileCameraPath(cameraText, actorRoutes);
  const axis =
    input.structuredMotion?.axis !== undefined
      ? input.structuredMotion.axis || null
      : compileLegacyAxis(actionText, castNames, actorRoutes);
  const structuredLandings = compileStructuredLandings(input.structuredMotion);
  const landingPoints = structuredLandings.length
    ? structuredLandings
    : compileLegacyLandingPoints(actionText, actorRoutes, castNames, propNames);

  // 统一经过契约解析，坐标越界、坏 ID、路线过量都在这里关闭式清洗并标待复核。
  return parseManhuaBoardMotionOverlay({
    format: MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
    episodeIndex,
    segmentIndex,
    shotIndex,
    imageSpace: "normalized",
    sourceRevision,
    baseAspectRatio,
    actorRoutes,
    cameraPath,
    axis,
    landingPoints,
    userAdjusted: false,
    needsReview: true,
  });
}
