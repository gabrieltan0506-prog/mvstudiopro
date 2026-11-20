/**
 * 图文知识手册 · 大稿分段暂存（1119 C4）。
 *
 * 超过 KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS（20 万字）的手册原稿不再整本塞进报价/出图请求的单个字段：
 * 前台按 ≤20 万字分段上传，服务端按用户分区、按原稿 sha256 内容寻址落到知识卡证据同一个对象存储桶；
 * 报价与出图只带摘要（出图另带本页正文），服务端取回全文后调用**未改动**的回执查询 / 计价 / 页码校验 / 参考原页函数，
 * 所以同一份原稿的回执哈希、计价、扣费键与旧路径完全一致。
 *
 * 对象布局（GCS，与 knowledge-card-distill/ 证据同桶）：
 *   knowledge-card-manuscript/user-{uid}/{sha256}/chunk-{i}.json   { version:1, index, count, text }
 *   knowledge-card-manuscript/user-{uid}/{sha256}/manifest.json    { version:1, sha256, chars, count, chunkChars:number[] }
 * - 每段与清单都只「新建」（ifGenerationMatch=0）；已存在时读回比对：相同即幂等成功，不同即拒绝（内容不同禁止覆盖）。
 * - 清单只在全部分段齐全、且服务端对拼回全文重算的 sha256 与字数都一致后才写；没有清单的原稿不能报价也不能出图。
 * - 暂存原稿是记录：本模块不提供、也不调用任何删除。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS } from "../../shared/knowledgeCardPagination";
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcs } from "./gcs";

export const HANDBOOK_MANUSCRIPT_PREFIX = "knowledge-card-manuscript";
export const HANDBOOK_MANUSCRIPT_CHUNK_CHARS = KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS;
/** 原稿总长上限与读档派生队列一致（routers enqueueKnowledgeCardLevelDerive 500 万字） */
export const HANDBOOK_MANUSCRIPT_MAX_CHARS = 5_000_000;
export const HANDBOOK_MANUSCRIPT_MAX_CHUNKS = Math.ceil(HANDBOOK_MANUSCRIPT_MAX_CHARS / HANDBOOK_MANUSCRIPT_CHUNK_CHARS);

const DIGEST = /^[a-f0-9]{64}$/;
export const handbookManuscriptDigestSchema = z.string().regex(DIGEST);

export function handbookManuscriptDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class HandbookManuscriptError extends Error {
  constructor(message: string, readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE", readonly missing?: number[]) {
    super(message);
  }
}

export type HandbookManuscriptStore = {
  /** 不存在返回 null；其他读取故障抛错 */
  read(name: string): Promise<unknown | null>;
  /** 只新建；已存在返回 false（不覆盖） */
  create(name: string, value: unknown): Promise<boolean>;
};

const chunkSchema = z.object({ version: z.literal(1), index: z.number().int().min(0), count: z.number().int().min(1), text: z.string() }).strict();
const manifestSchema = z.object({ version: z.literal(1), sha256: z.string().regex(DIGEST), chars: z.number().int().min(1), count: z.number().int().min(1), chunkChars: z.array(z.number().int().min(0)) }).strict();

function root(userId: number, digest: string) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new HandbookManuscriptError("账号无效", "BAD_REQUEST");
  if (!DIGEST.test(digest)) throw new HandbookManuscriptError("原稿摘要无效", "BAD_REQUEST");
  return `${HANDBOOK_MANUSCRIPT_PREFIX}/user-${userId}/${digest}`;
}
const chunkName = (base: string, index: number) => `${base}/chunk-${index}.json`;

function realStore(): HandbookManuscriptStore {
  return {
    async read(name) {
      try { return JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${getGcsBucketName()}/${name}` })).buffer.toString("utf8")); }
      catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return null; throw e; }
    },
    async create(name, value) {
      try {
        await uploadBufferToGcs({ objectName: name, buffer: Buffer.from(JSON.stringify(value), "utf8"), contentType: "application/json", ifGenerationMatch: "0" });
        return true;
      } catch (e) {
        if (e instanceof Error && /gcs_upload_failed:412/.test(e.message)) return false;
        throw e;
      }
    },
  };
}

function expectedCount(totalChars: number) {
  return Math.ceil(totalChars / HANDBOOK_MANUSCRIPT_CHUNK_CHARS);
}

function checkShape(totalChars: number, count: number) {
  if (!Number.isSafeInteger(totalChars) || totalChars < 1 || totalChars > HANDBOOK_MANUSCRIPT_MAX_CHARS)
    throw new HandbookManuscriptError("原稿字数超出范围，未上传", "BAD_REQUEST");
  if (count !== expectedCount(totalChars)) throw new HandbookManuscriptError("原稿分段数与字数不一致，未上传", "BAD_REQUEST");
}

/** 上传一段。同一段重复上传幂等；同摘要同段号内容不同即拒绝。 */
export async function stageHandbookManuscriptChunk(
  userId: number,
  input: { digest: string; index: number; count: number; totalChars: number; text: string },
  store: HandbookManuscriptStore = realStore(),
): Promise<{ stored: boolean }> {
  const base = root(userId, input.digest);
  checkShape(input.totalChars, input.count);
  if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= input.count) throw new HandbookManuscriptError("分段序号无效", "BAD_REQUEST");
  // 除末段外每段必须恰好满额，末段长度由总字数决定：段边界唯一，拼回即原稿
  const want = input.index < input.count - 1 ? HANDBOOK_MANUSCRIPT_CHUNK_CHARS : input.totalChars - HANDBOOK_MANUSCRIPT_CHUNK_CHARS * (input.count - 1);
  if (input.text.length !== want) throw new HandbookManuscriptError("分段长度与原稿不一致，未上传", "BAD_REQUEST");
  const value = { version: 1 as const, index: input.index, count: input.count, text: input.text };
  if (await store.create(chunkName(base, input.index), value)) return { stored: true };
  const existing = chunkSchema.safeParse(await store.read(chunkName(base, input.index)));
  if (existing.success && existing.data.count === input.count && existing.data.text === input.text) return { stored: false };
  throw new HandbookManuscriptError("同一原稿的该分段已存在且内容不同，未覆盖", "CONFLICT");
}

async function assemble(base: string, digest: string, count: number, totalChars: number, store: HandbookManuscriptStore) {
  const parts = await Promise.all(Array.from({ length: count }, (_, i) => store.read(chunkName(base, i))));
  const missing = parts.flatMap((p, i) => (p == null ? [i] : []));
  if (missing.length) throw new HandbookManuscriptError(`原稿上传不完整（缺第 ${missing.map(i => i + 1).join("、")} 段），请重新上传；未扣费、未提交出图`, "NOT_FOUND", missing);
  const texts = parts.map((p, i) => {
    const parsed = chunkSchema.safeParse(p);
    if (!parsed.success || parsed.data.index !== i || parsed.data.count !== count) throw new HandbookManuscriptError("暂存原稿分段损坏，请重新上传", "CONFLICT");
    return parsed.data.text;
  });
  const text = texts.join("");
  if (text.length !== totalChars || handbookManuscriptDigest(text) !== digest)
    throw new HandbookManuscriptError("暂存原稿与摘要不一致，已拒绝；请重新上传", "CONFLICT");
  return { text, chunkChars: texts.map(t => t.length) };
}

/** 全部分段到齐后封存：服务端对拼回全文重算摘要，不一致拒绝；重复封存幂等。 */
export async function finalizeHandbookManuscript(
  userId: number,
  input: { digest: string; count: number; totalChars: number },
  store: HandbookManuscriptStore = realStore(),
): Promise<{ digest: string; chars: number }> {
  const base = root(userId, input.digest);
  checkShape(input.totalChars, input.count);
  const prior = manifestSchema.safeParse(await store.read(`${base}/manifest.json`));
  if (prior.success) {
    if (prior.data.chars !== input.totalChars || prior.data.count !== input.count) throw new HandbookManuscriptError("原稿已封存且规格不同，未覆盖", "CONFLICT");
    return { digest: input.digest, chars: prior.data.chars };
  }
  const { chunkChars } = await assemble(base, input.digest, input.count, input.totalChars, store);
  const manifest = { version: 1 as const, sha256: input.digest, chars: input.totalChars, count: input.count, chunkChars };
  if (!(await store.create(`${base}/manifest.json`, manifest))) {
    const now = manifestSchema.safeParse(await store.read(`${base}/manifest.json`));
    if (!now.success || now.data.chars !== input.totalChars || now.data.count !== input.count) throw new HandbookManuscriptError("原稿封存冲突，未覆盖", "CONFLICT");
  }
  return { digest: input.digest, chars: input.totalChars };
}

const cache = new Map<string, string>();
const CACHE_MAX = 4;
/** 同一用户同一原稿的冷读只做一次：并发逐页请求共用同一次取回，不各自整本拼装 */
const loading = new Map<string, Promise<string>>();
/** 测试用：清空进程内全文缓存 */
export function __clearHandbookManuscriptCacheForTest() { cache.clear(); loading.clear(); planCache.clear(); }

/**
 * 按「用户 + 原稿摘要 + 读档模型」缓存分页结果（与全文缓存同处、同容量策略）。
 * 大稿每个逐页出图请求原先对整份暂存稿重复规划（校验本页正文与总页数各一次），32 路并发时同步阻塞事件循环。
 * 摘要即全文 sha256，同摘要必同全文，分页是纯函数：缓存结果与逐次重算逐字相同。
 */
const planCache = new Map<string, readonly string[]>();
export function cachedHandbookManuscriptPages(userId: number, digest: string, markdown: string, distillModel: string | undefined, plan: (markdown: string, distillModel?: string) => { pages: string[] }): readonly string[] {
  const key = `${userId}:${digest}:${distillModel ?? ""}`;
  const hit = planCache.get(key);
  if (hit) { planCache.delete(key); planCache.set(key, hit); return hit; }
  const pages = Object.freeze(plan(markdown, distillModel).pages.slice());
  planCache.set(key, pages);
  while (planCache.size > CACHE_MAX) planCache.delete(planCache.keys().next().value!);
  return pages;
}

/** 取回已封存原稿全文（逐段校验 + 重算摘要）；未封存/缺段/不一致都明确报错，绝不返回部分文本。 */
export async function loadHandbookManuscript(userId: number, digest: string, store: HandbookManuscriptStore = realStore()): Promise<string> {
  const base = root(userId, digest);
  const key = `${userId}:${digest}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // 最近使用的放到队尾：多本大书交替出图时不互相挤掉、逐页重读整本
    cache.delete(key); cache.set(key, hit);
    return hit;
  }
  const running = loading.get(key);
  if (running) return running;
  const work = readSealedManuscript(base, digest, key, store);
  loading.set(key, work);
  try { return await work; } finally { if (loading.get(key) === work) loading.delete(key); }
}

async function readSealedManuscript(base: string, digest: string, key: string, store: HandbookManuscriptStore): Promise<string> {
  let manifestRaw: unknown;
  try { manifestRaw = await store.read(`${base}/manifest.json`); }
  catch { throw new HandbookManuscriptError("暂存原稿暂时读不到，请稍后重试；未扣费、未提交出图", "UNAVAILABLE"); }
  const manifest = manifestSchema.safeParse(manifestRaw);
  if (!manifest.success || manifest.data.sha256 !== digest)
    throw new HandbookManuscriptError("原稿尚未完整上传或不属于当前账号，请重新上传；未扣费、未提交出图", "NOT_FOUND");
  let text: string;
  try { text = (await assemble(base, digest, manifest.data.count, manifest.data.chars, store)).text; }
  catch (e) {
    if (e instanceof HandbookManuscriptError) throw e;
    throw new HandbookManuscriptError("暂存原稿暂时读不到，请稍后重试；未扣费、未提交出图", "UNAVAILABLE");
  }
  cache.set(key, text);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return text;
}
