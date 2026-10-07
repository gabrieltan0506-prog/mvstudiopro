import { createHash } from "node:crypto";
import { MANHUA_ADVISOR_CAPABILITIES } from "../../shared/manhuaAdvisorCapabilities";
import { listManhuaDirectionCards } from "../../shared/manhuaDirectionCanonLibrary";
import { MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION } from "../../shared/manhuaDirectorStrategy";
import { parseManhuaViralTemplateCard, toPublicManhuaViralTemplateCard, type ManhuaViralTemplateCard, type PublicManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
import { resolveStableManhuaTemplatePublicCode } from "./manhuaTemplatePublicId";
import { downloadGcsObjectVersioned, getGcsBucketName, listGcsObjectVersions, type GcsObjectVersion } from "./gcs";

const APPROVED_PREFIX = "manhua-template-learn/approved/";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export type AdvisorKnowledgeTemplate = {
  publicId: string; nameZh: string; generation: string; contentSha256: string; updatedAt?: string;
  laneZh: PublicManhuaViralTemplateCard["laneZh"]; classificationTagsZh: string[];
};
export type AdvisorKnowledgeSnapshot = {
  version: 1; revision: string; scannedAt: string;
  templates: AdvisorKnowledgeTemplate[];
  directors: { id: string; version: string; nameZh: string; contentSha256: string }[];
  strategyManifestVersion: string;
  capabilities: typeof MANHUA_ADVISOR_CAPABILITIES;
};
export type AdvisorKnowledgeState = {
  status: "not_scanned" | "ready" | "stale";
  snapshot?: AdvisorKnowledgeSnapshot;
  refreshing: boolean;
  lastAttemptAt?: string;
  error?: string;
  changes?: { added: string[]; updated: string[]; deleted: string[]; unchangedCount: number; downloadedCards: number };
};
type CachedSummary = { objectName: string; summary: AdvisorKnowledgeTemplate };
type LegacyResolution = Awaited<ReturnType<typeof import("./manhuaViralTemplateStore")["resolveViralTemplateForExpand"]>>;
export type AdvisorKnowledgeTemplateResolution =
  | { card: ManhuaViralTemplateCard; appliedTemplate: { publicId: string; nameZh: string }; resolution: "indexed" | "legacy_full_catalog" }
  | { error: "bad_id" | "not_found" | "no_public_code" | "refresh_required" | "unavailable" };
type Dependencies = {
  list: () => Promise<GcsObjectVersion[]>;
  read: (object: GcsObjectVersion) => Promise<{ buffer: Buffer; generation: string }>;
  now?: () => Date;
  legacy?: (publicId: string) => Promise<LegacyResolution>;
};
class ScanError extends Error {}

function readApproved(object: GcsObjectVersion, buffer: Buffer): { card: ManhuaViralTemplateCard; summary: AdvisorKnowledgeTemplate } {
  let raw: unknown;
  try { raw = JSON.parse(buffer.toString("utf8")); } catch { throw new ScanError("已批准模板JSON无法解析，旧知识快照保留。"); }
  const card = parseManhuaViralTemplateCard(raw);
  if (!card || card.status !== "approved" || object.name !== `${APPROVED_PREFIX}${card.id}.json`) {
    throw new ScanError("已批准模板结构或身份不一致，旧知识快照保留。");
  }
  const code = resolveStableManhuaTemplatePublicCode(card);
  if (!code) throw new ScanError("已批准模板缺少可用公开编号，不能声称目录扫描完整。");
  const pub = toPublicManhuaViralTemplateCard({ ...card, publicCode: code });
  if (!pub) throw new ScanError("模板公开投影不可用，旧知识快照保留。");
  return { card, summary: { publicId: pub.publicId, nameZh: pub.nameZh, laneZh: pub.laneZh,
    classificationTagsZh: pub.classificationTagsZh, generation: object.generation, contentSha256: sha(buffer),
    ...(card.updatedAt ? { updatedAt: card.updatedAt } : {}) } };
}

/** Stores only public summaries and private lookup locations, never card bodies or learned media JSON. */
export function createManhuaAdvisorKnowledge(deps: Dependencies) {
  let summaries = new Map<string, CachedSummary>();
  let state: AdvisorKnowledgeState = { status: "not_scanned", refreshing: false };
  let inFlight: Promise<AdvisorKnowledgeState> | undefined;
  const now = () => (deps.now?.() || new Date()).toISOString();
  const inspect = (): AdvisorKnowledgeState => structuredClone({ ...state, refreshing: Boolean(inFlight) });

  async function scan(): Promise<AdvisorKnowledgeState> {
    const attemptedAt = now();
    try {
      const objects = await deps.list();
      const names = new Set<string>();
      for (const object of objects) {
        if (!object.name.startsWith(APPROVED_PREFIX) || !object.name.endsWith(".json") || !/^\d+$/.test(object.generation) || names.has(object.name)) {
          throw new ScanError("模板版本目录不完整或存在重复身份，旧知识快照保留。");
        }
        names.add(object.name);
      }
      // Transactional replacement: a failed download must not partially update the visible catalog.
      const next = new Map<string, CachedSummary>();
      const changed = objects.filter(object => {
        const cached = summaries.get(object.name);
        if (cached?.summary.generation !== object.generation) return true;
        next.set(object.name, cached); return false;
      });
      let cursor = 0;
      let failed = false;
      const workers = await Promise.allSettled(Array.from({ length: Math.min(4, changed.length) }, async () => {
        while (!failed && cursor < changed.length) {
          try {
            const object = changed[cursor++]!;
            const read = await deps.read(object);
            if (read.generation !== object.generation) throw new ScanError("扫描期间模板版本发生变化，未发布混合版本，请重新扫描。");
            next.set(object.name, { objectName: object.name, summary: readApproved(object, read.buffer).summary });
          } catch (error) { failed = true; throw error; }
        }
      }));
      const failure = workers.find((worker): worker is PromiseRejectedResult => worker.status === "rejected");
      if (failure) throw failure.reason;
      const templates = Array.from(next.values(), item => item.summary).sort((a, b) => a.publicId.localeCompare(b.publicId));
      if (new Set(templates.map(item => item.publicId)).size !== templates.length) throw new ScanError("模板公开编号重复，未发布新知识快照。");
      const directors = listManhuaDirectionCards().map(card => ({ id: card.id, version: card.version,
        nameZh: card.labelZh, contentSha256: sha(JSON.stringify(card)) })).sort((a, b) => a.id.localeCompare(b.id));
      const content = { version: 1 as const, templates, directors,
        strategyManifestVersion: MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION, capabilities: MANHUA_ADVISOR_CAPABILITIES };
      const previous = new Map(state.snapshot?.templates.map(item => [item.publicId, item]) || []);
      const currentIds = new Set(templates.map(item => item.publicId));
      const added = templates.filter(item => !previous.has(item.publicId)).map(item => item.publicId);
      const updated = templates.filter(item => {
        const prior = previous.get(item.publicId);
        return prior && (prior.generation !== item.generation || prior.contentSha256 !== item.contentSha256);
      }).map(item => item.publicId);
      const deleted = Array.from(previous.keys()).filter(id => !currentIds.has(id)).sort();
      summaries = next;
      state = { status: "ready", refreshing: false, lastAttemptAt: attemptedAt,
        snapshot: { ...content, revision: sha(JSON.stringify(content)), scannedAt: now() },
        changes: { added, updated, deleted, unchangedCount: templates.length - added.length - updated.length, downloadedCards: changed.length } };
    } catch (error) {
      state = { status: state.snapshot ? "stale" : "not_scanned", refreshing: false, lastAttemptAt: attemptedAt,
        ...(state.snapshot ? { snapshot: state.snapshot } : {}),
        error: error instanceof ScanError ? error.message : "知识目录读取失败；未确认最新版本，已有快照保留。" };
    }
    return structuredClone(state);
  }

  function refresh(): Promise<AdvisorKnowledgeState> {
    if (!inFlight) inFlight = scan().finally(() => { inFlight = undefined; });
    return inFlight;
  }
  async function resolveTemplate(publicId: string): Promise<AdvisorKnowledgeTemplateResolution> {
    const key = publicId.trim().toLowerCase();
    if (!/^mt_[a-z0-9]{4,16}$/.test(key)) return { error: "bad_id" };
    if (!state.snapshot) {
      // Explicit-ID compatibility only: the legacy resolver lists/downloads the full approved catalog.
      // Never perform this expensive fallback after a scan, including unknown/deleted IDs.
      if (!deps.legacy) return { error: "refresh_required" };
      const resolved = await deps.legacy(key);
      return "error" in resolved ? resolved : { ...resolved, resolution: "legacy_full_catalog" };
    }
    const cached = Array.from(summaries.values()).find(item => item.summary.publicId === key);
    if (!cached) return { error: "not_found" };
    const stale = () => {
      state = { ...state, status: "stale", changes: undefined, error: "所选模板已变化或无法核对，请刷新知识目录后再读取。" };
    };
    try {
      const object = { name: cached.objectName, generation: cached.summary.generation };
      const read = await deps.read(object);
      const { card, summary } = readApproved({ ...object, generation: read.generation }, read.buffer);
      if (read.generation !== cached.summary.generation || summary.publicId !== key || summary.contentSha256 !== cached.summary.contentSha256) {
        stale(); return { error: "refresh_required" };
      }
      return { card, appliedTemplate: { publicId: summary.publicId, nameZh: summary.nameZh }, resolution: "indexed" };
    } catch (error) {
      stale();
      if (error instanceof ScanError) return { error: "refresh_required" };
      return { error: /(?:gcs_stat_failed|gcs_download_failed):404(?:\b|:)/.test(error instanceof Error ? error.message : "") ? "not_found" : "unavailable" };
    }
  }
  return { inspect, refresh, resolveTemplate };
}

const knowledge = createManhuaAdvisorKnowledge({
  list: () => listGcsObjectVersions(APPROVED_PREFIX),
  read: object => downloadGcsObjectVersioned({ gcsUri: `gs://${getGcsBucketName()}/${object.name}` }),
  legacy: async publicId => (await import("./manhuaViralTemplateStore.js")).resolveViralTemplateForExpand(publicId),
});

/** No storage request, model call, automatic refresh, or mutation of project-frozen director packages. */
export const inspectManhuaAdvisorKnowledge = knowledge.inspect;
/** Explicit refresh only. Cold process reads approved cards once; warm refresh reads changed generations only. */
export const refreshManhuaAdvisorKnowledge = knowledge.refresh;
/** Server-only private card; caller may feed methods to the model, never expose this result as a public catalog. */
export const resolveManhuaAdvisorKnowledgeTemplate = knowledge.resolveTemplate;
