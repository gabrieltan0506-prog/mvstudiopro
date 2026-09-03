/**
 * 漫剧首段 10 秒质检门。
 *
 * 这一层只负责可持久化状态、生成放行判定和提示词的确定性裁切：
 * - 质检按「集号 + 成片引擎」隔离，换引擎不会沿用另一档的批准；
 * - 未批准时只能提交第 1 段、且请求时长必须恰好为 10 秒；
 * - 已生成但尚未审阅时禁止重复提交，避免等待期间重复扣费；
 * - 提示词只删除或缩短越过 10 秒的既有秒轴，不补写不存在的动作。
 */

export const MANHUA_PILOT_GATE_FORMAT = "mv-manhua-pilot-gate-v1" as const;
export const MANHUA_PILOT_GATE_VERSION = 1 as const;
export const MANHUA_PILOT_DURATION_SEC = 10 as const;

export type ManhuaPilotGateStatus =
  | "not_started"
  | "generated"
  | "approved"
  | "rejected";

export type ManhuaPilotGateEntry = {
  format: typeof MANHUA_PILOT_GATE_FORMAT;
  version: typeof MANHUA_PILOT_GATE_VERSION;
  episodeIndex: number;
  videoModel: string;
  durationSec: typeof MANHUA_PILOT_DURATION_SEC;
  status: ManhuaPilotGateStatus;
  /** generated / approved / rejected 必须保留被审阅的小样地址。 */
  outputUrl?: string;
  /** 调用方提供的 ISO 时间；纯函数自身不读取当前时间。 */
  updatedAt?: string;
  /** 拒绝原因只作创作备注，不参与自动判定。 */
  rejectionNoteZh?: string;
};

export type ManhuaPilotGateStore = Record<string, ManhuaPilotGateEntry>;

export type ManhuaPilotGateReason =
  | "approved"
  | "pilot_required"
  | "awaiting_review"
  | "first_segment_only"
  | "pilot_duration_must_be_10";

export type ManhuaPilotGateDecision = {
  allowed: boolean;
  mode: "full" | "pilot" | "blocked";
  effectiveDurationSec: number;
  status: ManhuaPilotGateStatus;
  reason: ManhuaPilotGateReason;
};

type UnknownRecord = Record<string, unknown>;

function recordOf(raw: unknown): UnknownRecord | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as UnknownRecord)
    : null;
}

function positiveEpisodeIndex(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 9999
    ? raw
    : null;
}

function boundedVideoModel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) return "";
  return value;
}

function boundedOptionalString(raw: unknown, maxChars: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value ? value.slice(0, maxChars) : undefined;
}

const PILOT_STATUSES = ["not_started", "generated", "approved", "rejected"] as const;

function pilotStatus(raw: unknown): ManhuaPilotGateStatus | null {
  return typeof raw === "string" && (PILOT_STATUSES as readonly string[]).includes(raw)
    ? (raw as ManhuaPilotGateStatus)
    : null;
}

/** 集号 + 成片引擎的唯一持久化键。 */
export function manhuaPilotGateKey(
  episodeIndex: number,
  videoModel: string,
): string | null {
  const episode = positiveEpisodeIndex(episodeIndex);
  const model = boundedVideoModel(videoModel);
  if (!episode || !model) return null;
  return `episode:${episode}|video:${encodeURIComponent(model)}`;
}

/** 关闭式读取单条；非 10 秒、未知版本或缺审阅产物的记录不会被信任。 */
export function parseManhuaPilotGateEntry(raw: unknown): ManhuaPilotGateEntry | null {
  const value = recordOf(raw);
  if (!value) return null;
  if (value.format !== MANHUA_PILOT_GATE_FORMAT || value.version !== MANHUA_PILOT_GATE_VERSION) {
    return null;
  }
  const episodeIndex = positiveEpisodeIndex(value.episodeIndex);
  const videoModel = boundedVideoModel(value.videoModel);
  const status = pilotStatus(value.status);
  if (!episodeIndex || !videoModel || !status || value.durationSec !== MANHUA_PILOT_DURATION_SEC) {
    return null;
  }
  const outputUrl = boundedOptionalString(value.outputUrl, 2_048);
  if (status !== "not_started" && !outputUrl) return null;

  return {
    format: MANHUA_PILOT_GATE_FORMAT,
    version: MANHUA_PILOT_GATE_VERSION,
    episodeIndex,
    videoModel,
    durationSec: MANHUA_PILOT_DURATION_SEC,
    status,
    ...(outputUrl ? { outputUrl } : {}),
    ...(boundedOptionalString(value.updatedAt, 80)
      ? { updatedAt: boundedOptionalString(value.updatedAt, 80) }
      : {}),
    ...(boundedOptionalString(value.rejectionNoteZh, 240)
      ? { rejectionNoteZh: boundedOptionalString(value.rejectionNoteZh, 240) }
      : {}),
  };
}

/**
 * 草稿恢复入口。忽略外部 map 键，始终按条目里的集号与引擎重新建键，
 * 防止错误键让一档模型误解锁另一档。
 */
export function normalizeManhuaPilotGateStore(raw: unknown): ManhuaPilotGateStore {
  const value = recordOf(raw);
  if (!value) return {};
  const normalized: ManhuaPilotGateStore = {};
  for (const candidate of Object.values(value)) {
    const entry = parseManhuaPilotGateEntry(candidate);
    if (!entry) continue;
    const key = manhuaPilotGateKey(entry.episodeIndex, entry.videoModel);
    if (key) normalized[key] = entry;
  }
  return normalized;
}

export function getManhuaPilotGateEntry(
  store: unknown,
  episodeIndex: number,
  videoModel: string,
): ManhuaPilotGateEntry | null {
  const key = manhuaPilotGateKey(episodeIndex, videoModel);
  if (!key) return null;
  return normalizeManhuaPilotGateStore(store)[key] ?? null;
}

export function createManhuaPilotGateEntry(input: {
  episodeIndex: number;
  videoModel: string;
  status?: "not_started";
  updatedAt?: string;
}): ManhuaPilotGateEntry | null {
  const episodeIndex = positiveEpisodeIndex(input.episodeIndex);
  const videoModel = boundedVideoModel(input.videoModel);
  if (!episodeIndex || !videoModel) return null;
  return {
    format: MANHUA_PILOT_GATE_FORMAT,
    version: MANHUA_PILOT_GATE_VERSION,
    episodeIndex,
    videoModel,
    durationSec: MANHUA_PILOT_DURATION_SEC,
    status: "not_started",
    ...(boundedOptionalString(input.updatedAt, 80)
      ? { updatedAt: boundedOptionalString(input.updatedAt, 80) }
      : {}),
  };
}

function writeManhuaPilotGateEntry(
  store: unknown,
  entry: ManhuaPilotGateEntry,
): ManhuaPilotGateStore {
  const normalized = normalizeManhuaPilotGateStore(store);
  const key = manhuaPilotGateKey(entry.episodeIndex, entry.videoModel);
  return key ? { ...normalized, [key]: entry } : normalized;
}

/** 成片成功回写；产物地址缺失时拒绝把状态伪装成 generated。 */
export function recordManhuaPilotGenerated(
  store: unknown,
  input: {
    episodeIndex: number;
    videoModel: string;
    outputUrl: string;
    updatedAt?: string;
  },
): ManhuaPilotGateStore {
  const base = createManhuaPilotGateEntry(input);
  const outputUrl = boundedOptionalString(input.outputUrl, 2_048);
  if (!base || !outputUrl) return normalizeManhuaPilotGateStore(store);
  return writeManhuaPilotGateEntry(store, {
    ...base,
    status: "generated",
    outputUrl,
  });
}

/** 只有确实生成过的小样可以被用户批准或拒绝。 */
export function reviewManhuaPilot(
  store: unknown,
  input: {
    episodeIndex: number;
    videoModel: string;
    decision: "approve" | "reject";
    rejectionNoteZh?: string;
    updatedAt?: string;
  },
): ManhuaPilotGateStore {
  const normalized = normalizeManhuaPilotGateStore(store);
  const current = getManhuaPilotGateEntry(
    normalized,
    input.episodeIndex,
    input.videoModel,
  );
  if (!current || current.status !== "generated" || !current.outputUrl) return normalized;
  const rejectionNoteZh = boundedOptionalString(input.rejectionNoteZh, 240);
  return writeManhuaPilotGateEntry(normalized, {
    ...current,
    status: input.decision === "approve" ? "approved" : "rejected",
    ...(boundedOptionalString(input.updatedAt, 80)
      ? { updatedAt: boundedOptionalString(input.updatedAt, 80) }
      : {}),
    ...(input.decision === "reject" && rejectionNoteZh ? { rejectionNoteZh } : {}),
  });
}

/**
 * 生成入口的唯一放行判定。approved 只解锁同一集、同一引擎；换引擎重新试片。
 */
export function evaluateManhuaPilotGate(input: {
  store: unknown;
  episodeIndex: number;
  videoModel: string;
  segmentIndex: number;
  requestedDurationSec: number;
}): ManhuaPilotGateDecision {
  const entry = getManhuaPilotGateEntry(
    input.store,
    input.episodeIndex,
    input.videoModel,
  );
  const status = entry?.status ?? "not_started";
  if (status === "approved") {
    return {
      allowed: true,
      mode: "full",
      effectiveDurationSec: input.requestedDurationSec,
      status,
      reason: "approved",
    };
  }
  if (status === "generated") {
    return {
      allowed: false,
      mode: "blocked",
      effectiveDurationSec: MANHUA_PILOT_DURATION_SEC,
      status,
      reason: "awaiting_review",
    };
  }
  if (!Number.isInteger(input.segmentIndex) || input.segmentIndex !== 1) {
    return {
      allowed: false,
      mode: "blocked",
      effectiveDurationSec: MANHUA_PILOT_DURATION_SEC,
      status,
      reason: "first_segment_only",
    };
  }
  if (input.requestedDurationSec !== MANHUA_PILOT_DURATION_SEC) {
    return {
      allowed: false,
      mode: "blocked",
      effectiveDurationSec: MANHUA_PILOT_DURATION_SEC,
      status,
      reason: "pilot_duration_must_be_10",
    };
  }
  return {
    allowed: true,
    mode: "pilot",
    effectiveDurationSec: MANHUA_PILOT_DURATION_SEC,
    status,
    reason: "pilot_required",
  };
}

export type ManhuaPilotPromptCompileResult = {
  prompt: string;
  durationSec: typeof MANHUA_PILOT_DURATION_SEC;
  hadTimeline: boolean;
  keptTimelineCount: number;
  removedTimelineCount: number;
  clampedTimelineCount: number;
};

type TimelineMatch = {
  index: number;
  length: number;
  raw: string;
  startSec: number;
  endSec: number;
  startRaw: string;
  endRaw: string;
};

/**
 * 匹配生成链真实使用的 `0–5s：`，并兼容 `0-5秒:` 与时间戳表的 `0-5 |`。
 * 必须带 s/秒+冒号或竖线分隔，避免把普通数字区间误判成秒轴。
 */
const TIMELINE_RANGE_RE =
  /(\d+(?:\.\d+)?)(\s*[–—-]\s*)(\d+(?:\.\d+)?)(\s*(?:s|秒)\s*[：:]|\s*[|｜]\s*)/gi;

function timelineMatches(line: string): TimelineMatch[] {
  const matches: TimelineMatch[] = [];
  TIMELINE_RANGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TIMELINE_RANGE_RE.exec(line))) {
    const startSec = Number(match[1]);
    const endSec = Number(match[3]);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      continue;
    }
    matches.push({
      index: match.index,
      length: match[0].length,
      raw: match[0],
      startSec,
      endSec,
      startRaw: match[1],
      endRaw: match[3],
    });
  }
  TIMELINE_RANGE_RE.lastIndex = 0;
  return matches;
}

function replaceTimelineEnd(match: TimelineMatch, endSec: number): string {
  const relativeEndIndex = match.raw.lastIndexOf(match.endRaw);
  if (relativeEndIndex < 0) return match.raw;
  const endLabel = Number.isInteger(endSec) ? String(endSec) : String(endSec);
  return `${match.raw.slice(0, relativeEndIndex)}${endLabel}${match.raw.slice(relativeEndIndex + match.endRaw.length)}`;
}

function cropTimelineLine(line: string): {
  line: string;
  hadTimeline: boolean;
  kept: number;
  removed: number;
  clamped: number;
} {
  const matches = timelineMatches(line);
  if (!matches.length) {
    return { line, hadTimeline: false, kept: 0, removed: 0, clamped: 0 };
  }

  const prefix = line.slice(0, matches[0]!.index);
  const keptParts: string[] = [];
  let removed = 0;
  let clamped = 0;
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]!;
    const next = matches[index + 1];
    const bodyStart = current.index + current.length;
    const bodyEnd = next?.index ?? line.length;
    if (current.startSec >= MANHUA_PILOT_DURATION_SEC) {
      removed += 1;
      continue;
    }
    const head =
      current.endSec > MANHUA_PILOT_DURATION_SEC
        ? replaceTimelineEnd(current, MANHUA_PILOT_DURATION_SEC)
        : current.raw;
    if (current.endSec > MANHUA_PILOT_DURATION_SEC) clamped += 1;
    keptParts.push(`${head}${line.slice(bodyStart, bodyEnd)}`);
  }
  return {
    line: `${prefix}${keptParts.join("")}`.trimEnd(),
    hadTimeline: true,
    kept: keptParts.length,
    removed,
    clamped,
  };
}

function replaceDeclaredDuration(text: string): string {
  return text
    .replace(
      /(【第\s*\d+\s*段·(?:约)?)(\d+(?:\.\d+)?)(s】)/g,
      `$1${MANHUA_PILOT_DURATION_SEC}$3`,
    )
    .replace(
      /(目标时长[：:]\s*约?\s*)(\d+(?:\.\d+)?)(\s*秒)/g,
      `$1${MANHUA_PILOT_DURATION_SEC}$3`,
    )
    .replace(
      /(本段一条成片约\s*)(\d+(?:\.\d+)?)(\s*秒)/g,
      `$1${MANHUA_PILOT_DURATION_SEC}$3`,
    );
}

/**
 * 把已有段成片提示词裁成首 10 秒。
 *
 * 非秒轴行原样保留，因此身份锁、参考绑定、导演策略、空间调度及失败恢复说明
 * 不会被误删；函数不生成新的动作、对白或镜头内容。
 */
export function compileManhuaPilotPrompt(
  prompt: string | null | undefined,
): ManhuaPilotPromptCompileResult {
  const lines = replaceDeclaredDuration(String(prompt || "")).split(/\r?\n/);
  const output: string[] = [];
  let hadTimeline = false;
  let keptTimelineCount = 0;
  let removedTimelineCount = 0;
  let clampedTimelineCount = 0;

  for (const line of lines) {
    const cropped = cropTimelineLine(line);
    hadTimeline ||= cropped.hadTimeline;
    keptTimelineCount += cropped.kept;
    removedTimelineCount += cropped.removed;
    clampedTimelineCount += cropped.clamped;
    if (!cropped.hadTimeline || cropped.line.trim()) output.push(cropped.line);
  }

  return {
    prompt: output.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    durationSec: MANHUA_PILOT_DURATION_SEC,
    hadTimeline,
    keptTimelineCount,
    removedTimelineCount,
    clampedTimelineCount,
  };
}
