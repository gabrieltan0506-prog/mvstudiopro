/**
 * 画布生成媒体所有权 v2(四审 P0-1):**权威登记簿**,不再采信任何客户端可写的来源。
 *
 * 上一版把「路径出现在用户云草稿的资产字段里」当所有权——草稿本身是客户端可上传伪造的,
 * 攻击者把受害者路径写进自己草稿的 outputUrl 即可冒领。四审探针实锤后废弃该判定。
 *
 * v2 判定:对象生成交付给已登录用户的那一刻,由**服务端**写入所有权记录
 * `media-owners/<objectPath>.owner.json` = { ownerUserId, source, createdAt }。
 * 记录只由服务端在生成/交付路径写入,客户端没有任何接口能改它。
 * 验证 = 读记录并比对 userId;无记录一律拒绝。
 * 云草稿字段自此只是「引用」,与所有权无关。
 *
 * 存量对象:提供 backfillCanvasMediaOwnersFromDraft(手动/部署时一次性引导)——
 * 在登记簿上线**之前**写入云端的草稿是历史上由真实客户端产生的,以其资产字段做
 * 首次登记(先到先得,冲突跳过并记日志);引导完成后新对象全靠交付时登记,
 * 无记录的旧对象不自动续签(四审要求)。
 */
import { downloadGcsObject, getGcsBucketName, uploadBufferToGcs } from "./gcs.js";

export const CANVAS_MEDIA_OBJECT_RE =
  /^generated\/[A-Za-z0-9_\/-]+\/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/;

const OWNER_PREFIX = "media-owners/";

type OwnerRecord = { ownerUserId: number; source?: string; createdAt?: string };

/** 测试注入口:读/写记录 */
export type OwnerStore = {
  get: (objectPath: string) => Promise<OwnerRecord | null>;
  put?: (objectPath: string, record: OwnerRecord) => Promise<void>;
};

const cache = new Map<string, { rec: OwnerRecord | null; ts: number }>();
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
      return Number.isFinite(Number(rec?.ownerUserId)) ? rec : null;
    } catch {
      return null;
    }
  },
  async put(objectPath, record) {
    await uploadBufferToGcs({
      objectName: ownerObjectName(objectPath),
      buffer: Buffer.from(JSON.stringify(record)),
      contentType: "application/json",
    });
  },
};

/**
 * 服务端在生成/交付路径登记所有权。已有记录则不覆盖(先到先得,防后写冒领)。
 * 只允许服务端代码调用;绝不能暴露成任何客户端可达的接口。
 */
export async function registerCanvasMediaOwner(input: {
  objectPath: string;
  ownerUserId: number;
  source?: string;
  store?: OwnerStore;
}): Promise<boolean> {
  const p = String(input.objectPath || "");
  const uid = Number(input.ownerUserId);
  if (!CANVAS_MEDIA_OBJECT_RE.test(p) || p.includes("..")) return false;
  if (!Number.isFinite(uid) || uid <= 0) return false;
  const store = input.store || gcsStore;
  const existing = await store.get(p);
  if (existing) return Number(existing.ownerUserId) === uid;
  await store.put?.(p, {
    ownerUserId: uid,
    source: String(input.source || "delivery").slice(0, 60),
    createdAt: new Date().toISOString(),
  });
  cache.set(p, { rec: { ownerUserId: uid }, ts: Date.now() });
  return true;
}

/** 唯一的授权判定:权威记录存在且 ownerUserId 匹配;其余一律拒绝 */
export async function verifyCanvasMediaOwnership(
  userId: number,
  objectPath: string,
  opts?: { store?: OwnerStore; skipCache?: boolean },
): Promise<boolean> {
  const p = String(objectPath || "");
  if (!CANVAS_MEDIA_OBJECT_RE.test(p) || p.includes("..")) return false;
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return false;
  const now = Date.now();
  if (!opts?.skipCache) {
    const hit = cache.get(p);
    if (hit && now - hit.ts <= CACHE_TTL_MS) {
      return hit.rec != null && Number(hit.rec.ownerUserId) === uid;
    }
  }
  const rec = await (opts?.store || gcsStore).get(p);
  cache.set(p, { rec, ts: now });
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
    return CANVAS_MEDIA_OBJECT_RE.test(p) && !p.includes("..") ? p : null;
  } catch {
    return null;
  }
}

/**
 * 存量引导(手动/部署时执行一次,登记簿上线前的历史对象专用):
 * 读该用户当时的云草稿资产字段做首次登记;已有记录(含他人先登)一律跳过并计数。
 * 引导之后的新对象全靠交付时登记,本函数不得再对新增内容使用。
 */
export async function backfillCanvasMediaOwnersFromDraft(
  userId: number,
  opts?: { store?: OwnerStore; loadDraft?: (userId: number) => Promise<string | null> },
): Promise<{ registered: number; skipped: number }> {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return { registered: 0, skipped: 0 };
  const load =
    opts?.loadDraft ||
    (async (id: number) => {
      try {
        const { buffer } = await downloadGcsObject({
          gcsUri: `gs://${getGcsBucketName()}/manhua-cloud-drafts/user-${id}.json`,
        });
        return buffer.toString("utf8");
      } catch {
        return null;
      }
    });
  const raw = await load(uid);
  if (!raw) return { registered: 0, skipped: 0 };
  const paths = new Set<string>();
  try {
    const wrapper = JSON.parse(raw) as { payloadJson?: string; payload?: unknown };
    const payloadRaw =
      typeof wrapper.payloadJson === "string" ? JSON.parse(wrapper.payloadJson) : wrapper.payload ?? wrapper;
    const blocks = (payloadRaw as { canvas?: { blocks?: unknown[] } })?.canvas?.blocks || [];
    for (const blk of blocks as Array<Record<string, unknown>>) {
      for (const u of [
        blk.outputUrl,
        blk.refImageUrl,
        blk.editMaskUrl,
        blk.lastFrameUrl,
        ...(Array.isArray(blk.outputUrls) ? blk.outputUrls : []),
        ...(Array.isArray(blk.editFusionUrls) ? blk.editFusionUrls : []),
      ]) {
        const p = extractCanvasMediaObjectPath(u);
        if (p) paths.add(p);
      }
    }
  } catch {
    return { registered: 0, skipped: 0 };
  }
  let registered = 0;
  let skipped = 0;
  for (const p of Array.from(paths)) {
    const ok = await registerCanvasMediaOwner({
      objectPath: p,
      ownerUserId: uid,
      source: "backfill-draft",
      store: opts?.store,
    });
    if (ok) registered += 1;
    else skipped += 1;
  }
  return { registered, skipped };
}

/** 仅测试用:清缓存 */
export function __resetCanvasMediaOwnershipCacheForTests(): void {
  cache.clear();
}
