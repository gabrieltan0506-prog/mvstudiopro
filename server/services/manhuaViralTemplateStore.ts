/**
 * 漫剧节奏模板动态库（GCS）。
 * proposals/ = 待审；approved/ = 人审通过。产品列表 = GCS approved
 * （出厂种子 2026-08-10 已清空，shared 库只剩合并逻辑，见 manhuaViralTemplateBank.ts 文件头）。
 */
import { randomBytes } from "node:crypto";
import {
  describeManhuaTemplateLearnSourceZh,
  getManhuaViralTemplate,
  listApprovedManhuaViralTemplates,
  listApprovedManhuaViralTemplatesGrouped,
  makePublicTemplateId,
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
} from "../../shared/manhuaViralTemplateBank.js";
import { canRetireTemplate } from "../../shared/manhuaTemplateLifecycle.js";
import {
  makeStableManhuaTemplatePublicId,
  resolveStableManhuaTemplatePublicCode,
} from "./manhuaTemplatePublicId.js";
import {
  downloadGcsObject,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
  deleteGcsObject,
  downloadGcsObjectVersioned,
  uploadBufferToGcsIfAbsent,
  getGcsBucketName,
} from "./gcs.js";

export const MANHUA_VIRAL_PROPOSALS_PREFIX = "manhua-template-learn/proposals/";
export const MANHUA_VIRAL_APPROVED_PREFIX = "manhua-template-learn/approved/";
export const MANHUA_VIRAL_ARCHIVE_PREFIX = "manhua-template-learn/archive/";

/** 归档版本号收口为纯数字串；路由与存储层都要校验，不能只信路由 */
/**
 * 严格列举：**读不动就抛，列不全也抛**。
 *
 * 宽松版默认只读 80 张、列举失败返回 []、单卡读失败跳过 —— 展示列表可以这样，
 * 但**生命周期判断不行**：漏掉几张就可能把「同赛道最后一张」判成「还有好几张」，
 * 下架完这条赛道编剧室直接空掉。
 */
const MANHUA_TEMPLATE_LIST_HARD_LIMIT = 1000;

/**
 * 严格列名：**列到上限就抛**，因为此时无法证明已经列全。
 * 所有生命周期链路共用这一处口径 —— 判断「有几张」的地方不许各写各的。
 */
async function listObjectNamesStrict(prefix: string): Promise<string[]> {
  const names = await listGcsObjectNamesByPrefix({
    prefix,
    maxResults: MANHUA_TEMPLATE_LIST_HARD_LIMIT,
  });
  if (names.length >= MANHUA_TEMPLATE_LIST_HARD_LIMIT) {
    throw new Error(`模板对象达到 ${MANHUA_TEMPLATE_LIST_HARD_LIMIT} 条，无法确认列表完整`);
  }
  return names;
}

async function listCardsUnderPrefixStrict(
  prefix: string,
  _limit = MANHUA_TEMPLATE_LIST_HARD_LIMIT,
): Promise<ManhuaViralTemplateCard[]> {
  const names = await listObjectNamesStrict(prefix);
  const cards: ManhuaViralTemplateCard[] = [];
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue;
    cards.push(await readCardFromObjectStrict(name));
  }
  return cards;
}

/**
 * 生命周期锁：**批准 / 下架 / 恢复共用一把**。
 *
 * 「同赛道最后一张不许下架」这道门只在单进程内成立 ——
 * 两个并发请求都读到「同赛道有 2 张」，各自放行，最终剩 0 张，
 * 编剧室那条赛道直接空掉。读-判-写必须整体互斥。
 *
 * 用 GCS 条件创建当锁（`ifGenerationMatch=0` 只有第一个建得成）；
 * 建成后回读比对 token —— 防「别人先建、我误以为是自己建的」。
 */
const MANHUA_TEMPLATE_LIFECYCLE_LOCK = "manhua-template-learn/locks/approved-lifecycle.json";

/**
 * 生命周期租约（lease）。
 *
 * ⚠️ **锁不会过期，锁本身就是新的故障源**：持锁进程崩溃（实例重启／进程被杀／网络断）、
 * 建锁后回读失败、release 暂时失败——任何一种，锁对象都会永远留在 GCS，
 * 之后**所有批准、下架、恢复永久被拒**，只能人工去删那个对象。
 * 原来没锁最多是并发出错；有锁而不会过期，崩一次就全锁死。
 *
 * 所以锁体里写 `expiresAt`，到期即可被下一次操作接管。
 * TTL 取 10 分钟：这三种操作都是「读几百张卡 → 判 → 写一两个对象」，
 * 正常秒级完成；超过 10 分钟只可能是持有者已经不在了。
 */
export type LifecycleLease = {
  token: string;
  createdAt: string;
  expiresAt: string;
};

export const MANHUA_TEMPLATE_LOCK_TTL_MS = 10 * 60 * 1000;

/** 供测试注入；生产用真实时钟 */
export const manhuaTemplateLifecycleClock = { now: () => Date.now() };

/**
 * 租约是否已过期。
 *
 * 兼容上一版只写 `createdAt`、没有 `expiresAt` 的锁对象：否则旧版本若在
 * release 前中断，新版本上线后会把它永久当成活锁。完全无法识别时间的对象
 * 仍按未过期处理，避免误抢未知锁。
 */
export function isLifecycleLeaseExpired(raw: unknown, nowMs: number): boolean {
  const lease = raw as Partial<LifecycleLease> | null;
  const expiresAt = Date.parse(String(lease?.expiresAt || ""));
  if (Number.isFinite(expiresAt)) return expiresAt <= nowMs;

  const legacyCreatedAt = Date.parse(String(lease?.createdAt || ""));
  return Number.isFinite(legacyCreatedAt)
    && legacyCreatedAt + MANHUA_TEMPLATE_LOCK_TTL_MS <= nowMs;
}

export async function acquireManhuaTemplateLifecycleLock(): Promise<() => Promise<void>> {
  const bucket = getGcsBucketName();
  const lockUri = `gs://${bucket}/${MANHUA_TEMPLATE_LIFECYCLE_LOCK}`;
  const busy = () => new Error("另一项模板批准、下架或恢复正在处理，请稍后重试");

  const makeBody = () => {
    const now = manhuaTemplateLifecycleClock.now();
    const lease: LifecycleLease = {
      token: randomBytes(16).toString("hex"),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + MANHUA_TEMPLATE_LOCK_TTL_MS).toISOString(),
    };
    return { lease, buffer: Buffer.from(JSON.stringify(lease, null, 2)) };
  };

  /** 建锁 → 回读核对 token → 交出「按自己那一版条件删除」的释放函数 */
  const tryAcquire = async (): Promise<(() => Promise<void>) | null> => {
    const { lease, buffer } = makeBody();
    const created = await uploadBufferToGcsIfAbsent({
      bucket,
      objectName: MANHUA_TEMPLATE_LIFECYCLE_LOCK,
      buffer,
      contentType: "application/json",
    });
    if (!created.created) return null;

    let versioned: { buffer: Buffer; generation: string };
    try {
      versioned = await downloadGcsObjectVersioned({ gcsUri: lockUri });
    } catch (e) {
      /**
       * 回读失败：锁已经建出去了，此刻**不知道它的 generation**，删不掉。
       * 直接抛会把它变成一把没人能释放的死锁——但因为写了 expiresAt，
       * 它会在 TTL 后被下一次操作接管，不再是永久停摆。
       */
      throw new Error(
        `模板生命周期锁回读失败，已停止本次操作；锁将在 ${Math.round(
          MANHUA_TEMPLATE_LOCK_TTL_MS / 60000,
        )} 分钟后自动失效：${e instanceof Error ? e.message : e}`,
      );
    }

    const saved = JSON.parse(versioned.buffer.toString("utf8")) as Partial<LifecycleLease>;
    if (saved.token !== lease.token) {
      // 建成了却不是自己的内容：不碰它，交给 TTL
      throw new Error("模板生命周期锁内容不一致，已停止操作");
    }

    return async () => {
      // 只删自己那一版：期间若已被 TTL 接管并替换，条件删除会失败，
      // **绝不能删掉替换后的新锁**
      await deleteGcsObject({
        objectName: MANHUA_TEMPLATE_LIFECYCLE_LOCK,
        ifGenerationMatch: versioned.generation,
      });
    };
  };

  const first = await tryAcquire();
  if (first) return first;

  // 抢不到：看现有租约是不是已经过期
  let existing: { buffer: Buffer; generation: string };
  try {
    existing = await downloadGcsObjectVersioned({ gcsUri: lockUri });
  } catch {
    // 读不动就当它还活着
    throw busy();
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(existing.buffer.toString("utf8"));
  } catch {
    parsed = null;
  }
  if (!isLifecycleLeaseExpired(parsed, manhuaTemplateLifecycleClock.now())) {
    throw busy();
  }

  try {
    // 条件删除：只删我读到的那一版。若持有者自己释放并重建，这里会 412 ——
    // 那正是要的：说明锁又活了，不该被抢
    await deleteGcsObject({
      objectName: MANHUA_TEMPLATE_LIFECYCLE_LOCK,
      ifGenerationMatch: existing.generation,
    });
  } catch {
    throw busy();
  }

  const second = await tryAcquire();
  if (!second) throw busy();
  return second;
}


/**
 * 归档索引：**不依赖 approved 行存在**。
 *
 * 立此函数的由头：换代体检只返回 approved 卡，而恢复入口嵌在 approved 行里 ——
 * 模板一下架就从 approved 消失，**恢复入口跟着消失**，等于下架即不可逆。
 * 归档件是花钱学来的（一部 58 分钟合辑约 $1.075），必须能独立找回。
 */
export type ArchivedManhuaViralTemplateIndexRow = {
  id: string;
  nameZh: string;
  laneZh: string;
  updatedAt?: string;
  beatCount: number;
  learnSourceZh?: string;
};

/** 归档条目的排序口径：先 updatedAt 降序，同刻再按 generation 数值降序 */
export function compareArchivedRowsDesc(
  a: { updatedAt?: string; generation: string },
  b: { updatedAt?: string; generation: string },
): number {
  const at = Date.parse(a.updatedAt || "");
  const bt = Date.parse(b.updatedAt || "");
  const byTime = Number.isFinite(at) && Number.isFinite(bt) ? bt - at : 0;
  return byTime || compareGenerationDesc(a.generation, b.generation);
}

export async function listArchivedManhuaViralTemplateIndex(): Promise<
  ArchivedManhuaViralTemplateIndexRow[]
> {
  const names = await listObjectNamesStrict(MANHUA_VIRAL_ARCHIVE_PREFIX);

  /**
   * ⚠️ **不能只比文件名数字选最新版**。归档文件名有两种来源：
   *   · GCS generation（下架时用原对象的 generation）
   *   · 修订批准产生的 YYYYMMDDHHmmssSSS 时间戳
   * 两者不在同一数值空间，直接比大小会挑错版本。
   * 所以先严格读出全部有效归档卡，再按 `card.updatedAt`（相同再按 generation）选最新。
   */
  const byId = new Map<string, ArchivedManhuaViralTemplateIndexRow & { generation: string }>();
  for (const objectName of names) {
    const suffix = objectName.slice(MANHUA_VIRAL_ARCHIVE_PREFIX.length);
    const match = suffix.match(/^(tpl_[a-z0-9_-]{1,60})\/(\d{1,30})\.json$/i);
    if (!match) continue;
    const id = match[1]!;
    const generation = match[2]!;

    const card = await readCardFromObjectStrict(objectName);
    if (card.id !== id) {
      throw new Error(`归档对象与模板 id 不一致：${objectName}`);
    }
    if (card.status !== "approved" && card.status !== "rejected") {
      throw new Error(`归档对象状态无效：${objectName}`);
    }

    const row = {
      id,
      nameZh: card.nameZh,
      laneZh: card.laneZh,
      updatedAt: card.updatedAt,
      beatCount: card.beatGrid.length,
      learnSourceZh: describeManhuaTemplateLearnSourceZh(card.provenance),
      generation,
    };
    const prev = byId.get(id);
    if (!prev || compareArchivedRowsDesc(row, prev) < 0) byId.set(id, row);
  }

  // 硬上限内返回**全部**唯一模板，不静默截断：
  // 截断会让第 N 个之后的模板永远找不回来，而它们是花钱学来的
  return Array.from(byId.values())
    .sort(compareArchivedRowsDesc)
    .map(({ generation: _g, ...row }) => row);
}

/** 生命周期判断专用的正式库全量；展示列表继续走宽松版 */
export async function listGcsManhuaViralApprovedStrict(): Promise<ManhuaViralTemplateCard[]> {
  const cards = await listCardsUnderPrefixStrict(MANHUA_VIRAL_APPROVED_PREFIX, 1000);
  return cards.filter((card) => card.status === "approved");
}

/** 体检候选专用：读不到就抛，不能把「暂时读不到已付费精读卡」显示成「建议重学」 */
export async function listGcsManhuaViralProposalsStrict(): Promise<ManhuaViralTemplateCard[]> {
  const cards = await listCardsUnderPrefixStrict(MANHUA_VIRAL_PROPOSALS_PREFIX);
  return cards.filter((card) => card.status === "proposed");
}

/** 归档版本号是递增数字串，**必须按数值比**：字典序会把 9 排在 10 前面 */
export function compareGenerationDesc(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return b > a ? 1 : b < a ? -1 : 0;
}

export const MANHUA_ARCHIVE_GENERATION_RE = /^\d{1,30}$/;

/**
 * 严格读取：**读不动就抛**，不返回 null。
 *
 * 宽松版把「读取失败」和「没有这个对象」压成同一个 null，
 * 生命周期链上这两者的后果完全不同：前者要让用户重试，
 * 后者会被显示成「还没有归档版本」——用户据此以为旧版没了，实际只是 GCS 抖了一下。
 */
async function readCardFromObjectStrict(objectName: string): Promise<ManhuaViralTemplateCard> {
  const bucket = getGcsBucketName();
  const { buffer } = await downloadGcsObject({ gcsUri: `gs://${bucket}/${objectName}` });
  let raw: unknown;
  try {
    raw = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(`模板对象不是有效 JSON：${objectName}`);
  }
  const card = parseManhuaViralTemplateCard(raw);
  if (!card) throw new Error(`模板对象结构无法解析：${objectName}`);
  return card;
}

async function readCardFromObject(objectName: string): Promise<ManhuaViralTemplateCard | null> {
  const bucket = String(
    process.env.GCS_BUCKET_NAME
      || process.env.GROWTH_CAMP_GCS_BUCKET
      || process.env.VERTEX_GCS_BUCKET
      || process.env.GOOGLE_CLOUD_STORAGE_BUCKET
      || "mv-studio-pro-vertex-video-temp",
  ).trim();
  try {
    const { buffer } = await downloadGcsObject({ gcsUri: `gs://${bucket}/${objectName}` });
    const text = buffer.toString("utf8");
    const json = JSON.parse(text) as unknown;
    return parseManhuaViralTemplateCard(json);
  } catch (e) {
    console.warn(
      "[manhuaViralTemplateStore] read failed:",
      objectName,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * 待审卡的列举上限。
 *
 * 原来统一是 80 —— 那是「一个赛道几张系列卡」的旧规模。
 * 原生精读改成**一集一张卡**之后，跑 20 集就是 20 张，几个系列直接撑爆：
 *   · 花了钱入了库的卡在审批页看不见（只回前 80）
 *   · 换代体检的候选池被截断 → 明明有 native 卡能顶上，却建议「重学一版」= 再花一次钱
 *   · GCS 按对象名字典序，`tpl_native_*` 排在 `tpl_series_*` 前面，会把别的待审卡挤出去
 */
const MANHUA_VIRAL_PROPOSALS_LIST_MAX = 1000;

async function listCardsUnderPrefix(
  prefix: string,
  maxResults = 80,
): Promise<ManhuaViralTemplateCard[]> {
  let names: string[] = [];
  try {
    names = await listGcsObjectNamesByPrefix({ prefix, maxResults });
  } catch (e) {
    console.warn(
      "[manhuaViralTemplateStore] list failed:",
      prefix,
      e instanceof Error ? e.message : e,
    );
    return [];
  }
  const cards: ManhuaViralTemplateCard[] = [];
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue;
    const card = await readCardFromObject(name);
    if (card) cards.push(card);
  }
  return cards;
}

export async function listGcsManhuaViralProposals(): Promise<ManhuaViralTemplateCard[]> {
  // 逐集卡规模：必须列全，否则用户付费学到的卡在审批页根本不出现
  const cards = await listCardsUnderPrefix(
    MANHUA_VIRAL_PROPOSALS_PREFIX,
    MANHUA_VIRAL_PROPOSALS_LIST_MAX,
  );
  return cards.filter((c) => c.status === "proposed" || c.status === "approved");
}

export async function listGcsManhuaViralApproved(): Promise<ManhuaViralTemplateCard[]> {
  const cards = await listCardsUnderPrefix(MANHUA_VIRAL_APPROVED_PREFIX);
  return cards.filter((c) => c.status === "approved");
}

/** 种子 ∪ GCS approved */
export async function listMergedApprovedManhuaViralTemplates(): Promise<ManhuaViralTemplateCard[]> {
  const extras = await listGcsManhuaViralApproved();
  return listApprovedManhuaViralTemplates(extras);
}

export async function listMergedApprovedManhuaViralTemplatesGrouped() {
  const extras = await listGcsManhuaViralApproved();
  return listApprovedManhuaViralTemplatesGrouped(extras);
}

export async function getMergedManhuaViralTemplate(
  id?: string | null,
): Promise<ManhuaViralTemplateCard | null> {
  const key = String(id || "").trim();
  if (!key) return null;
  const extras = await listGcsManhuaViralApproved();
  return getManhuaViralTemplate(key, extras);
}

export async function getGcsManhuaViralProposal(
  id: string,
): Promise<ManhuaViralTemplateCard | null> {
  const key = String(id || "").trim();
  if (!key) return null;
  const objectName = `${MANHUA_VIRAL_PROPOSALS_PREFIX}${key}.json`;
  return readCardFromObject(objectName);
}

export async function getGcsManhuaViralApproved(
  id: string,
): Promise<ManhuaViralTemplateCard | null> {
  const key = String(id || "").trim();
  if (!/^tpl_[a-z0-9_-]{1,60}$/i.test(key)) return null;
  return readCardFromObject(`${MANHUA_VIRAL_APPROVED_PREFIX}${key}.json`);
}

/** 优化成功后只写 proposals/；正式 approved/ 在 owner 再次批准前保持不变。 */
export async function saveManhuaViralTemplateRevisionProposal(
  card: ManhuaViralTemplateCard,
): Promise<ManhuaViralTemplateCard> {
  const validated = parseManhuaViralTemplateCard(card);
  if (!validated || validated.status !== "proposed" || !validated.revision) {
    throw new Error("待审模板修订校验失败");
  }
  const body = `${JSON.stringify(validated, null, 2)}\n`;
  await uploadBufferToGcs({
    objectName: `${MANHUA_VIRAL_PROPOSALS_PREFIX}${validated.id}.json`,
    buffer: Buffer.from(body, "utf8"),
    contentType: "application/json",
  });
  return validated;
}

/**
 * 人审批准进库：写入 GCS approved/，并尽量把 proposals/ 同步为 approved。
 * 可传 id（读提案）或完整 card。
 */
/**
 * 随机公开码：与内部 id / 剧名 / 序号零关联，无法反查（审查必须修 2 的过渡实现，B 档可换 HMAC）。
 * 唯一性口径（审查返工 2026-08-15）：全量读 approved（上限 1000 远超库容）、4 位与 8 位兜底
 * 均循环查重、耗尽即抛错。并发批准场景为单监管人操作，条件创建占位留给 B 档强化。
 */
/** 从**已给定**的占用集里铸一个新码；生命周期锁内调用它，避免锁内再去列一次库 */
export function mintUniqueTemplatePublicCodeFromTaken(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 24; i += 1) {
    const code = randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
    if (!taken.has(code)) return code;
  }
  for (let i = 0; i < 24; i += 1) {
    const code = randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
    if (!taken.has(code)) return code;
  }
  throw new Error("公开码空间耗尽，请人工介入");
}

/**
 * @deprecated 基于**宽松**读取（默认 80 张、列举失败返回 []）——
 * 列举一失败 taken 就是空集，会铸出重复公开码。
 * 生命周期链路一律改用 mintUniqueTemplatePublicCodeFromTaken(严格全量的 taken)。
 */
async function mintUniqueTemplatePublicCode(): Promise<string> {
  const taken = new Set(
    (await listCardsUnderPrefix(MANHUA_VIRAL_APPROVED_PREFIX, 1000))
      .map((c) => String(c.publicCode || "").toUpperCase())
      .filter(Boolean),
  );
  for (let i = 0; i < 24; i += 1) {
    const code = randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
    if (!taken.has(code)) return code;
  }
  for (let i = 0; i < 24; i += 1) {
    const code = randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
    if (!taken.has(code)) return code;
  }
  throw new Error("公开码铸造失败：连续 48 次碰撞（请检查 approved 库异常膨胀）");
}

/** 普通用户句柄（mt_xxxx）→ 完整卡；只在服务端解析，完整卡永不回传浏览器 */
export async function getMergedManhuaViralTemplateByPublicId(
  publicId?: string | null,
): Promise<ManhuaViralTemplateCard | null> {
  const key = String(publicId || "").trim().toLowerCase();
  if (!/^mt_[a-z0-9]{4,16}$/.test(key)) return null;
  const all = await listMergedApprovedManhuaViralTemplates();
  return all.find((c) => makeStableManhuaTemplatePublicId(c) === key) || null;
}

/**
 * 扩写用模板解析（审查返工 3+r4，2026-08-15）。入参三分类：
 * 合法 mt_* → 按公开句柄查；合法 legacy tpl_*（旧草稿兼容）→ 按内部 id 查；其余直接拒。
 * fail-closed：解析出的卡必须 approved 且持有合法 publicCode——无码卡列表隐藏、扩写同样
 * 不放行（否则旧内部 id 就是绕过匿名层的后门）。完整卡只供服务端喂模型；
 * 浏览器响应一律只回 { publicId, nameZh: 匿名名 }。
 */
export async function resolveViralTemplateForExpand(requestedTemplateId: string): Promise<{
  card: ManhuaViralTemplateCard;
  appliedTemplate: { publicId: string; nameZh: string };
} | { error: "bad_id" | "not_found" | "no_public_code" }> {
  const key = String(requestedTemplateId || "").trim();
  let card: ManhuaViralTemplateCard | null = null;
  if (/^mt_[a-z0-9]{4,16}$/i.test(key)) {
    card = await getMergedManhuaViralTemplateByPublicId(key.toLowerCase());
  } else if (/^tpl_[a-z0-9_-]{1,60}$/i.test(key)) {
    card = await getMergedManhuaViralTemplate(key);
  } else {
    return { error: "bad_id" };
  }
  if (!card || card.status !== "approved") return { error: "not_found" };
  const code = resolveStableManhuaTemplatePublicCode(card);
  if (!code) return { error: "no_public_code" };
  const { makeAnonymousTemplateNameZh } = await import("../../shared/manhuaViralTemplateBank.js");
  return {
    card,
    appliedTemplate: {
      publicId: makePublicTemplateId(code),
      nameZh: makeAnonymousTemplateNameZh(card.laneZh, code),
    },
  };
}

/**
 * 下架正式模板（0824 新增）：从 approved/ 移入 archive/，**不做物理删除**。
 *
 * 为什么是归档不是删除：
 *  - 模板是真金白银学出来的（一部 58 分钟合辑约 $1.075），误删无法重建
 *  - 旧抽帧模板要被新精读模板淘汰，但「淘汰」不等于「销毁」，日后对照分析仍要用
 *
 * ⚠️ 顺序不可颠倒：**先写归档、确认成功后才删原件**。
 * 反过来一旦删成功、写失败，数据就没了；这样最坏情况只是两处各留一份冗余。
 */
export async function archiveApprovedManhuaViralTemplate(
  id: string,
): Promise<ManhuaViralTemplateCard> {
  const key = String(id || "").trim();
  if (!key) throw new Error("缺少模板 id");

  /**
   * 「同赛道最后一张不许下架」这道门**必须在锁内、用严格全量判**：
   *   · 路由不能是唯一保护层 —— 换个入口调进来就绕过去了；
   *   · 宽松列表默认只读 80 张、失败返回 []，可能把「最后一张」看成「还有好几张」；
   *   · 两个并发请求各自读到「有 2 张」再各自放行，最终剩 0 张。
   */
  const release = await acquireManhuaTemplateLifecycleLock();
  try {
    return await archiveApprovedManhuaViralTemplateLocked(key);
  } finally {
    await release().catch((error) => {
      console.error("[manhuaTemplateLifecycle] release lock failed", error);
    });
  }
}

async function archiveApprovedManhuaViralTemplateLocked(
  key: string,
): Promise<ManhuaViralTemplateCard> {
  const approved = await listGcsManhuaViralApprovedStrict();
  const target = approved.find((card) => card.id === key);
  // 找不到就停手 —— 原来是「找不到则跳过门禁继续下架」，等于门形同虚设
  if (!target) {
    throw new Error("无法在完整正式库中确认该模板，已停止下架，请刷新后重试");
  }
  const gate = canRetireTemplate({
    card: target,
    sameLaneApprovedCount: approved.filter((card) => card.laneZh === target.laneZh).length,
  });
  if (!gate.ok) throw new Error(gate.reasonZh);

  const bucket = getGcsBucketName();
  const objectName = `${MANHUA_VIRAL_APPROVED_PREFIX}${key}.json`;

  // 取内容的同时拿到 generation：后面删除只删这一版，
  // 期间若有人批准了新版本，条件删除会 412 而不是把新版本毁掉
  let versioned: { buffer: Buffer; generation: string };
  try {
    versioned = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 只有真的 404 才叫「不存在」。401/403/429/5xx/凭证/网络错误必须原样上抛——
    // 把它们全说成「模板不存在」，用户会去重建一份本来还在的模板。
    if (message.startsWith("gcs_stat_failed:404")) {
      throw new Error("正式模板不存在或已下架");
    }
    if (message.startsWith("gcs_download_failed:404")) {
      // metadata 拿到了 generation，取 media 却 404：说明期间被替换
      throw new Error("模板已更新，请刷新后重试");
    }
    throw error;
  }

  const card = parseManhuaViralTemplateCard(JSON.parse(versioned.buffer.toString("utf8")));
  if (!card) throw new Error("正式模板内容无法解析");
  if (card.status !== "approved") throw new Error("该模板不是已批准状态，无需下架");

  const archived: ManhuaViralTemplateCard = {
    ...card,
    status: "rejected",
    updatedAt: new Date().toISOString(),
  };

  // 归档名用 generation：同一版重复下架只会写出同一个对象，天然幂等
  await uploadBufferToGcsIfAbsent({
    objectName: `${MANHUA_VIRAL_ARCHIVE_PREFIX}${card.id}/${versioned.generation}.json`,
    buffer: Buffer.from(`${JSON.stringify(archived, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });

  // 归档已落盘，此时才删原件；且只删我们读到的那一版
  try {
    await deleteGcsObject({ objectName, ifGenerationMatch: versioned.generation });
  } catch (e) {
    if (e instanceof Error && e.message === "gcs_delete_generation_conflict") {
      throw new Error("模板已更新，请刷新后重试");
    }
    throw e;
  }
  return archived;
}

export type ArchivedManhuaViralTemplate = {
  card: ManhuaViralTemplateCard;
  /** 归档对象名里的 generation —— 恢复时按它定位那一版 */
  generation: string;
  objectName: string;
};

/**
 * 列出某张模板的历史归档版本。
 *
 * 归档一直在写（`archive/<id>/<generation>.json`）**却没有任何读取入口** ——
 * 下架之后就再也看不到、回不去了。学习方式升级后这条尤其要紧：
 * 用新方法重学一版替掉旧的，万一新版不如旧版，得能翻回去比。
 */
export async function listArchivedManhuaViralTemplateVersions(
  id: string,
  maxResults = 20,
): Promise<ArchivedManhuaViralTemplate[]> {
  const key = String(id || "").trim();
  if (!/^tpl_[a-z0-9_-]{1,60}$/i.test(key)) {
    throw new Error("模板 id 格式无效");
  }

  const prefix = `${MANHUA_VIRAL_ARCHIVE_PREFIX}${key}/`;
  /**
   * **先扫全再排序再截断**，不能先 slice 后排。
   * 原来把 maxResults 直接传给列举：GCS 按对象名返回前 N 个，
   * 版本超过 20 时拿到的是「字典序前 20 个」而不是「最新 20 个」——
   * 用户想翻回上一版，看到的却是最老的那批。
   *
   * 列举失败**一律抛**，不 catch 成 []：
   * 空数组会在页面上显示「还没有归档版本」，
   * 让用户以为旧版没了，而实际只是 GCS 抖了一下。
   */
  // 与 index / strict 列表同一口径：列到硬上限就抛，不按不完整列表给版本
  const names = await listObjectNamesStrict(prefix);

  const rows: ArchivedManhuaViralTemplate[] = [];
  for (const objectName of names) {
    const suffix = objectName.slice(prefix.length);
    const match = suffix.match(/^(\d{1,30})\.json$/);
    if (!match) continue;

    const card = await readCardFromObjectStrict(objectName);
    // 对象放在 <id>/ 目录下不代表里面就是这张卡；错位会让恢复顶错模板
    if (card.id !== key) {
      throw new Error(`归档对象与模板 id 不一致：${objectName}`);
    }
    if (card.status !== "approved" && card.status !== "rejected") {
      throw new Error(`归档对象状态无效：${objectName}`);
    }
    rows.push({ card, generation: match[1]!, objectName });
  }

  return rows
    .sort((a, b) => {
      const aTime = Date.parse(a.card.updatedAt || "");
      const bTime = Date.parse(b.card.updatedAt || "");
      const byTime = Number.isFinite(aTime) && Number.isFinite(bTime) ? bTime - aTime : 0;
      // 时间相同时按 generation **数值**降序：字典序会把 "9" 排在 "10" 前面
      return byTime || compareGenerationDesc(a.generation, b.generation);
    })
    .slice(0, Math.max(1, Math.min(100, maxResults)));
}

/**
 * 把某个归档版本恢复成正式模板。
 *
 * 用**条件创建**（ifGenerationMatch=0）：approved/ 里已经有同 id 的正式模板时
 * 直接拒绝，不覆盖 —— 恢复是「捡回被下架的」，不是「顶掉现役的」。
 * 真要换现役的，先下架再恢复，两步都留痕。
 */
export async function restoreArchivedManhuaViralTemplate(input: {
  id: string;
  generation: string;
}): Promise<ManhuaViralTemplateCard> {
  // 恢复要在锁内读完整正式库做 publicCode 查重，与批准/下架共用同一把锁
  const release = await acquireManhuaTemplateLifecycleLock();
  try {
    return await restoreArchivedManhuaViralTemplateLocked(input);
  } finally {
    await release().catch((error) => {
      console.error("[manhuaTemplateLifecycle] release lock failed", error);
    });
  }
}

async function restoreArchivedManhuaViralTemplateLocked(input: {
  id: string;
  generation: string;
}): Promise<ManhuaViralTemplateCard> {
  const id = String(input.id || "").trim();
  const generation = String(input.generation || "").trim();
  if (!id || !generation) throw new Error("缺少模板 id 或版本号");
  if (!/^tpl_[a-z0-9_-]{1,60}$/i.test(id)) throw new Error("模板 id 格式无效");
  // 存储层重复校验一次：路由的 zod 不是唯一防线，别人换个入口调进来也要拦
  if (!MANHUA_ARCHIVE_GENERATION_RE.test(generation)) {
    throw new Error("归档版本号格式无效");
  }

  const bucket = getGcsBucketName();
  const archiveObject = `${MANHUA_VIRAL_ARCHIVE_PREFIX}${id}/${generation}.json`;
  // 严格读：读不动就抛，不能把「读取失败」当成「版本不存在」
  const archived = await readCardFromObjectStrict(archiveObject);
  if (archived.id !== id) {
    throw new Error("归档对象与目标模板不一致，已停止恢复");
  }
  if (archived.status !== "approved" && archived.status !== "rejected") {
    throw new Error("归档对象状态无效，已停止恢复");
  }

  /**
   * publicCode 可能在归档期间被别的模板占走 —— 直接沿用旧码会产生两张同码卡，
   * 而公开句柄就是靠它区分的。锁内读完整正式库，撞了就现铸一个。
   */
  const approvedNow = await listGcsManhuaViralApprovedStrict();
  const takenCodes = new Set(
    approvedNow
      .filter((card) => card.id !== id)
      .map((card) => String(card.publicCode || "").toUpperCase())
      .filter(Boolean),
  );
  const archivedCode = String(archived.publicCode || "").toUpperCase();
  const publicCode = archivedCode && !takenCodes.has(archivedCode)
    ? archivedCode
    : mintUniqueTemplatePublicCodeFromTaken(takenCodes);

  // 恢复出来的卡重新过一遍解析器：归档件可能是旧结构，直接写回等于把脏数据放进正式库
  const restored = parseManhuaViralTemplateCard({
    ...archived,
    status: "approved",
    publicCode,
    updatedAt: new Date().toISOString(),
  });
  if (!restored || restored.id !== id || restored.status !== "approved") {
    throw new Error("恢复后的模板校验失败");
  }

  const created = await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: `${MANHUA_VIRAL_APPROVED_PREFIX}${id}.json`,
    buffer: Buffer.from(`${JSON.stringify(restored, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
  if (!created.created) {
    throw new Error("同名正式模板已在库中；要替换请先下架现役版本，再恢复");
  }

  /**
   * best-effort 同步 proposals/ 里的审计副本，让它与正式库同码同状态。
   * **同步失败只记日志**：正式恢复已经成功，把它谎报成完全失败会让用户重试，
   * 而重试会撞上「同名正式模板已在库中」——反倒卡死。
   */
  try {
    await uploadBufferToGcs({
      bucket,
      objectName: `${MANHUA_VIRAL_PROPOSALS_PREFIX}${id}.json`,
      buffer: Buffer.from(`${JSON.stringify(restored, null, 2)}\n`, "utf8"),
      contentType: "application/json",
    });
  } catch (e) {
    console.error(
      "[manhuaViralTemplateStore] 恢复成功但审计副本同步失败:",
      id,
      e instanceof Error ? e.message : e,
    );
  }
  return restored;
}

export async function approveManhuaViralTemplate(input: {
  id?: string;
  /** @deprecated 审查收紧（2026-08-10）：客户端完整卡不再被信任，只按 id 读落盘提案 */
  card?: unknown;
}): Promise<ManhuaViralTemplateCard> {
  /**
   * 批准也要占同一把锁：它会铸 publicCode、会改变「同赛道有几张」，
   * 与下架/恢复读的是同一份状态。三者互斥才谈得上「最后一张」这道门。
   */
  const release = await acquireManhuaTemplateLifecycleLock();
  try {
    return await approveManhuaViralTemplateLocked(input);
  } finally {
    await release().catch((error) => {
      console.error("[manhuaTemplateLifecycle] release lock failed", error);
    });
  }
}

async function approveManhuaViralTemplateLocked(input: {
  id?: string;
  card?: unknown;
}): Promise<ManhuaViralTemplateCard> {
  const id = String(
    input.id || (parseManhuaViralTemplateCard(input.card)?.id ?? "") || "",
  ).trim();
  if (!id) throw new Error("找不到可批准的提案（请提供提案 id）");
  // 只信落盘：防止凭内存/客户端构造一份从未真实学成的卡片直接入库
  const card = await getGcsManhuaViralProposal(id);
  if (!card) throw new Error("提案文件不存在或已失效，请重新学习后再批准");
  if (card.status !== "proposed") {
    throw new Error("该提案不是待审状态（可能已批准入库），无需重复批准");
  }

  if (card.revision) {
    const original = await getGcsManhuaViralApproved(card.revision.parentTemplateId);
    if (!original || original.status !== "approved") {
      throw new Error("待替换的原正式模板不存在，已停止批准");
    }
    const now = new Date().toISOString();
    const replacement = parseManhuaViralTemplateCard({
      ...card,
      id: original.id,
      status: "approved",
      publicCode: original.publicCode,
      sourceRefs: original.sourceRefs,
      provenance: original.provenance,
      revision: undefined,
      approvedAt: original.approvedAt || now,
      updatedAt: now,
    });
    if (!replacement || replacement.status !== "approved") {
      throw new Error("模板修订替换校验失败");
    }

    // 先归档旧正式版；归档成功、正式替换失败时，approved/ 仍保留旧版，可安全重试。
    const archiveStamp = now.replace(/[^0-9]/g, "").slice(0, 17);
    await uploadBufferToGcs({
      objectName: `${MANHUA_VIRAL_ARCHIVE_PREFIX}${original.id}/${archiveStamp}.json`,
      buffer: Buffer.from(`${JSON.stringify(original, null, 2)}\n`, "utf8"),
      contentType: "application/json",
    });
    await uploadBufferToGcs({
      objectName: `${MANHUA_VIRAL_APPROVED_PREFIX}${original.id}.json`,
      buffer: Buffer.from(`${JSON.stringify(replacement, null, 2)}\n`, "utf8"),
      contentType: "application/json",
    });
    try {
      const auditProposal = parseManhuaViralTemplateCard({
        ...card,
        status: "approved",
        publicCode: original.publicCode,
        approvedAt: now,
        updatedAt: now,
      });
      if (auditProposal) {
        await uploadBufferToGcs({
          objectName: `${MANHUA_VIRAL_PROPOSALS_PREFIX}${card.id}.json`,
          buffer: Buffer.from(`${JSON.stringify(auditProposal, null, 2)}\n`, "utf8"),
          contentType: "application/json",
        });
      }
    } catch (e) {
      console.warn(
        "[manhuaViralTemplateStore] sync approved revision audit failed:",
        e instanceof Error ? e.message : e,
      );
    }
    return replacement;
  }

  /**
   * 已经持有全局锁了，就该在锁内用**严格全量**定这两件事，
   * 而不是再去调基于宽松读取的 mintUniqueTemplatePublicCode()——
   * 那个在列举失败时会拿到空的 taken 集合，铸出**重复的公开码**，
   * 而公开码是普通用户唯一可见的模板句柄，重了就分不清。
   */
  const approvedNow = await listGcsManhuaViralApprovedStrict();

  // 非修订流程不许顶掉现役卡：要替换请走修订（上面那条分支）
  if (approvedNow.some((item) => item.id === card.id)) {
    throw new Error("同 id 正式模板已存在，请通过修订流程替换");
  }

  const takenCodes = new Set(
    approvedNow
      .map((item) => String(item.publicCode || "").trim().toUpperCase())
      .filter(Boolean),
  );
  const requestedCode = String(card.publicCode || "").trim().toUpperCase();
  const publicCode = requestedCode && !takenCodes.has(requestedCode)
    ? requestedCode
    : mintUniqueTemplatePublicCodeFromTaken(takenCodes);

  const approved: ManhuaViralTemplateCard = {
    ...card,
    status: "approved",
    publicCode,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const validated = parseManhuaViralTemplateCard(approved);
  if (!validated || validated.status !== "approved") {
    throw new Error("批准后校验失败");
  }

  const body = `${JSON.stringify(validated, null, 2)}\n`;
  await uploadBufferToGcs({
    objectName: `${MANHUA_VIRAL_APPROVED_PREFIX}${validated.id}.json`,
    buffer: Buffer.from(body, "utf8"),
    contentType: "application/json",
  });
  try {
    await uploadBufferToGcs({
      objectName: `${MANHUA_VIRAL_PROPOSALS_PREFIX}${validated.id}.json`,
      buffer: Buffer.from(body, "utf8"),
      contentType: "application/json",
    });
  } catch (e) {
    console.warn(
      "[manhuaViralTemplateStore] sync proposal status failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return validated;
}
