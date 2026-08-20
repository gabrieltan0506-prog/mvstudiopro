/**
 * 画布生成媒体所有权 v3(五审 P0-3/P0-4):**原子权威登记簿**。
 *
 * v2 的问题:①get→put 两步登记在并发下后写覆盖先写(TOCTOU,实测两用户都返回 true);
 * ②get 吞掉一切 GCS 错误当"无记录",403/超时/5xx/坏 JSON 都可能触发覆盖真主;
 * ③put 是可选字段,缺 put 也报登记成功;④backfill 以客户端可写草稿为归属证据,可被抢注。
 *
 * v3 契约:
 * - 存储层唯一写入原语是 createIfAbsent(GCS ifGenerationMatch=0 条件创建,412=已存在),
 *   不存在覆盖路径;登记结果四态 created / alreadyOwned / conflict / invalid。
 * - get 只有明确 404 才是"无记录";其余错误一律抛出,登记与验证都不许在故障时下结论。
 * - 缓存只缓存**正记录**;"无记录"不缓存(五审 P1-2:跨实例登记后 60s 负缓存误拒)。
 * - 存量引导只认服务端 jobs 表的成功任务(见 canvasMediaOwnershipBackfill.ts),
 *   客户端草稿永不作为归属证据。
 */
import {
  downloadGcsObject,
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";

export const CANVAS_MEDIA_OBJECT_RE =
  /^generated\/[A-Za-z0-9_\/-]+\/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/;

const OWNER_PREFIX = "media-owners/";

export type OwnerRecord = { ownerUserId: number; source?: string; createdAt?: string };

export type RegisterOwnerOutcome = "created" | "alreadyOwned" | "conflict" | "invalid";

/**
 * 测试注入口。get:无记录返回 null(仅明确 404),故障必须抛错;
 * createIfAbsent:原子条件创建,已存在(无论谁的)返回 "exists",绝不覆盖。
 */
export type OwnerStore = {
  get: (objectPath: string) => Promise<OwnerRecord | null>;
  createIfAbsent: (objectPath: string, record: OwnerRecord) => Promise<"created" | "exists">;
};

const cache = new Map<string, { rec: OwnerRecord; ts: number }>();
const CACHE_TTL_MS = 60_000;

function ownerObjectName(objectPath: string): string {
  return `${OWNER_PREFIX}${objectPath}.owner.json`;
}

const gcsStore: OwnerStore = {
  async get(objectPath) {
    try {
      const { buffer } = await downloadGcsObject({
        gcsUri: `gs://${getGcsBucketName()}/${ownerObjectName(objectPath)}`,
      });
      const rec = JSON.parse(buffer.toString("utf8")) as OwnerRecord;
      if (!Number.isFinite(Number(rec?.ownerUserId))) {
        // 记录存在但损坏:不是"无记录",按故障处理,禁止当作可登记空位
        throw new Error(`owner_record_corrupt:${objectPath}`);
      }
      return rec;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // downloadGcsObject 抛 gcs_download_failed:<status>:<body>;只有 404 是"无记录"
      if (/^gcs_download_failed:404:/.test(msg)) return null;
      throw error;
    }
  },
  async createIfAbsent(objectPath, record) {
    const { created } = await uploadBufferToGcsIfAbsent({
      objectName: ownerObjectName(objectPath),
      buffer: Buffer.from(JSON.stringify(record)),
      contentType: "application/json",
    });
    return created ? "created" : "exists";
  },
};

function validObjectPath(objectPath: unknown): string | null {
  const p = String(objectPath || "");
  return CANVAS_MEDIA_OBJECT_RE.test(p) && !p.includes("..") ? p : null;
}

/**
 * 服务端在生成/交付路径登记所有权(先到先得,原子)。
 * created=本次登记成功;alreadyOwned=同主已在册(幂等);conflict=他人已在册;
 * invalid=路径/用户不合法。存储故障(含 get 非 404 错误)向上抛,调用方不得视为成功。
 * 只允许服务端代码调用;绝不能暴露成任何客户端可达的接口。
 */
export async function registerCanvasMediaOwner(input: {
  objectPath: string;
  ownerUserId: number;
  source?: string;
  store?: OwnerStore;
}): Promise<RegisterOwnerOutcome> {
  const p = validObjectPath(input.objectPath);
  const uid = Number(input.ownerUserId);
  if (!p || !Number.isFinite(uid) || uid <= 0) return "invalid";
  const store = input.store || gcsStore;
  const outcome = await store.createIfAbsent(p, {
    ownerUserId: uid,
    source: String(input.source || "delivery").slice(0, 60),
    createdAt: new Date().toISOString(),
  });
  if (outcome === "created") {
    cache.set(p, { rec: { ownerUserId: uid }, ts: Date.now() });
    return "created";
  }
  // 已存在:读回真实记录比对(此时必有记录;读失败照抛,不猜)
  const existing = await store.get(p);
  if (existing && Number(existing.ownerUserId) === uid) return "alreadyOwned";
  return "conflict";
}

/** 唯一的授权判定:权威记录存在且 ownerUserId 匹配;无记录拒绝;存储故障向上抛(不许误判) */
export async function verifyCanvasMediaOwnership(
  userId: number,
  objectPath: string,
  opts?: { store?: OwnerStore; skipCache?: boolean },
): Promise<boolean> {
  const p = validObjectPath(objectPath);
  const uid = Number(userId);
  if (!p || !Number.isFinite(uid) || uid <= 0) return false;
  const now = Date.now();
  if (!opts?.skipCache) {
    const hit = cache.get(p);
    // 只信正缓存;负结果不缓存——另一实例刚登记完,这里不能拿旧的"无记录"顶 60s
    if (hit && now - hit.ts <= CACHE_TTL_MS && Number(hit.rec.ownerUserId) === uid) {
      return true;
    }
  }
  const rec = await (opts?.store || gcsStore).get(p);
  if (rec != null) cache.set(p, { rec, ts: now });
  return rec != null && Number(rec.ownerUserId) === uid;
}

/** 从签名 URL / 稳定链 / 裸路径中提取 generated/ 对象路径;提不出返回 null */
export function extractCanvasMediaObjectPath(u: unknown): string | null {
  const m = String(u || "").match(
    /(?:^|\/api\/canvas-media\/|storage\.googleapis\.com\/[^/]+\/)(generated\/[A-Za-z0-9_\/-]+\/[A-Za-z0-9_.%-]+\.(?:png|jpe?g|webp))/i,
  );
  if (!m) return null;
  try {
    const p = decodeURIComponent(m[1]);
    return validObjectPath(p);
  } catch {
    return null;
  }
}

/**
 * 生成交付登记(五审 P0-1/P1-1:真实主链 runner 与同步 op 共用)。
 * 成功产出 imageUrl 之后、任务报成功之前调用:
 * - 提不出 generated/ 对象路径:URL 若明显是本站受保护对象(带 /generated/)则视为异常抛错,
 *   否则(外部存储/其他前缀,受保护路由本就不服务)跳过登记返回 "skipped"。
 * - conflict / invalid / 存储故障 → 抛错,调用方不得把任务标成 succeeded(退费由调用方兜)。
 * - 瞬态存储故障内置 3 次重试,避免一次抖动就烧掉整单付费生成。
 */
export async function registerCanvasImageDeliveryOrThrow(input: {
  imageUrl: string;
  ownerUserId: number;
  source?: string;
  store?: OwnerStore;
}): Promise<"created" | "alreadyOwned" | "skipped"> {
  const objectPath = extractCanvasMediaObjectPath(input.imageUrl);
  if (!objectPath) {
    if (/\/generated\//i.test(String(input.imageUrl || ""))) {
      throw new Error(`canvas_media_owner_extract_failed:${String(input.imageUrl).slice(0, 160)}`);
    }
    return "skipped";
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
    try {
      const outcome = await registerCanvasMediaOwner({
        objectPath,
        ownerUserId: input.ownerUserId,
        source: input.source,
        store: input.store,
      });
      if (outcome === "created" || outcome === "alreadyOwned") return outcome;
      throw new Error(`canvas_media_owner_${outcome}:${objectPath}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 冲突/非法是确定性结论,重试无意义
      if (/^canvas_media_owner_(conflict|invalid)/.test(msg)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("canvas_media_owner_register_failed");
}

/** 仅测试用:清缓存 */
export function __resetCanvasMediaOwnershipCacheForTests(): void {
  cache.clear();
}
