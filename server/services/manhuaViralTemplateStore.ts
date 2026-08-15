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
  downloadGcsObject,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
} from "./gcs.js";

export const MANHUA_VIRAL_PROPOSALS_PREFIX = "manhua-template-learn/proposals/";
export const MANHUA_VIRAL_APPROVED_PREFIX = "manhua-template-learn/approved/";

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
  if (!/^mt_[a-z0-9]{4,8}$/.test(key)) return null;
  const all = await listMergedApprovedManhuaViralTemplates();
  return all.find((c) => c.publicCode && makePublicTemplateId(c.publicCode) === key) || null;
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
  if (/^mt_[a-z0-9]{4,8}$/i.test(key)) {
    card = await getMergedManhuaViralTemplateByPublicId(key.toLowerCase());
  } else if (/^tpl_[a-z0-9_-]{1,60}$/i.test(key)) {
    card = await getMergedManhuaViralTemplate(key);
  } else {
    return { error: "bad_id" };
  }
  if (!card || card.status !== "approved") return { error: "not_found" };
  const code = String(card.publicCode || "").trim();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return { error: "no_public_code" };
  const { makeAnonymousTemplateNameZh } = await import("../../shared/manhuaViralTemplateBank.js");
  return {
    card,
    appliedTemplate: {
      publicId: makePublicTemplateId(code),
      nameZh: makeAnonymousTemplateNameZh(card.laneZh, code),
    },
  };
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
