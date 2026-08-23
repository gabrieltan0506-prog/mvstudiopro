/**
 * 漫剧节奏模板动态库（GCS）。
 * proposals/ = 待审；approved/ = 人审通过。产品列表 = GCS approved
 * （出厂种子 2026-08-10 已清空，shared 库只剩合并逻辑，见 manhuaViralTemplateBank.ts 文件头）。
 */
import { randomBytes } from "node:crypto";
import {
  getManhuaViralTemplate,
  listApprovedManhuaViralTemplates,
  listApprovedManhuaViralTemplatesGrouped,
  makePublicTemplateId,
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
} from "../../shared/manhuaViralTemplateBank.js";
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
  const cards = await listCardsUnderPrefix(MANHUA_VIRAL_PROPOSALS_PREFIX);
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

  const bucket = getGcsBucketName();
  const objectName = `${MANHUA_VIRAL_APPROVED_PREFIX}${key}.json`;

  // 取内容的同时拿到 generation：后面删除只删这一版，
  // 期间若有人批准了新版本，条件删除会 412 而不是把新版本毁掉
  let versioned: { buffer: Buffer; generation: string };
  try {
    versioned = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
  } catch {
    throw new Error("正式模板不存在或已下架");
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

export async function approveManhuaViralTemplate(input: {
  id?: string;
  /** @deprecated 审查收紧（2026-08-10）：客户端完整卡不再被信任，只按 id 读落盘提案 */
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

  const approved: ManhuaViralTemplateCard = {
    ...card,
    status: "approved",
    publicCode: card.publicCode || (await mintUniqueTemplatePublicCode()),
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
