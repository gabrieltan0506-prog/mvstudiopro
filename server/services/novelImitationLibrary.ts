/**
 * 爆款仿写 · 拆书参考模板库（1112b，平台公共库）：示例底稿拆解完成后，把有收录价值的结构收入公共库，
 * 所有登录用户可在工作台勾选作结构参考。
 *
 * 为什么不复用 manhuaViralTemplate 公共模板库：那边的卡片是视频爆款模板（3 秒钩子、带时码的 beatGrid、
 * 音画证据、公开编号与审核状态），列表与提示词通路都按视频卡设计，且入库要经站长审核流；
 * 拆书结构只有节拍与功能，硬塞进去要改审核流与卡片 schema。故用独立前缀，不碰现有模板与数据。
 *
 * 收录规则（常量见 shared/novelImitation.ts）：
 * - 参考分 total ≥ NOVEL_IMITATION_COLLECT_SCORE → 整本结构收录一条；
 * - 无论参考分多少，每条 highlight 各收录一条「特色章节」。
 * 公共条目只有结构信息与模型起的中性展示名；不存底稿原文、原句、专有名词、底稿文件名与上传者账号信息。
 * 写入前把字段里出现的底稿名称换成「某」，与底稿原文连续相同的描述整句略去。
 * 内部溯源字段（上传者 userId、底稿 sha256）只在服务端对象里，列表接口不返回；底稿文件名只写进该用户的私有证据目录。
 *
 * 存储（GCS 前缀 novel-imitation-library/public/）：
 * - bases/{底稿sha256}.json：每部底稿一条收录记录（当前条目摘要 + 参考分 + 已删除条目），即这部底稿的索引；
 *   新建用 ifGenerationMatch=0，更新按读到的 generation 条件写（沿用 manhuaNativeDeepReadIngest 的 CAS 做法），
 *   不同用户 / 不同底稿各写各的对象，互不覆盖；列表时枚举 bases/。
 * - entries/{id}.json：一条一个 JSON（结构内容，id 按内容寻址），只有被收录记录引用的条目才算在库。
 * 同一底稿不论谁上传只保留一套条目；后来的拆解参考分更高才覆盖。管理员删掉的条目不再自动收回。
 */
import { createHash, randomUUID } from "node:crypto";
import {
  NOVEL_IMITATION_COLLECT_SCORE,
  NOVEL_IMITATION_TITLE_MAX,
  novelImitationLibraryEntrySchema,
  type NovelImitationHighlight,
  type NovelImitationLibraryEntry,
  type NovelImitationLibraryItem,
  type NovelImitationLibraryOutcome,
  type NovelImitationSkeleton,
} from "../../shared/novelImitation";
import { NOVEL_ORIGINALITY_MIN_RUN } from "../../shared/novelOriginalityCheck";

export const NOVEL_IMITATION_LIBRARY_VERSION = "novel-imitation-library-v1";
export const NOVEL_IMITATION_LIBRARY_PREFIX = "novel-imitation-library/public";

export type NovelImitationLibraryStore = {
  /** 读对象及其 generation；不存在返回 null。 */
  read: (objectName: string) => Promise<{ body: string; generation: string } | null>;
  /** 无条件写（条目内容按内容寻址，同名即同内容）。 */
  write: (objectName: string, body: string) => Promise<void>;
  /** 条件写：generation 为 "0" 表示必须不存在；对象已变返回 false。 */
  writeIfGeneration: (objectName: string, body: string, generation: string) => Promise<boolean>;
  /** 列出前缀下的对象名。 */
  list: (prefix: string) => Promise<string[]>;
};

type BaseItem = NovelImitationLibraryItem & { updatedAt: string };
type BaseRecord = {
  version: string;
  /** 内部溯源：底稿 sha256 与当前条目来自哪位上传者。 */
  baseSha256: string;
  userId: number;
  /** 当前条目所依据的参考分；没有参考分为 -1。 */
  total: number;
  collectedAt: string;
  updatedAt: string;
  items: BaseItem[];
  /** 管理员删掉的条目 id；wholeDeleted：整本结构被删过，不再收回。 */
  deleted: string[];
  wholeDeleted?: boolean;
};

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const baseName = (baseSha256: string) => `${NOVEL_IMITATION_LIBRARY_PREFIX}/bases/${baseSha256}.json`;
const entryName = (id: string) => `${NOVEL_IMITATION_LIBRARY_PREFIX}/entries/${id}.json`;
const ID_PATTERN = /^(?:whole|hl)-[0-9a-f]{40}$/;

/** 名称占位：底稿专有名词一律换成它。 */
export const NOVEL_IMITATION_LIBRARY_NAME_MASK = "某";
/** 与底稿原文连续相同的描述整句略去后的占位。 */
export const NOVEL_IMITATION_LIBRARY_OMITTED = "（描述已略）";

// ---------- 结构信息整理（纯函数） ----------

const STRIP = new RegExp("[\\s\\p{P}\\p{S}]+", "gu");
const normalize = (v: string) => String(v || "").replace(STRIP, "");

/** 底稿原文的连续片段索引：任一描述与底稿有 ≥ run 字（去空白标点后）连续相同即视为含原句。 */
function createBaseRunChecker(baseText: string, run = NOVEL_ORIGINALITY_MIN_RUN) {
  const src = normalize(baseText);
  const windows = new Set<string>();
  for (let p = 0; p + run <= src.length; p++) windows.add(src.slice(p, p + run));
  return (text: string) => {
    const t = normalize(text);
    for (let i = 0; i + run <= t.length; i++) if (windows.has(t.slice(i, i + run))) return true;
    return false;
  };
}

function createScrubber(properNouns: readonly string[], baseText: string, baseTitle: string) {
  // 底稿文件名（去扩展名）也当名称处理，避免展示名里带出书名。
  const title = baseTitle.trim().replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const names = Array.from(new Set([...properNouns, ...(title.length >= 2 ? [title] : [])].map(n => n.trim()).filter(Boolean))).sort(
    (a, b) => b.length - a.length
  );
  const hasBaseRun = createBaseRunChecker(baseText);
  return (value: string) => {
    let out = value;
    for (const name of names) out = out.split(name).join(NOVEL_IMITATION_LIBRARY_NAME_MASK);
    return hasBaseRun(out) ? NOVEL_IMITATION_LIBRARY_OMITTED : out;
  };
}

const clipTitle = (v: string) => Array.from(v).slice(0, NOVEL_IMITATION_TITLE_MAX).join("");

function scrubHighlight(h: NovelImitationHighlight, scrub: (v: string) => string): NovelImitationHighlight {
  return {
    title: clipTitle(scrub(h.title)),
    position: scrub(h.position),
    feature: scrub(h.feature),
    beats: h.beats.map(scrub),
    reusableAs: scrub(h.reusableAs),
  };
}

/**
 * 由一次拆解结果生成应收录的公共条目：参考分 ≥ 80 收录整本，每条 highlight 各一条。
 * 只保留结构信息；properNouns、底稿文件名不进条目。id 按「底稿 + 内容」寻址。
 */
export function buildNovelImitationLibraryEntries(params: {
  skeleton: NovelImitationSkeleton;
  baseText: string;
  baseSha256: string;
  baseTitle?: string;
  userId: number;
  now: string;
}): NovelImitationLibraryEntry[] {
  const { skeleton, baseSha256, now, userId } = params;
  const scrub = createScrubber(skeleton.properNouns, params.baseText, params.baseTitle ?? "");
  const score = skeleton.score ? { ...skeleton.score, reason: scrub(skeleton.score.reason) } : undefined;
  const source = { userId, baseSha256 };
  const out: NovelImitationLibraryEntry[] = [];
  if (score && score.total >= NOVEL_IMITATION_COLLECT_SCORE) {
    const beats = skeleton.beats.map(b => ({
      index: b.index,
      name: scrub(b.name),
      function: scrub(b.function),
      position: scrub(b.position),
      roles: b.roles.map(scrub),
      summary: scrub(b.summary),
    }));
    const title = clipTitle(scrub(skeleton.title ?? "")) || `整本结构 · ${beats.length}拍`;
    out.push({
      id: `whole-${sha(JSON.stringify([baseSha256, "whole", title, score, beats])).slice(0, 40)}`,
      kind: "whole",
      title,
      collectedAt: now,
      updatedAt: now,
      score,
      beats,
      source,
    });
  }
  const seen = new Set<string>();
  for (const raw of skeleton.highlights ?? []) {
    const highlight = scrubHighlight(raw, scrub);
    const id = `hl-${sha(JSON.stringify([baseSha256, "highlight", highlight])).slice(0, 40)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: "highlight",
      title: highlight.title || highlight.feature,
      collectedAt: now,
      updatedAt: now,
      ...(score ? { score } : {}),
      highlight,
      source,
    });
  }
  return out.map(e => novelImitationLibraryEntrySchema.parse(e));
}

const toItem = (e: NovelImitationLibraryEntry): BaseItem => ({
  id: e.id,
  kind: e.kind,
  title: e.title,
  ...(e.score ? { total: e.score.total } : {}),
  ...(e.highlight ? { feature: e.highlight.feature, reusableAs: e.highlight.reusableAs } : {}),
  collectedAt: e.collectedAt,
  updatedAt: e.updatedAt,
});

const outcomeOf = (rec: Pick<BaseRecord, "items">, scored: boolean, extra: Partial<NovelImitationLibraryOutcome> = {}): NovelImitationLibraryOutcome => ({
  scored,
  wholeCollected: rec.items.some(i => i.kind === "whole"),
  highlightCount: rec.items.filter(i => i.kind === "highlight").length,
  ...extra,
});

// ---------- 存储 ----------

async function readBase(store: NovelImitationLibraryStore, baseSha256: string) {
  const hit = await store.read(baseName(baseSha256));
  if (!hit) return null;
  return { record: JSON.parse(hit.body) as BaseRecord, generation: hit.generation };
}

async function resolveStore(store?: NovelImitationLibraryStore) {
  return store ?? (await createGcsNovelImitationLibraryStore());
}

export class NovelImitationLibraryConflictError extends Error {
  constructor() {
    super("拆书参考模板库正忙，请稍后重试。");
    this.name = "NovelImitationLibraryConflictError";
  }
}

const CAS_ATTEMPTS = 4;

/**
 * 拆解完成后收录到公共库。同一底稿：库里没有 → 收录；库里已有且本次参考分更高 → 整套覆盖；否则保留原有条目。
 * baseTitle（底稿文件名）只写进该用户的私有证据目录，不进公共对象。
 */
export async function collectNovelImitationLibrary(params: {
  userId: number;
  skeleton: NovelImitationSkeleton;
  baseText: string;
  baseTitle?: string;
  requestId?: string;
  store?: NovelImitationLibraryStore;
  now?: () => number;
}): Promise<NovelImitationLibraryOutcome> {
  const store = await resolveStore(params.store);
  const stamp = (params.now ?? Date.now)();
  const now = new Date(stamp).toISOString();
  const baseSha256 = sha(params.baseText);
  const scored = Boolean(params.skeleton.score);
  const total = params.skeleton.score?.total ?? -1;
  const fresh = buildNovelImitationLibraryEntries({
    skeleton: params.skeleton,
    baseText: params.baseText,
    baseSha256,
    baseTitle: params.baseTitle,
    userId: params.userId,
    now,
  });
  // 私有溯源证据：底稿文件名只留在这里（该用户的拆解证据目录），只增不覆盖。
  await store
    .writeIfGeneration(
      `novel-imitation-skeleton/user-${params.userId}/evidence/library/${baseSha256}-${stamp}-${randomUUID()}.json`,
      JSON.stringify({
        version: NOVEL_IMITATION_LIBRARY_VERSION, requestId: params.requestId, userId: params.userId, baseSha256,
        baseTitle: params.baseTitle ?? "", total, entryIds: fresh.map(e => e.id), savedAt: now,
      }),
      "0"
    )
    .catch(error => console.warn("[novel-imitation-library] 溯源证据未写入", error instanceof Error ? error.message : "failed"));

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const current = await readBase(store, baseSha256);
    const prev = current?.record;
    if (prev && !(total > prev.total)) return outcomeOf(prev, scored, { alreadyCollected: true });
    const deleted = new Set(prev?.deleted ?? []);
    const keep = fresh.filter(e => !deleted.has(e.id) && !(e.kind === "whole" && prev?.wholeDeleted));
    // 先写条目内容（未被收录记录引用前不算在库），再条件写收录记录。
    for (const entry of keep) await store.write(entryName(entry.id), JSON.stringify({ version: NOVEL_IMITATION_LIBRARY_VERSION, entry }));
    const record: BaseRecord = {
      version: NOVEL_IMITATION_LIBRARY_VERSION,
      baseSha256,
      userId: params.userId,
      total,
      collectedAt: prev?.collectedAt ?? now,
      updatedAt: now,
      items: keep.map(toItem),
      deleted: Array.from(deleted),
      ...(prev?.wholeDeleted ? { wholeDeleted: true } : {}),
    };
    if (await store.writeIfGeneration(baseName(baseSha256), JSON.stringify(record), current?.generation ?? "0")) {
      return outcomeOf(record, scored);
    }
  }
  throw new NovelImitationLibraryConflictError();
}

/** 公共库全部条目（新到旧），不含溯源字段。 */
export async function listNovelImitationLibrary(store?: NovelImitationLibraryStore): Promise<NovelImitationLibraryItem[]> {
  const s = await resolveStore(store);
  const names = (await s.list(`${NOVEL_IMITATION_LIBRARY_PREFIX}/bases/`)).filter(n => n.endsWith(".json"));
  const records = await Promise.all(
    names.map(async n => {
      try {
        const hit = await s.read(n);
        return hit ? (JSON.parse(hit.body) as BaseRecord) : null;
      } catch {
        return null;
      }
    })
  );
  return records
    .flatMap(r => r?.items ?? [])
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, kind, title, total, feature, reusableAs, collectedAt }) => ({
      id, kind, title, collectedAt,
      ...(total !== undefined ? { total } : {}),
      ...(feature ? { feature } : {}),
      ...(reusableAs ? { reusableAs } : {}),
    }));
}

async function readEntry(store: NovelImitationLibraryStore, id: string) {
  if (!ID_PATTERN.test(id)) return null;
  const hit = await store.read(entryName(id));
  if (!hit) return null;
  const parsed = novelImitationLibraryEntrySchema.safeParse((JSON.parse(hit.body) as { entry?: unknown }).entry);
  return parsed.success ? parsed.data : null;
}

/** 管理员删除一条（权限由路由 adminProcedure 把关）。不在库里返回 deleted:false。 */
export async function deleteNovelImitationLibraryEntry(id: string, store?: NovelImitationLibraryStore) {
  const s = await resolveStore(store);
  const entry = await readEntry(s, id);
  if (!entry) return { deleted: false };
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const current = await readBase(s, entry.source.baseSha256);
    if (!current || !current.record.items.some(i => i.id === id)) return { deleted: false };
    const record: BaseRecord = {
      ...current.record,
      updatedAt: new Date().toISOString(),
      items: current.record.items.filter(i => i.id !== id),
      deleted: Array.from(new Set([...current.record.deleted, id])),
      ...(entry.kind === "whole" ? { wholeDeleted: true } : {}),
    };
    if (await s.writeIfGeneration(baseName(entry.source.baseSha256), JSON.stringify(record), current.generation)) return { deleted: true };
  }
  throw new NovelImitationLibraryConflictError();
}

export class NovelImitationLibraryMissingError extends Error {
  constructor() {
    super("所选拆书参考模板已下架或不可用，请重新勾选。");
    this.name = "NovelImitationLibraryMissingError";
  }
}

/** 按勾选顺序读条目；任一条已不在库里即抛错（不静默跳过）。 */
export async function loadNovelImitationLibraryEntries(
  ids: readonly string[],
  store?: NovelImitationLibraryStore
): Promise<NovelImitationLibraryEntry[]> {
  if (!ids.length) return [];
  const s = await resolveStore(store);
  const out: NovelImitationLibraryEntry[] = [];
  for (const id of ids) {
    const entry = await readEntry(s, id);
    const base = entry ? await readBase(s, entry.source.baseSha256) : null;
    if (!entry || !base?.record.items.some(i => i.id === id)) throw new NovelImitationLibraryMissingError();
    out.push(entry);
  }
  return out;
}

// ---------- 提示词 ----------

export const NOVEL_IMITATION_LIBRARY_NOTE =
  "以下是用户勾选的拆书参考模板（只有节拍、功能与复用方式）。只借结构：节拍顺序、功能位置、节奏与情绪走向；不沿用示例作品的人名、设定、桥段、原句，场景、人物与文字全部按本作品原创。与已确认大纲或用户方向冲突时，以已确认内容为准。";

/** 大纲与正文阶段注入的结构参考块；不带任何溯源信息。 */
export function formatNovelImitationLibraryReference(entries: readonly NovelImitationLibraryEntry[]) {
  if (!entries.length) return "";
  const parts = entries.map((e, i) => {
    const score = e.score ? `，参考分${e.score.total}` : "";
    if (e.kind === "whole") {
      const beats = (e.beats ?? []).map(
        b => `${b.index}. ${b.name}〔${b.function}〕${b.position}：${b.summary}${b.roles.length ? `（人物功能位：${b.roles.join("、")}）` : ""}`
      );
      return [`参考模板${i + 1}「${e.title}」（整本结构${score}）：`, ...beats].join("\n");
    }
    const h = e.highlight!;
    return [
      `参考模板${i + 1}「${e.title}」（特色章节：${h.feature}${score}）：`,
      `小节拍：${h.beats.join(" → ")}`,
      `复用方式：${h.reusableAs}`,
    ].join("\n");
  });
  return [NOVEL_IMITATION_LIBRARY_NOTE, ...parts].join("\n\n");
}

/** 生产存储：GCS（条件写沿用 ifGenerationMatch）。 */
export async function createGcsNovelImitationLibraryStore(): Promise<NovelImitationLibraryStore> {
  const gcs = await import("./gcs");
  const uri = (objectName: string) => `gs://${gcs.getGcsBucketName()}/${objectName}`;
  const upload = (objectName: string, body: string, ifGenerationMatch?: string) =>
    gcs.uploadBufferToGcs({
      objectName,
      buffer: Buffer.from(body, "utf8"),
      contentType: "application/json; charset=utf-8",
      ...(ifGenerationMatch ? { ifGenerationMatch } : {}),
    });
  return {
    read: async objectName => {
      if (!gcs.getGcsBucketName()) return null;
      try {
        const { buffer, generation } = await gcs.downloadGcsObjectVersioned({ gcsUri: uri(objectName) });
        return { body: buffer.toString("utf8"), generation };
      } catch (error) {
        if (error instanceof Error && /^gcs_(?:stat|download)_failed:404/.test(error.message)) return null;
        throw error;
      }
    },
    write: async (objectName, body) => {
      await upload(objectName, body);
    },
    writeIfGeneration: async (objectName, body, generation) => {
      try {
        await upload(objectName, body, generation);
        return true;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("gcs_upload_failed:412")) return false;
        throw error;
      }
    },
    list: prefix => gcs.listGcsObjectNamesByPrefix({ prefix, allPages: true, literalPrefix: true }),
  };
}
