/**
 * Stage2 選題入庫 + 封面生圖前從 DB 解析主句 / context（與前端 local state 解耦）。
 * 封面路径强制走快照 + 服务端文案优化，不提供「未过算法的客户端文案」后备。
 */
import { desc, eq } from "drizzle-orm";
import * as db from "../db";
import { platformStrategicBlueprintSnapshots } from "../../drizzle/schema-platform-strategic-blueprints";
import { buildPlatformSceneTextForCover } from "../../shared/platformSceneTextForCover.js";
import { buildTitleVariantsFromBlueprint, pickPreferredTitleVariant } from "../../shared/platformTitleVariants.js";
import {
  normalizePlatformVariants,
  pickCoverVariantFromVariants,
  type PlatformNativeVariant,
} from "../../shared/platformNativeVariants.js";

export type EnrichedBlueprintSnapshot = {
  sceneId: string;
  title: string;
  hook: string;
  copywriting: string;
  format: string;
  isGraphicCover: boolean;
  executionDetails?: {
    environmentAndWardrobe?: string;
    lightingAndCamera?: string;
    stepByStepScript?: unknown;
  };
  platformVariants?: PlatformNativeVariant[];
};

/** 無法從 DB 取得可售品質封面文案時拋出（由路由轉為 PRECONDITION_FAILED）。 */
export class PlatformCoverInputsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformCoverInputsError";
  }
}

export type OptimizedCoverFromDb = {
  topicHook: string;
  context: string;
  format: "短视频" | "图文";
  /** 與 topicHook 搭配的開場鉤子（簡中），供點擊意圖估計。 */
  appealHook: string;
  /** 快照入庫時的 platformsKey（逗號分隔平台 id），供封面管線拉 trendStore 高互動摘要。 */
  snapshotPlatformsKey?: string;
  /** platformVariants 选中的副标（≤18 字），可空 */
  coverSubline?: string;
  /** 实际采用的母语变体平台 id（xiaohongshu / bilibili / weixin_channels） */
  coverNativePlatform?: string;
  /** 主句是否来自 platformVariants.coverHeadline */
  coverHeadlineFromVariant?: boolean;
};

function readBlueprintTitle(raw: Record<string, unknown>): string {
  const t =
    raw.title ??
    raw["标题"] ??
    raw["选题标题"] ??
    raw.theme ??
    raw.titleExample ??
    "";
  return String(t).replace(/\s+/g, " ").trim();
}

function readBlueprintHook(raw: Record<string, unknown>): string {
  const h = raw.hook ?? raw.openingHook ?? raw["开头文案钩子"] ?? raw.contentHook ?? raw["开头钩子"] ?? "";
  return String(h).replace(/\s+/g, " ").trim();
}

function readBlueprintCopy(raw: Record<string, unknown>): string {
  const c = raw.copywriting ?? raw.body ?? raw["核心文案方向"] ?? raw["文案"] ?? raw["正文"] ?? "";
  return String(c).replace(/\s+/g, " ").trim();
}

function readFormat(raw: Record<string, unknown>): string {
  return String(raw.format ?? raw["格式"] ?? raw["内容形式"] ?? raw["形式"] ?? "").trim();
}

/** 与 bulkCoverPack.packSceneIds 上限一致；封面依赖快照 sceneId，须覆盖全部执行卡。 */
export const PLATFORM_SNAPSHOT_MAX_BLUEPRINTS = 48;

export function buildEnrichedBlueprintSnapshots(contentBlueprints: unknown[]): EnrichedBlueprintSnapshot[] {
  const list = Array.isArray(contentBlueprints) ? contentBlueprints : [];
  const enriched: EnrichedBlueprintSnapshot[] = [];
  let idx = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const sceneId = String(raw.id || raw.sceneId || raw.topicId || `topic-${idx}`).trim() || `topic-${idx}`;
    const title = readBlueprintTitle(raw);
    const hook = readBlueprintHook(raw);
    const copywriting = readBlueprintCopy(raw);
    const format = readFormat(raw);
    const isGraphicCover = format === "图文" || format === "小红书";
    const executionDetails =
      typeof raw.executionDetails === "object" && raw.executionDetails !== null
        ? (raw.executionDetails as EnrichedBlueprintSnapshot["executionDetails"])
        : undefined;
    const platformVariants = normalizePlatformVariants(raw.platformVariants ?? raw.platformAdaptations);
    enriched.push({
      sceneId,
      title,
      hook,
      copywriting,
      format,
      isGraphicCover,
      executionDetails,
      ...(platformVariants.length > 0 ? { platformVariants } : {}),
    });
    idx += 1;
  }
  return enriched;
}

export function enrichBlueprintsForSnapshot(
  contentBlueprints: unknown[],
  windowDays: number,
  requestedPlatforms: string[],
): {
  windowDays: number;
  platformsKey: string;
  enriched: EnrichedBlueprintSnapshot[];
} {
  const platformsKey = Array.from(new Set(requestedPlatforms.filter(Boolean))).sort().join(",");
  const enriched = buildEnrichedBlueprintSnapshots(contentBlueprints).slice(0, PLATFORM_SNAPSHOT_MAX_BLUEPRINTS);
  return { windowDays, platformsKey, enriched };
}

/**
 * 将战略地图扩写 / 赠送等会话选题合并进用户最新快照（按 sceneId 覆盖）。
 * 封面 enqueue 仅认 DB 快照，不写入则「仅封面」会 PRECONDITION_FAILED（表现为第 6+ 张无进度）。
 */
export async function upsertPlatformBlueprintSnapshotEntries(params: {
  userId: number;
  contentBlueprints: unknown[];
}): Promise<void> {
  const incoming = buildEnrichedBlueprintSnapshots(params.contentBlueprints);
  if (incoming.length === 0) return;

  const database = await db.getDb();
  if (!database) return;

  let rows: {
    id: number;
    windowDays: number;
    platformsKey: string | null;
    contextSnippet: string | null;
    blueprintsJson: string | null;
  }[];
  try {
    rows = await database
      .select({
        id: platformStrategicBlueprintSnapshots.id,
        windowDays: platformStrategicBlueprintSnapshots.windowDays,
        platformsKey: platformStrategicBlueprintSnapshots.platformsKey,
        contextSnippet: platformStrategicBlueprintSnapshots.contextSnippet,
        blueprintsJson: platformStrategicBlueprintSnapshots.blueprintsJson,
      })
      .from(platformStrategicBlueprintSnapshots)
      .where(eq(platformStrategicBlueprintSnapshots.userId, params.userId))
      .orderBy(desc(platformStrategicBlueprintSnapshots.updatedAt))
      .limit(1);
  } catch (e) {
    console.warn(
      "[upsertPlatformBlueprintSnapshotEntries] read:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
    return;
  }

  const mergedByScene = new Map<string, EnrichedBlueprintSnapshot>();
  const row = rows[0];
  if (row?.blueprintsJson) {
    try {
      const parsed = JSON.parse(row.blueprintsJson) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const r = item as EnrichedBlueprintSnapshot;
          const sid = String(r.sceneId || "").trim();
          if (sid) mergedByScene.set(sid, r);
        }
      }
    } catch {
      /* 损坏快照由 incoming 重建 */
    }
  }
  for (const item of incoming) {
    mergedByScene.set(item.sceneId, item);
  }
  const merged = Array.from(mergedByScene.values()).slice(0, PLATFORM_SNAPSHOT_MAX_BLUEPRINTS);
  const blueprintsJson = JSON.stringify(merged);
  const now = new Date();

  try {
    if (row) {
      await database
        .update(platformStrategicBlueprintSnapshots)
        .set({ blueprintsJson, updatedAt: now })
        .where(eq(platformStrategicBlueprintSnapshots.id, row.id));
    } else {
      await database.insert(platformStrategicBlueprintSnapshots).values({
        userId: params.userId,
        windowDays: 15,
        platformsKey: "",
        contextSnippet: "",
        blueprintsJson,
        updatedAt: now,
      });
    }
  } catch (e) {
    console.warn(
      "[upsertPlatformBlueprintSnapshotEntries] write:",
      e instanceof Error ? e.message.slice(0, 240) : e,
    );
  }
}

/**
 * 近 N 天快照里的选题标题，供 Stage2 Pro 深度优化禁复读。
 */
export async function loadRecentPlatformBlueprintTitles(params: {
  userId: number;
  withinDays?: number;
  limitSnapshots?: number;
  maxTitles?: number;
}): Promise<string[]> {
  const userId = Number(params.userId);
  if (!Number.isFinite(userId) || userId <= 0) return [];
  const withinDays = Math.min(45, Math.max(3, Number(params.withinDays) || 14));
  const limitSnapshots = Math.min(12, Math.max(1, Number(params.limitSnapshots) || 6));
  const maxTitles = Math.min(48, Math.max(6, Number(params.maxTitles) || 36));
  const database = await db.getDb();
  if (!database) return [];
  try {
    const rows = await database
      .select({
        blueprintsJson: platformStrategicBlueprintSnapshots.blueprintsJson,
        updatedAt: platformStrategicBlueprintSnapshots.updatedAt,
      })
      .from(platformStrategicBlueprintSnapshots)
      .where(eq(platformStrategicBlueprintSnapshots.userId, userId))
      .orderBy(desc(platformStrategicBlueprintSnapshots.updatedAt))
      .limit(limitSnapshots);
    const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
    const titles: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const ts = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      if (ts && ts < cutoff) continue;
      if (!row.blueprintsJson) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.blueprintsJson);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const title = readBlueprintTitle(item as Record<string, unknown>);
        if (!title || title.length < 4) continue;
        const key = title.replace(/\s+/g, "").toLowerCase().slice(0, 32);
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(title.slice(0, 120));
        if (titles.length >= maxTitles) return titles;
      }
    }
    return titles;
  } catch (e) {
    console.warn(
      "[loadRecentPlatformBlueprintTitles]:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
    return [];
  }
}

export async function savePlatformStrategicBlueprintSnapshot(params: {
  userId: number;
  windowDays: number;
  context?: string;
  requestedPlatforms: string[];
  contentBlueprints: unknown[];
}): Promise<void> {
  const database = await db.getDb();
  if (!database) return;
  const { enriched, platformsKey } = enrichBlueprintsForSnapshot(
    params.contentBlueprints,
    params.windowDays,
    params.requestedPlatforms,
  );
  if (enriched.length === 0) return;
  const contextSnippet = String(params.context || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
  try {
    await database.insert(platformStrategicBlueprintSnapshots).values({
      userId: params.userId,
      windowDays: params.windowDays,
      platformsKey,
      contextSnippet,
      blueprintsJson: JSON.stringify(enriched),
      updatedAt: new Date(),
    });
  } catch (e) {
    console.warn(
      "[savePlatformStrategicBlueprintSnapshot] skip:",
      e instanceof Error ? e.message.slice(0, 240) : e,
    );
  }
}

function blueprintRecordFromSnapshot(hit: EnrichedBlueprintSnapshot): Record<string, unknown> {
  return {
    title: hit.title,
    hook: hit.hook,
    copywriting: hit.copywriting,
    openingHook: hit.hook,
    body: hit.copywriting,
    format: hit.format,
  };
}

function firstSentence(text: string, maxLen: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const first = t.split(/[。！？!?；;\n]/)[0] ?? t;
  return first.trim().slice(0, maxLen);
}

function stripRedundantLeading(body: string, prefixes: string[]): string {
  let b = String(body || "").replace(/\s+/g, " ").trim();
  for (const raw of prefixes) {
    const p = String(raw || "").replace(/\s+/g, " ").trim();
    if (p.length >= 4 && b.startsWith(p)) {
      b = b.slice(p.length).replace(/^[\s，,、:：]+/, "").trim();
    }
  }
  return b;
}

/** 粗判：是否足以做「可上架」單張封面（避免空殼選題混進生產管線）。 */
function blueprintHasSaleableSubstance(hit: EnrichedBlueprintSnapshot): boolean {
  const title = hit.title.replace(/\s+/g, " ").trim();
  const copy = hit.copywriting.replace(/\s+/g, " ").trim();
  const hook = hit.hook.replace(/\s+/g, " ").trim();
  if (copy.length >= 20) return true;
  if (title.length >= 6 && (hook.length >= 6 || copy.length >= 10)) return true;
  if (title.length >= 8 && (hook.length >= 4 || copy.length >= 4)) return true;
  return false;
}

/**
 * 從入庫快照還原後做一次確定性優化（標題變體評分、補鉤子、去重開頭），再組封面 context。
 * `preferredPlatform`：UI/决策智库 platformHint，用于优先取对应 platformVariants.coverHeadline。
 */
export function optimizeEnrichedBlueprintForCover(
  hit: EnrichedBlueprintSnapshot,
  blueprintIndex: number,
  preferredPlatform?: string | null,
): OptimizedCoverFromDb {
  if (!blueprintHasSaleableSubstance(hit)) {
    throw new PlatformCoverInputsError(
      "该选题在快照中的文案信息量不足，无法产出可售品质的封面主句与语境。请补全标题与正文后重新执行内容生成。",
    );
  }

  const bp = blueprintRecordFromSnapshot(hit);
  const variants = buildTitleVariantsFromBlueprint(bp, blueprintIndex);
  const hookSeed = String(bp.hook ?? bp.openingHook ?? bp.contentHook ?? "").replace(/\s+/g, " ").trim();
  const baselinePick = pickPreferredTitleVariant(variants, hookSeed);
  const pickedTitle = baselinePick.title.replace(/\s+/g, " ").trim();
  let title = pickedTitle || hit.title.replace(/\s+/g, " ").trim();
  if (!title) {
    title = firstSentence(hit.copywriting, 88);
  }
  if (!title) {
    throw new PlatformCoverInputsError("文案优化后仍无有效主标，请编辑该选题并重新同步。");
  }

  let hook = hit.hook.replace(/\s+/g, " ").trim();
  if (!hook || hook === title) {
    hook = firstSentence(hit.copywriting, 140);
  }
  if (hook === title) {
    hook = "";
  }

  let copywriting = stripRedundantLeading(hit.copywriting, [title, hook, pickedTitle]);
  copywriting = copywriting.replace(/\s+/g, " ").trim();

  const pickedVariant = pickCoverVariantFromVariants(hit.platformVariants, preferredPlatform);
  const coverFromVariant = pickedVariant.coverHeadline.trim();
  const topicHook = (coverFromVariant || title).slice(0, 500);
  /** 变体 hook 优先作 appeal；否则用正文钩子 */
  const appealHook = (pickedVariant.hook || hook).slice(0, 500);
  if (!topicHook.trim()) {
    throw new PlatformCoverInputsError("封面主句为空，请检查该选题后重新同步。");
  }

  const context = buildPlatformSceneTextForCover({
    title: topicHook,
    hook: appealHook,
    copywriting,
    executionDetails: hit.executionDetails,
  }).trim();

  if (context.length < 12) {
    throw new PlatformCoverInputsError("优化后的正文语境过短，无法安全进入生图。请补充该选题文案后重新同步。");
  }

  const formatFromVariant = String(pickedVariant.format || "").trim();
  const format: "短视频" | "图文" =
    hit.isGraphicCover || formatFromVariant.includes("图文") ? "图文" : "短视频";
  return {
    topicHook,
    context,
    format,
    appealHook,
    coverSubline: pickedVariant.coverSubline.slice(0, 24) || undefined,
    coverNativePlatform: pickedVariant.platform || undefined,
    coverHeadlineFromVariant: Boolean(coverFromVariant),
  };
}

/**
 * 從最新一條戰略選題快照中解析 sceneId，套用 {@link optimizeEnrichedBlueprintForCover}，失敗即抛錯（無任何客戶端文案後備）。
 */
export async function assertOptimizedCoverInputsFromDb(params: {
  userId: number;
  sceneId: string;
  /** UI / 决策智库 platformHint：优先取对应 platformVariants.coverHeadline */
  preferredPlatform?: string | null;
}): Promise<OptimizedCoverFromDb> {
  const database = await db.getDb();
  if (!database) {
    throw new PlatformCoverInputsError("服务端暂时无法连接数据库，无法载入已入库的选题快照。请稍后再试。");
  }
  const sid = String(params.sceneId || "").trim();
  if (!sid) {
    throw new PlatformCoverInputsError("缺少选题 ID（sceneId），无法从云端快照恢复文案。");
  }

  let rows: { blueprintsJson: string | null; platformsKey: string | null }[];
  try {
    rows = await database
      .select({
        blueprintsJson: platformStrategicBlueprintSnapshots.blueprintsJson,
        platformsKey: platformStrategicBlueprintSnapshots.platformsKey,
      })
      .from(platformStrategicBlueprintSnapshots)
      .where(eq(platformStrategicBlueprintSnapshots.userId, params.userId))
      .orderBy(desc(platformStrategicBlueprintSnapshots.updatedAt))
      .limit(1);
  } catch (e) {
    console.warn(
      "[assertOptimizedCoverInputsFromDb] db:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
    throw new PlatformCoverInputsError("读取选题快照失败，请稍后重试。");
  }

  const rawJson = rows[0]?.blueprintsJson;
  if (!rawJson) {
    throw new PlatformCoverInputsError(
      "尚未找到可用的战略选题快照。请先在平台页完成内容生成（Stage2）并成功写入后，再生成封面。",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new PlatformCoverInputsError("选题快照资料损坏，请重新执行内容生成以刷新快照。");
  }
  if (!Array.isArray(parsed)) {
    throw new PlatformCoverInputsError("选题快照格式异常，请重新执行内容生成以刷新快照。");
  }

  let hit: EnrichedBlueprintSnapshot | undefined;
  let blueprintIndex = 0;
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (!row || typeof row !== "object") continue;
    const r = row as EnrichedBlueprintSnapshot;
    if (String(r.sceneId || "").trim() === sid) {
      hit = r;
      blueprintIndex = i;
      break;
    }
  }

  if (!hit) {
    throw new PlatformCoverInputsError(
      "目前快照中找不到与此卡片对应的选题（sceneId 不一致或快照已过期）。请重新整理页面或重新执行内容生成后再试。",
    );
  }

  const snapshotPlatformsKey = String(rows[0]?.platformsKey || "").trim();

  return {
    ...optimizeEnrichedBlueprintForCover(hit, blueprintIndex, params.preferredPlatform),
    snapshotPlatformsKey: snapshotPlatformsKey || undefined,
  };
}
