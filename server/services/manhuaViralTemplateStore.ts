/**
 * 漫剧节奏模板动态库（GCS）。
 * proposals/ = 待审；approved/ = 人审通过。产品列表 = 种子库 ∪ approved（同 id 以 GCS 为准）。
 */
import {
  MANHUA_VIRAL_TEMPLATE_BANK,
  getManhuaViralTemplate,
  listApprovedManhuaViralTemplates,
  listApprovedManhuaViralTemplatesGrouped,
  mergeManhuaViralTemplateBanks,
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
export async function approveManhuaViralTemplate(input: {
  id?: string;
  card?: unknown;
}): Promise<ManhuaViralTemplateCard> {
  let card: ManhuaViralTemplateCard | null = null;
  if (input.card) {
    card = parseManhuaViralTemplateCard(input.card);
  }
  const id = String(input.id || card?.id || "").trim();
  if (!card && id) {
    card = await getGcsManhuaViralProposal(id);
  }
  if (!card && id) {
    // 允许批准种子库已有条目（重写 approvedAt）或仅 id 来自 job 输出里的完整 proposal 字段
    card = getManhuaViralTemplate(id);
  }
  if (!card) throw new Error("找不到可批准的提案（请提供 id 或完整卡片）");

  const approved: ManhuaViralTemplateCard = {
    ...card,
    status: "approved",
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

/** 供单测：纯合并语义（不碰 GCS） */
export function mergeSeedWithApprovedExtrasForTest(
  extras: ManhuaViralTemplateCard[],
): ManhuaViralTemplateCard[] {
  return mergeManhuaViralTemplateBanks(MANHUA_VIRAL_TEMPLATE_BANK, extras).filter(
    (t) => t.status === "approved",
  );
}
