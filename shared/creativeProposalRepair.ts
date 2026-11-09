import { ZodError, type ZodType } from "zod";

/**
 * 创作方案（GLM 初稿 / Astra 修订 / 听音证据）在 zod 校验前的确定性修复。
 * 只动形状与时间边界，不编造 heardZh、emotion 等内容；每一处修复都返回记录，由调用方落永久证据。
 * 2026-11-09 线上两例：GLM 在 sections 末尾附加 {startSec:0,endSec:0,"占位避免空段"}；
 * 另一例把 uncertaintiesZh 写成 uncertainties / 字符串。这两种坏法都在这里被确定性修掉。
 */

export type ShapeFix = {
  path: string;
  code: string;
  before: unknown;
  after: unknown;
  reasonZh: string;
};

export type MediaSectionFix = {
  index: number;
  field: "startSec" | "endSec" | "section";
  before: unknown;
  after: unknown;
  reasonZh: string;
};

type PathPart = string | number;

const FIELD_NAMES_ZH: Record<string, string> = {
  sections: "听音分段",
  startSec: "开始时间",
  endSec: "结束时间",
  labelZh: "段落名称",
  heardZh: "听到的内容",
  emotion: "情绪",
  uncertaintiesZh: "不确定项",
  summaryZh: "总结",
  sourceKey: "来源版本",
  concepts: "方案",
  plan: "计划",
  shots: "镜头",
  visualPrompt: "画面提示",
  cameraPrompt: "镜头提示",
  lyricQuote: "歌词引用",
  referenceIndices: "人物参考",
  sourceClip: "素材切片",
  methods: "方法",
  limitationsZh: "局限",
  evidencePaths: "证据路径",
  brief: "提示词",
  style: "风格",
  review: "审阅",
  proposal: "方案",
  changesZh: "修改说明",
  emotionalArc: "情绪弧线",
  kind: "类型",
};

function formatPathZh(path: ReadonlyArray<PropertyKey>): string {
  if (!path.length) return "方案根对象";
  const parts: string[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const part = path[i];
    if (typeof part === "number") {
      const owner = i > 0 ? String(path[i - 1]) : "";
      const unit = owner === "sections" ? "段" : owner === "shots" ? "镜" : owner === "concepts" || owner === "methods" ? "个" : "项";
      parts.push(`第 ${part + 1} ${unit}`);
      continue;
    }
    const key = String(part);
    parts.push(FIELD_NAMES_ZH[key] || key);
  }
  return parts.join("");
}

function describeIssueZh(issue: ZodError["issues"][number]): string {
  const where = formatPathZh(issue.path);
  const code = issue.code;
  const extra = issue as { expected?: unknown; keys?: string[]; minimum?: unknown; maximum?: unknown; inclusive?: boolean; origin?: string };
  if (code === "invalid_type") {
    const received = /received (\w+)/.exec(issue.message)?.[1];
    const expectedZh = extra.expected === "array" ? "数组" : extra.expected === "number" ? "数字" : extra.expected === "string" ? "文本" : extra.expected === "object" ? "对象" : String(extra.expected ?? "指定类型");
    if (received === "undefined") return `${where}缺失，应为${expectedZh}`;
    return `${where}类型不正确，应为${expectedZh}`;
  }
  if (code === "too_small") {
    if (extra.origin === "number") return `${where}无效：应${extra.inclusive ? "不低于" : "大于"} ${String(extra.minimum)}`;
    if (extra.origin === "array") return `${where}数量不足：至少 ${String(extra.minimum)} 项`;
    if (extra.origin === "string") return `${where}为空`;
    return `${where}低于允许范围`;
  }
  if (code === "too_big") {
    if (extra.origin === "array") return `${where}数量过多：至多 ${String(extra.maximum)} 项`;
    return `${where}超过允许范围`;
  }
  if (code === "unrecognized_keys") return `${where}包含未支持字段 ${(extra.keys || []).join("、")}`;
  if (code === "invalid_value") return `${where}取值不受支持`;
  if (code === "invalid_format") return `${where}格式不正确`;
  if (code === "custom") return `${where}：${issue.message || "未通过检查"}`;
  return `${where}${issue.message || "格式不符合要求"}`;
}

/** 把 zod issues 翻成可读中文，供用户可见错误与友好映射使用；最多列 4 条。 */
export function describeZodIssuesZh(issues: ReadonlyArray<ZodError["issues"][number]>): string {
  const rows = issues.slice(0, 4).map(describeIssueZh);
  const rest = issues.length > 4 ? `等 ${issues.length} 处` : "";
  return rows.join("；") + rest;
}

/** 识别日志/lastErr 中的 zod issues JSON 字符串（ZodError.message 就是这种数组）。 */
export function describeZodIssueTextZh(text: string): string | undefined {
  const trimmed = String(text || "").trim();
  if (!/^\[\s*\{/.test(trimmed) || !/"code"\s*:/.test(trimmed)) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.length || parsed.some(row => !row || typeof row !== "object" || typeof row.code !== "string")) return undefined;
    return describeZodIssuesZh(parsed.map(row => ({ ...row, path: Array.isArray(row.path) ? row.path : [] })));
  } catch {
    return undefined;
  }
}

/** 任意校验错误转中文摘要：ZodError 走 issues；普通 Error 保留原中文信息。 */
export function describeValidationErrorZh(error: unknown): string {
  if (error instanceof ZodError) return describeZodIssuesZh(error.issues);
  const message = error instanceof Error ? error.message : String(error);
  return describeZodIssueTextZh(message) || message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getAt(root: unknown, path: ReadonlyArray<PathPart>): unknown {
  let cursor: unknown = root;
  for (const part of path) {
    if (Array.isArray(cursor) && typeof part === "number") cursor = cursor[part];
    else if (isRecord(cursor)) cursor = cursor[String(part)];
    else return undefined;
  }
  return cursor;
}

function setAt(root: unknown, path: ReadonlyArray<PathPart>, value: unknown): boolean {
  if (!path.length) return false;
  const parent = getAt(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === "number") {
    parent[last] = value;
    return true;
  }
  if (isRecord(parent)) {
    parent[String(last)] = value;
    return true;
  }
  return false;
}

function pathKey(path: ReadonlyArray<PropertyKey>): string {
  return path.map(p => (typeof p === "number" ? `[${p}]` : String(p))).join(".") || "$";
}

const MAX_SHAPE_ROUNDS = 6;
/** 只有这些键缺失时才补 ""：都是合同里允许为空的文本，不含 visualPrompt/heardZh 等必须有内容的字段。 */
const EMPTY_STRING_DEFAULT_KEYS = new Set(["lyricQuote"]);

/**
 * 以 zod issues 驱动的确定性形状修复：
 * - 期望数组却给了字符串 → 包成单元素数组；缺失/null → 空数组
 * - 期望数字却给了数字字符串 → 转数字
 * - 期望字符串却给了数字/布尔 → 转字符串
 * - strict 对象里出现未知键：若 `${key}Zh` 不存在则改名（uncertainties → uncertaintiesZh），否则删除
 * 不改任何已存在且类型正确的内容。修复后仍不通过时把剩余 issues 一并返回，由调用方决定重试或抛错。
 */
export function repairJsonShape(value: unknown, schema: ZodType): { value: unknown; fixes: ShapeFix[]; issues: ZodError["issues"] | null } {
  const fixes: ShapeFix[] = [];
  let current: unknown = typeof value === "string" ? value : structuredClone(value);
  for (let round = 0; round < MAX_SHAPE_ROUNDS; round += 1) {
    const result = schema.safeParse(current);
    if (result.success) return { value: current, fixes, issues: null };
    let applied = 0;
    // 先改名未知键（uncertainties → uncertaintiesZh），再补缺失；否则缺失数组会被先补成 []，别名键随后被当重复键删掉。
    const ordered = [...result.error.issues].sort((a, b) => Number(b.code === "unrecognized_keys") - Number(a.code === "unrecognized_keys"));
    // 1109 DeepSeek 一例：每个非素材镜头都塞了 sourceClip:{}，strict 合同对空对象报一串「缺失」。
    // 父对象是空对象 {} 且删掉后该路径不再有任何 issue（说明合同里是可选字段）→ 整个删除；否则还原，交给下面逐字段处理。
    const emptyParents = new Set<string>();
    for (const issue of ordered) {
      if (issue.code !== "invalid_type" || issue.path.length < 2) continue;
      const parentPath = issue.path.slice(0, -1).filter((p): p is PathPart => typeof p === "string" || typeof p === "number");
      const key = pathKey(parentPath);
      if (emptyParents.has(key)) continue;
      const parent = getAt(current, parentPath);
      if (!isRecord(parent) || Object.keys(parent).length) continue;
      const owner = getAt(current, parentPath.slice(0, -1));
      const last = parentPath[parentPath.length - 1];
      if (!isRecord(owner) || typeof last !== "string") continue;
      emptyParents.add(key);
      delete owner[last];
      const retry = schema.safeParse(current);
      // 必填字段删掉后 zod 会在同一路径报「缺失」；可选字段删掉后该路径不再有 issue。
      const stillThere = !retry.success && retry.error.issues.some(row => pathKey(row.path.filter((p): p is PathPart => typeof p === "string" || typeof p === "number")) === key);
      if (stillThere) {
        owner[last] = parent;
        continue;
      }
      fixes.push({ path: key, code: "empty_object", before: {}, after: undefined, reasonZh: "删除空对象占位字段（合同为可选）" });
      applied += 1;
    }
    if (applied) continue;
    for (const issue of ordered) {
      const path = issue.path.filter((p): p is PathPart => typeof p === "string" || typeof p === "number");
      const code = issue.code;
      if (code === "invalid_type") {
        const expected = (issue as { expected?: string }).expected;
        const before = getAt(current, path);
        let after: unknown;
        let reasonZh = "";
        if (expected === "array") {
          if (typeof before === "string") {
            after = [before];
            reasonZh = "字符串包成单元素数组";
          } else if (before === undefined || before === null) {
            after = [];
            reasonZh = "缺失数组补为空数组";
          } else if (isRecord(before)) {
            after = Object.values(before);
            reasonZh = "对象取值转数组";
          } else continue;
        } else if (expected === "number") {
          if (typeof before === "string" && before.trim() && Number.isFinite(Number(before))) {
            after = Number(before);
            reasonZh = "数字字符串转数字";
          } else continue;
        } else if (expected === "string") {
          if (typeof before === "number" || typeof before === "boolean") {
            after = String(before);
            reasonZh = "数字/布尔转字符串";
          } else if ((before === undefined || before === null) && EMPTY_STRING_DEFAULT_KEYS.has(String(path[path.length - 1]))) {
            // lyricQuote 语义上允许为空（无歌词/非唱段）；1109 第四次重跑 GLM 整份省略该键，72 处 invalid_type。
            after = "";
            reasonZh = "缺失的可空文本补为空字符串";
          } else continue;
        } else continue;
        if (!setAt(current, path, after)) continue;
        fixes.push({ path: pathKey(path), code, before, after, reasonZh });
        applied += 1;
        continue;
      }
      if (code === "unrecognized_keys") {
        const parent = getAt(current, path);
        if (!isRecord(parent)) continue;
        for (const key of (issue as { keys?: string[] }).keys || []) {
          if (!(key in parent)) continue;
          const renamed = `${key}Zh`;
          const before = parent[key];
          if (before === undefined) {
            // JSON 不会带 undefined 值；这是进程内对象残留的键，直接去掉，不算一次修复。
            delete parent[key];
            applied += 1;
            continue;
          }
          if (!key.endsWith("Zh") && !(renamed in parent)) {
            parent[renamed] = before;
            delete parent[key];
            fixes.push({ path: pathKey([...path, key]), code, before, after: { [renamed]: before }, reasonZh: `未知字段改名为 ${renamed}` });
          } else {
            delete parent[key];
            fixes.push({ path: pathKey([...path, key]), code, before, after: undefined, reasonZh: "删除未支持字段" });
          }
          applied += 1;
        }
        continue;
      }
    }
    if (!applied) return { value: current, fixes, issues: result.error.issues };
  }
  const final = schema.safeParse(current);
  return { value: current, fixes, issues: final.success ? null : final.error.issues };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return NaN;
}

/**
 * 听音分段 / 方案 sections 的时间边界归一化（校验前，确定性）：
 * - 数字字符串转数字；缺失 endSec 用下一段起点或歌曲时长补
 * - 零长或倒序段落（endSec ≤ startSec）整条丢弃，其时间范围由相邻段落吸收
 * - 首段 startSec 归 0；后续段 startSec 对齐上一段 endSec；末段 endSec 补到歌曲时长
 * 只动 startSec/endSec 与段落取舍，不触碰 labelZh/heardZh/emotion。
 * durationSec 非有限正数或 value 没有非空 sections 数组时原样返回。
 */
export function normalizeMediaSections(value: unknown, durationSec: number | undefined, tolerance = 0.03): { value: unknown; fixes: MediaSectionFix[] } {
  const fixes: MediaSectionFix[] = [];
  if (!isRecord(value) || !Array.isArray(value.sections) || !value.sections.length) return { value, fixes };
  if (!Number.isFinite(durationSec) || (durationSec as number) <= 0) return { value, fixes };
  const duration = durationSec as number;
  const raw = value.sections.map(section => (isRecord(section) ? { ...section } : section));
  if (raw.some(section => !isRecord(section))) return { value, fixes };
  const rows = raw as Array<Record<string, unknown>>;
  type Timed = { index: number; section: Record<string, unknown>; startSec: number; endSec: number };
  const timed: Timed[] = rows.map((section, index) => ({ index, section, startSec: toNumber(section.startSec), endSec: toNumber(section.endSec) }));
  for (const row of timed) {
    if (typeof row.section.startSec === "string" && Number.isFinite(row.startSec)) fixes.push({ index: row.index, field: "startSec", before: row.section.startSec, after: row.startSec, reasonZh: "数字字符串转数字" });
    if (typeof row.section.endSec === "string" && Number.isFinite(row.endSec)) fixes.push({ index: row.index, field: "endSec", before: row.section.endSec, after: row.endSec, reasonZh: "数字字符串转数字" });
  }
  // 结束时间缺失、为 0 或不晚于开始时间：只在该段开始时间衔接上一段终点（首段≈0）时才补——中间段取下一段起点，末段取歌曲时长；
  // 开始时间不衔接的（如追加在末尾的 {0,0,占位}）不是真实段落，留给下一步整条丢弃，避免把占位段扶正成真实段落。
  for (let i = 0; i < timed.length; i += 1) {
    const row = timed[i];
    if (!Number.isFinite(row.startSec)) continue;
    if (Number.isFinite(row.endSec) && row.endSec > row.startSec) continue;
    const prev = timed[i - 1];
    const prevEnd = i === 0 ? 0 : prev && Number.isFinite(prev.endSec) && prev.endSec > prev.startSec ? prev.endSec : NaN;
    if (!Number.isFinite(prevEnd) || Math.abs(row.startSec - prevEnd) > tolerance) continue;
    const next = timed[i + 1];
    const candidate = next && Number.isFinite(next.startSec) && next.startSec > row.startSec ? next.startSec : i === timed.length - 1 && duration > row.startSec ? duration : NaN;
    if (!Number.isFinite(candidate)) continue;
    const invalid = Number.isFinite(row.endSec) ? "无效结束时间" : "缺失结束时间";
    fixes.push({ index: row.index, field: "endSec", before: row.section.endSec, after: candidate, reasonZh: next && candidate === next.startSec ? `${invalid}补为下一段起点` : `${invalid}补为歌曲时长` });
    row.endSec = candidate;
  }
  const kept: Timed[] = [];
  let cursor = 0;
  for (const row of timed) {
    if (!Number.isFinite(row.startSec)) {
      fixes.push({ index: row.index, field: "startSec", before: row.section.startSec, after: cursor, reasonZh: "缺失开始时间补为上一段终点" });
      row.startSec = cursor;
    }
    if (!Number.isFinite(row.endSec) || row.endSec <= row.startSec) {
      fixes.push({ index: row.index, field: "section", before: { startSec: row.section.startSec, endSec: row.section.endSec, labelZh: row.section.labelZh }, after: undefined, reasonZh: "零长或倒序段落，已并入相邻段落" });
      continue;
    }
    const expectedStart = kept.length ? cursor : 0;
    if (Math.abs(row.startSec - expectedStart) > tolerance) {
      fixes.push({ index: row.index, field: "startSec", before: row.startSec, after: expectedStart, reasonZh: kept.length ? "开始时间对齐上一段结束时间" : "首段开始时间归 0" });
      row.startSec = expectedStart;
      if (row.endSec <= row.startSec) {
        fixes.push({ index: row.index, field: "section", before: { startSec: row.section.startSec, endSec: row.section.endSec, labelZh: row.section.labelZh }, after: undefined, reasonZh: "对齐后无时间范围，已并入相邻段落" });
        continue;
      }
    }
    kept.push(row);
    cursor = row.endSec;
  }
  while (kept.length) {
    const last = kept[kept.length - 1];
    if (Math.abs(last.endSec - duration) > tolerance) {
      fixes.push({ index: last.index, field: "endSec", before: last.endSec, after: duration, reasonZh: last.endSec < duration ? "末段结束时间补到歌曲时长" : "末段结束时间截到歌曲时长" });
      last.endSec = duration;
    }
    if (last.endSec <= last.startSec) {
      fixes.push({ index: last.index, field: "section", before: { startSec: last.section.startSec, endSec: last.section.endSec, labelZh: last.section.labelZh }, after: undefined, reasonZh: "末段起点不早于歌曲时长，已并入相邻段落" });
      kept.pop();
      continue;
    }
    break;
  }
  if (!kept.length) return { value, fixes: [] };
  if (!fixes.length) return { value, fixes };
  return {
    value: { ...value, sections: kept.map(row => ({ ...row.section, startSec: row.startSec, endSec: row.endSec })) },
    fixes,
  };
}

export type ShotFix = {
  concept: number;
  shot: number;
  id: unknown;
  action: "split" | "merge";
  before: { startSec: number; endSec: number };
  after: Array<{ id: string; startSec: number; endSec: number }>;
  reasonZh: string;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 分镜时长确定性修复（校验前，MV 方案四个 concepts 全部处理）：
 * - 任一 shot 时长 > maxSec → 等分为 ceil(len/maxSec) 段，边界连续；kind/lyricQuote/referenceIndices 沿用，
 *   visualPrompt/cameraPrompt 沿用并从第二段起加「（续）」，footage 的 sourceStartSec 顺延；id 加 -2/-3 后缀保证唯一
 * - 时长 < minSec 的镜头并入前一镜（首镜并入后一镜），不保留其文案
 * 不改任何镜头的画面内容；2026-11-09 第四次重跑：GLM 两次 compose 都不肯把 15.5–17.5s 的镜头切短。
 */
export function normalizeShotDurations(value: unknown, maxSec = 15, minSec = 0.5): { value: unknown; fixes: ShotFix[] } {
  const fixes: ShotFix[] = [];
  if (!isRecord(value) || !Array.isArray(value.concepts)) return { value, fixes };
  let changed = false;
  const concepts = value.concepts.map((concept, conceptIndex) => {
    if (!isRecord(concept) || !isRecord(concept.plan) || !Array.isArray(concept.plan.shots)) return concept;
    const shots = concept.plan.shots;
    if (shots.some(shot => !isRecord(shot) || !Number.isFinite(toNumber(shot.startSec)) || !Number.isFinite(toNumber(shot.endSec)))) return concept;
    type TimedShot = Record<string, unknown> & { startSec: number; endSec: number };
    const rows: TimedShot[] = (shots as Array<Record<string, unknown>>).map(shot => ({ ...shot, startSec: toNumber(shot.startSec), endSec: toNumber(shot.endSec) }));
    // 先并短镜，再拆长镜：并入后变长的镜头也要受 maxSec 约束。
    const merged: TimedShot[] = [];
    rows.forEach((shot, index) => {
      const len = shot.endSec - shot.startSec;
      if (len + 1e-9 >= minSec) {
        merged.push(shot);
        return;
      }
      if (merged.length) {
        const prev = merged[merged.length - 1];
        const before = { startSec: shot.startSec, endSec: shot.endSec };
        prev.endSec = Math.max(prev.endSec, shot.endSec);
        fixes.push({ concept: conceptIndex, shot: index, id: shot.id, action: "merge", before, after: [{ id: String(prev.id), startSec: prev.startSec, endSec: prev.endSec }], reasonZh: `镜头不足 ${minSec} 秒，并入前一镜` });
      } else if (rows[index + 1]) {
        const next = rows[index + 1];
        const before = { startSec: shot.startSec, endSec: shot.endSec };
        next.startSec = Math.min(next.startSec, shot.startSec);
        fixes.push({ concept: conceptIndex, shot: index, id: shot.id, action: "merge", before, after: [{ id: String(next.id), startSec: next.startSec, endSec: next.endSec }], reasonZh: `首镜不足 ${minSec} 秒，并入后一镜` });
      } else merged.push(shot);
    });
    const ids = new Set(merged.map(shot => String(shot.id)));
    const out: Array<Record<string, unknown>> = [];
    merged.forEach((shot, index) => {
      const len = shot.endSec - shot.startSec;
      if (len <= maxSec + 1e-9) {
        out.push(shot);
        return;
      }
      const parts = Math.ceil(len / maxSec - 1e-9);
      const pieces: Array<{ id: string; startSec: number; endSec: number }> = [];
      for (let k = 0; k < parts; k += 1) {
        const startSec = k === 0 ? shot.startSec : round3(shot.startSec + (len * k) / parts);
        const endSec = k === parts - 1 ? shot.endSec : round3(shot.startSec + (len * (k + 1)) / parts);
        let id = k === 0 ? String(shot.id) : `${String(shot.id)}-${k + 1}`;
        while (k > 0 && ids.has(id)) id = `${id}x`;
        ids.add(id);
        const cont = k > 0 ? "（续）" : "";
        const piece: Record<string, unknown> = {
          ...shot,
          id,
          startSec,
          endSec,
          visualPrompt: typeof shot.visualPrompt === "string" ? shot.visualPrompt + cont : shot.visualPrompt,
          cameraPrompt: typeof shot.cameraPrompt === "string" ? shot.cameraPrompt + cont : shot.cameraPrompt,
        };
        if (k > 0 && isRecord(shot.sourceClip) && Number.isFinite(toNumber(shot.sourceClip.sourceStartSec)))
          piece.sourceClip = { ...shot.sourceClip, sourceStartSec: round3(toNumber(shot.sourceClip.sourceStartSec) + (startSec - shot.startSec)) };
        pieces.push({ id, startSec, endSec });
        out.push(piece);
      }
      fixes.push({ concept: conceptIndex, shot: index, id: shot.id, action: "split", before: { startSec: shot.startSec, endSec: shot.endSec }, after: pieces, reasonZh: `镜头 ${round3(len)} 秒超过 ${maxSec} 秒，等分为 ${parts} 镜` });
    });
    if (out.length === rows.length && fixes.every(f => f.concept !== conceptIndex)) return concept;
    changed = true;
    return { ...concept, plan: { ...concept.plan, shots: out } };
  });
  if (!changed) return { value, fixes: [] };
  return { value: { ...value, concepts }, fixes };
}
