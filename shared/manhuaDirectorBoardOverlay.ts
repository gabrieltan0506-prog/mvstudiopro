/**
 * 漫剧导演板动作／运镜矢量层契约。
 *
 * - 坐标只保存为 0..1 的归一化值，底图缩放不改数据；
 * - 路线与底图分开保存，不把箭头烧进图片；
 * - 解析旧草稿时关闭式回落：缺失／未知格式返回 null，坏子项丢弃并标待复核；
 * - 人工拖动只改目标点，并留下 userAdjusted，供自动重编译保护。
 */

export const MANHUA_BOARD_MOTION_OVERLAY_FORMAT =
  "mv-manhua-board-motion-overlay-v1" as const;

export const MANHUA_BOARD_MOTION_OVERLAY_LIMITS = {
  actorRoutes: 2,
  routePoints: 8,
  subjectAnchors: 4,
  landingPoints: 4,
  idChars: 80,
  sourceRevisionChars: 120,
} as const;

/** UI 必须统一使用此语义，禁止把摄影机路线画成普通蓝色实线。 */
export const MANHUA_BOARD_MOTION_OVERLAY_VISUAL = {
  actorRoute: {
    stroke: "#ef4444",
    strokeDasharray: "",
    labelZh: "人物／道具路线",
  },
  cameraPath: {
    stroke: "#22d3ee",
    strokeDasharray: "8 6",
    labelZh: "摄影机路线",
  },
} as const;

export type ManhuaBoardAspectRatio = "9:16" | "16:9";
export type ManhuaBoardNormalizedPoint = { x: number; y: number };
export type ManhuaBoardMotionSource =
  | "structured"
  | "legacy_explicit"
  | "user_adjusted";
export type ManhuaBoardActionPhase = "start" | "path" | "contact" | "result";
export type ManhuaBoardCameraMove =
  | "fixed"
  | "push"
  | "pull"
  | "pan"
  | "tilt"
  | "track"
  | "orbit"
  | "crane";
export type ManhuaBoardScreenDirection =
  | "left_to_right"
  | "right_to_left"
  | "toward"
  | "away";
export type ManhuaBoardLandingKind =
  | "contact"
  | "collision"
  | "handoff"
  | "pause"
  | "result";

export type ManhuaBoardActorRoute = {
  routeId: string;
  entityId: string;
  entityKind: "character" | "prop";
  points: ManhuaBoardNormalizedPoint[];
  actionPhase: ManhuaBoardActionPhase;
  source: ManhuaBoardMotionSource;
  confidence: number;
};

export type ManhuaBoardCameraPath = {
  move: ManhuaBoardCameraMove;
  points: ManhuaBoardNormalizedPoint[];
  source: ManhuaBoardMotionSource;
  confidence: number;
};

export type ManhuaBoardSpatialAxis = {
  entrance?: ManhuaBoardNormalizedPoint;
  exit?: ManhuaBoardNormalizedPoint;
  subjectAnchors: Array<{ entityId: string; at: ManhuaBoardNormalizedPoint }>;
  screenDirection?: ManhuaBoardScreenDirection;
};

export type ManhuaBoardLandingPoint = {
  landingId: string;
  kind: ManhuaBoardLandingKind;
  at: ManhuaBoardNormalizedPoint;
  entityIds: string[];
};

export type ManhuaBoardMotionOverlayV1 = {
  format: typeof MANHUA_BOARD_MOTION_OVERLAY_FORMAT;
  episodeIndex: number;
  segmentIndex: number;
  shotIndex: number;
  imageSpace: "normalized";
  sourceRevision: string;
  baseAspectRatio: ManhuaBoardAspectRatio;
  actorRoutes: ManhuaBoardActorRoute[];
  cameraPath: ManhuaBoardCameraPath | null;
  axis: ManhuaBoardSpatialAxis | null;
  landingPoints: ManhuaBoardLandingPoint[];
  userAdjusted: boolean;
  needsReview: boolean;
};

/** 当前生产契约别名；后续升级格式时由这里集中切换。 */
export type ManhuaBoardMotionOverlay = ManhuaBoardMotionOverlayV1;

type UnknownRecord = Record<string, unknown>;

function recordOf(raw: unknown): UnknownRecord | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as UnknownRecord)
    : null;
}

function positiveIndex(raw: unknown): number | null {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > 9999
  )
    return null;
  return raw;
}

function boundedString(raw: unknown, maxChars: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, maxChars) : "";
}

function enumValue<T extends string>(
  raw: unknown,
  allowed: readonly T[]
): T | null {
  return typeof raw === "string" && allowed.includes(raw as T)
    ? (raw as T)
    : null;
}

function confidenceValue(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1
    ? Math.round(raw * 1000) / 1000
    : null;
}

export function isManhuaBoardNormalizedPoint(
  raw: unknown
): raw is ManhuaBoardNormalizedPoint {
  const point = recordOf(raw);
  if (!point) return false;
  const x = point.x;
  const y = point.y;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
  );
}

/** 拖动坐标允许略出画布，落库前钳回 0..1 并压到 4 位小数。 */
export function normalizeManhuaBoardPoint(
  raw: ManhuaBoardNormalizedPoint
): ManhuaBoardNormalizedPoint {
  const normalize = (value: number) =>
    Math.round(
      Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 10_000
    ) / 10_000;
  return { x: normalize(raw.x), y: normalize(raw.y) };
}

function parsePoint(raw: unknown): ManhuaBoardNormalizedPoint | null {
  if (!isManhuaBoardNormalizedPoint(raw)) return null;
  return normalizeManhuaBoardPoint(raw);
}

function parsePoints(raw: unknown): ManhuaBoardNormalizedPoint[] | null {
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.length > MANHUA_BOARD_MOTION_OVERLAY_LIMITS.routePoints
  ) {
    return null;
  }
  const points = raw.map(parsePoint);
  return points.every((point): point is ManhuaBoardNormalizedPoint =>
    Boolean(point)
  )
    ? points
    : null;
}

const MOTION_SOURCES = [
  "structured",
  "legacy_explicit",
  "user_adjusted",
] as const;
const ACTION_PHASES = ["start", "path", "contact", "result"] as const;
const CAMERA_MOVES = [
  "fixed",
  "push",
  "pull",
  "pan",
  "tilt",
  "track",
  "orbit",
  "crane",
] as const;
const SCREEN_DIRECTIONS = [
  "left_to_right",
  "right_to_left",
  "toward",
  "away",
] as const;
const LANDING_KINDS = [
  "contact",
  "collision",
  "handoff",
  "pause",
  "result",
] as const;

function parseActorRoute(raw: unknown): ManhuaBoardActorRoute | null {
  const row = recordOf(raw);
  if (!row) return null;
  const routeId = boundedString(
    row.routeId,
    MANHUA_BOARD_MOTION_OVERLAY_LIMITS.idChars
  );
  const entityId = boundedString(
    row.entityId,
    MANHUA_BOARD_MOTION_OVERLAY_LIMITS.idChars
  );
  const entityKind = enumValue(row.entityKind, ["character", "prop"] as const);
  const points = parsePoints(row.points);
  const actionPhase = enumValue(row.actionPhase, ACTION_PHASES);
  const source = enumValue(row.source, MOTION_SOURCES);
  const confidence = confidenceValue(row.confidence);
  if (
    !routeId ||
    !entityId ||
    !entityKind ||
    !points ||
    !actionPhase ||
    !source ||
    confidence == null
  ) {
    return null;
  }
  return {
    routeId,
    entityId,
    entityKind,
    points,
    actionPhase,
    source,
    confidence,
  };
}

function parseCameraPath(raw: unknown): ManhuaBoardCameraPath | null {
  const row = recordOf(raw);
  if (!row) return null;
  const move = enumValue(row.move, CAMERA_MOVES);
  const points = parsePoints(row.points);
  const source = enumValue(row.source, MOTION_SOURCES);
  const confidence = confidenceValue(row.confidence);
  if (!move || !points || !source || confidence == null) return null;
  return { move, points, source, confidence };
}

function parseAxis(
  raw: unknown
): { axis: ManhuaBoardSpatialAxis; sanitized: boolean } | null {
  const row = recordOf(raw);
  if (!row) return null;
  let sanitized = false;
  const entrance =
    row.entrance == null ? undefined : parsePoint(row.entrance) || undefined;
  const exit = row.exit == null ? undefined : parsePoint(row.exit) || undefined;
  if (row.entrance != null && !entrance) sanitized = true;
  if (row.exit != null && !exit) sanitized = true;
  const rawAnchors = Array.isArray(row.subjectAnchors)
    ? row.subjectAnchors
    : [];
  if (row.subjectAnchors != null && !Array.isArray(row.subjectAnchors)) {
    sanitized = true;
  }
  const subjectAnchors = rawAnchors
    .slice(0, MANHUA_BOARD_MOTION_OVERLAY_LIMITS.subjectAnchors)
    .map(entry => {
      const anchor = recordOf(entry);
      const entityId = boundedString(
        anchor?.entityId,
        MANHUA_BOARD_MOTION_OVERLAY_LIMITS.idChars
      );
      const at = parsePoint(anchor?.at);
      return entityId && at ? { entityId, at } : null;
    })
    .filter(
      (entry): entry is { entityId: string; at: ManhuaBoardNormalizedPoint } =>
        Boolean(entry)
    );
  if (subjectAnchors.length !== rawAnchors.length) sanitized = true;
  const screenDirection =
    row.screenDirection == null
      ? undefined
      : enumValue(row.screenDirection, SCREEN_DIRECTIONS) || undefined;
  if (row.screenDirection != null && !screenDirection) sanitized = true;
  if (!entrance && !exit && !subjectAnchors.length && !screenDirection)
    return null;
  // 带无效子字段的 axis 仍可保留其余有效信息；调用方会把 needsReview 置 true。
  return {
    axis: {
      ...(entrance ? { entrance } : {}),
      ...(exit ? { exit } : {}),
      subjectAnchors,
      ...(screenDirection ? { screenDirection } : {}),
    },
    sanitized,
  };
}

function parseLandingPoint(raw: unknown): ManhuaBoardLandingPoint | null {
  const row = recordOf(raw);
  if (!row) return null;
  const landingId = boundedString(
    row.landingId,
    MANHUA_BOARD_MOTION_OVERLAY_LIMITS.idChars
  );
  const kind = enumValue(row.kind, LANDING_KINDS);
  const at = parsePoint(row.at);
  const entityIds = Array.isArray(row.entityIds)
    ? row.entityIds
        .map(id =>
          boundedString(id, MANHUA_BOARD_MOTION_OVERLAY_LIMITS.idChars)
        )
        .filter(Boolean)
        .slice(0, 4)
    : [];
  if (!landingId || !kind || !at) return null;
  return { landingId, kind, at, entityIds };
}

/**
 * 草稿／接口安全解析：未知格式不迁移；坏路线不会拖垮整张导演板，
 * 只丢弃坏子项并强制 needsReview=true。
 */
export function parseManhuaBoardMotionOverlay(
  raw: unknown
): ManhuaBoardMotionOverlayV1 | null {
  const input = recordOf(raw);
  if (!input || input.format !== MANHUA_BOARD_MOTION_OVERLAY_FORMAT)
    return null;
  const episodeIndex = positiveIndex(input.episodeIndex);
  const segmentIndex = positiveIndex(input.segmentIndex);
  const shotIndex = positiveIndex(input.shotIndex);
  const sourceRevision = boundedString(
    input.sourceRevision,
    MANHUA_BOARD_MOTION_OVERLAY_LIMITS.sourceRevisionChars
  );
  const baseAspectRatio = enumValue(input.baseAspectRatio, [
    "9:16",
    "16:9",
  ] as const);
  if (
    !episodeIndex ||
    !segmentIndex ||
    !shotIndex ||
    input.imageSpace !== "normalized" ||
    !sourceRevision ||
    !baseAspectRatio
  ) {
    return null;
  }

  let sanitized = false;
  const rawRoutes = Array.isArray(input.actorRoutes) ? input.actorRoutes : [];
  if (input.actorRoutes != null && !Array.isArray(input.actorRoutes))
    sanitized = true;
  const seenRouteIds = new Set<string>();
  const actorRoutes: ManhuaBoardActorRoute[] = [];
  for (const rawRoute of rawRoutes) {
    const route = parseActorRoute(rawRoute);
    if (
      !route ||
      seenRouteIds.has(route.routeId) ||
      actorRoutes.length >= MANHUA_BOARD_MOTION_OVERLAY_LIMITS.actorRoutes
    ) {
      sanitized = true;
      continue;
    }
    seenRouteIds.add(route.routeId);
    actorRoutes.push(route);
  }

  const cameraPath =
    input.cameraPath == null ? null : parseCameraPath(input.cameraPath);
  if (input.cameraPath != null && !cameraPath) sanitized = true;

  const parsedAxis = input.axis == null ? null : parseAxis(input.axis);
  if (input.axis != null && !parsedAxis) sanitized = true;
  const axisSanitized = parsedAxis?.sanitized === true;
  const axis = parsedAxis?.axis || null;

  const rawLandings = Array.isArray(input.landingPoints)
    ? input.landingPoints
    : [];
  if (input.landingPoints != null && !Array.isArray(input.landingPoints))
    sanitized = true;
  const seenLandingIds = new Set<string>();
  const landingPoints: ManhuaBoardLandingPoint[] = [];
  for (const rawLanding of rawLandings) {
    const landing = parseLandingPoint(rawLanding);
    if (
      !landing ||
      seenLandingIds.has(landing.landingId) ||
      landingPoints.length >= MANHUA_BOARD_MOTION_OVERLAY_LIMITS.landingPoints
    ) {
      sanitized = true;
      continue;
    }
    seenLandingIds.add(landing.landingId);
    landingPoints.push(landing);
  }

  return {
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
    userAdjusted: input.userAdjusted === true,
    needsReview: input.needsReview !== false || sanitized || axisSanitized,
  };
}

export type ManhuaBoardOverlayPointTarget =
  | { kind: "actor_route"; routeId: string; pointIndex: number }
  | { kind: "camera_path"; pointIndex: number }
  | { kind: "axis_entrance" }
  | { kind: "axis_exit" }
  | { kind: "axis_anchor"; entityId: string }
  | { kind: "landing"; landingId: string };

/** 只调整命中的端点／中继点，不命中时返回原始安全副本。 */
export function adjustManhuaBoardOverlayPoint(
  raw: unknown,
  target: ManhuaBoardOverlayPointTarget,
  nextPoint: ManhuaBoardNormalizedPoint
): ManhuaBoardMotionOverlayV1 | null {
  const parsed = parseManhuaBoardMotionOverlay(raw);
  if (!parsed) return null;
  if (!Number.isFinite(nextPoint?.x) || !Number.isFinite(nextPoint?.y)) {
    return parsed;
  }
  const point = normalizeManhuaBoardPoint(nextPoint);
  let changed = false;
  const actorRoutes = parsed.actorRoutes.map(route => {
    if (target.kind !== "actor_route" || route.routeId !== target.routeId)
      return route;
    const pointIndex = Math.floor(target.pointIndex);
    if (pointIndex < 0 || pointIndex >= route.points.length) return route;
    const points = route.points.map((entry, index) =>
      index === pointIndex ? point : entry
    );
    changed = true;
    return {
      ...route,
      points,
      source: "user_adjusted" as const,
      confidence: 1,
    };
  });
  let cameraPath = parsed.cameraPath;
  if (target.kind === "camera_path" && cameraPath) {
    const pointIndex = Math.floor(target.pointIndex);
    if (pointIndex >= 0 && pointIndex < cameraPath.points.length) {
      cameraPath = {
        ...cameraPath,
        points: cameraPath.points.map((entry, index) =>
          index === pointIndex ? point : entry
        ),
        source: "user_adjusted",
        confidence: 1,
      };
      changed = true;
    }
  }
  let axis = parsed.axis;
  if (axis && target.kind === "axis_entrance") {
    axis = { ...axis, entrance: point };
    changed = true;
  } else if (axis && target.kind === "axis_exit") {
    axis = { ...axis, exit: point };
    changed = true;
  } else if (axis && target.kind === "axis_anchor") {
    const subjectAnchors = axis.subjectAnchors.map(anchor => {
      if (anchor.entityId !== target.entityId) return anchor;
      changed = true;
      return { ...anchor, at: point };
    });
    axis = { ...axis, subjectAnchors };
  }
  const landingPoints = parsed.landingPoints.map(landing => {
    if (target.kind !== "landing" || landing.landingId !== target.landingId)
      return landing;
    changed = true;
    return { ...landing, at: point };
  });
  return changed
    ? {
        ...parsed,
        actorRoutes,
        cameraPath,
        axis,
        landingPoints,
        userAdjusted: true,
      }
    : parsed;
}

export function confirmManhuaBoardOverlayReview(
  raw: unknown
): ManhuaBoardMotionOverlayV1 | null {
  const parsed = parseManhuaBoardMotionOverlay(raw);
  return parsed ? { ...parsed, needsReview: false } : null;
}

/** 换底图不删路线；宽高比或内容修订变化时只标记待校准。 */
export function rebindManhuaBoardOverlayBase(
  raw: unknown,
  next: { sourceRevision: string; baseAspectRatio: ManhuaBoardAspectRatio }
): ManhuaBoardMotionOverlayV1 | null {
  const parsed = parseManhuaBoardMotionOverlay(raw);
  const sourceRevision = boundedString(
    next.sourceRevision,
    MANHUA_BOARD_MOTION_OVERLAY_LIMITS.sourceRevisionChars
  );
  if (!parsed || !sourceRevision) return null;
  const changed =
    parsed.sourceRevision !== sourceRevision ||
    parsed.baseAspectRatio !== next.baseAspectRatio;
  return {
    ...parsed,
    sourceRevision,
    baseAspectRatio: next.baseAspectRatio,
    needsReview: parsed.needsReview || changed,
  };
}

const CAMERA_MOVE_LABEL_ZH: Record<ManhuaBoardCameraMove, string> = {
  fixed: "固定机位",
  push: "推近",
  pull: "拉远",
  pan: "横摇",
  tilt: "俯仰摇镜",
  track: "跟移",
  orbit: "环绕",
  crane: "升降",
};

const LANDING_KIND_LABEL_ZH: Record<ManhuaBoardLandingKind, string> = {
  contact: "接触",
  collision: "碰撞",
  handoff: "交接",
  pause: "停顿",
  result: "结果",
};

function routeDirectionZh(points: ManhuaBoardNormalizedPoint[]): string {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return "";
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= 0.08) {
    return dx > 0 ? "自画面左向右" : "自画面右向左";
  }
  if (Math.abs(dy) >= 0.08) return dy > 0 ? "由后景趋近前景" : "由前景退向后景";
  return "原位短幅移动";
}

/**
 * 已确认的矢量层才进入成片提示词；待复核的自动坐标只显示在 UI，不驱动付费生成。
 * 坐标本身不外泄给模型，转成可读的方向／机位／落点短句。
 */
export function formatManhuaBoardMotionOverlayPromptZh(raw: unknown): string {
  const overlay = parseManhuaBoardMotionOverlay(raw);
  if (!overlay || overlay.needsReview) return "";
  const actors = overlay.actorRoutes.map((route) => {
    const kind = route.entityKind === "prop" ? "道具" : "人物";
    return `${kind}${route.entityId}${routeDirectionZh(route.points)}`;
  });
  const camera = overlay.cameraPath
    ? `摄影机${CAMERA_MOVE_LABEL_ZH[overlay.cameraPath.move]}${routeDirectionZh(overlay.cameraPath.points)}`
    : "";
  const axis = overlay.axis?.screenDirection
    ? `方向轴${
        overlay.axis.screenDirection === "left_to_right"
          ? "左至右"
          : overlay.axis.screenDirection === "right_to_left"
            ? "右至左"
            : overlay.axis.screenDirection === "toward"
              ? "向镜头"
              : "离镜头"
      }`
    : "";
  const landing = overlay.landingPoints[0]
    ? `关键落点=${LANDING_KIND_LABEL_ZH[overlay.landingPoints[0].kind]}`
    : "";
  const body = [...actors, camera, axis, landing].filter(Boolean).join("；");
  return body ? `【空间调度】${body}` : "";
}
