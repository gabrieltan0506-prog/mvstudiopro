/**
 * 四選題「套裝」預付：一筆扣清積分（128 / 198），後續四次入隊依 creationId 核銷，不再按次分拆計價。
 */
import { and, eq } from "drizzle-orm";

import { userCreations } from "../../drizzle/schema-creations.js";

export type AppDrizzleDb = NonNullable<Awaited<ReturnType<typeof import("../db.js").getDb>>>;

export const PLATFORM_BULK_FOUR_COVER_PACK_PREPAY = "platform_bulk_four_cover_pack_prepay";
export const PLATFORM_BULK_FOUR_COMPOSITE_PACK_PREPAY = "platform_bulk_four_composite_pack_prepay";

export type BulkFourPackKind = "cover" | "composite";

type PrepayMetadata = {
  v: 1;
  sceneIds: [string, string, string, string];
  consumedSceneIds: string[];
};

function parsePrepayMetadata(raw: string | null | undefined): PrepayMetadata | null {
  try {
    const o = JSON.parse(String(raw || "{}")) as PrepayMetadata;
    if (o?.v !== 1 || !Array.isArray(o.sceneIds) || o.sceneIds.length !== 4) return null;
    if (!Array.isArray(o.consumedSceneIds)) return null;
    return o;
  } catch {
    return null;
  }
}

const prepayTypeForKind = (kind: BulkFourPackKind) =>
  kind === "cover" ? PLATFORM_BULK_FOUR_COVER_PACK_PREPAY : PLATFORM_BULK_FOUR_COMPOSITE_PACK_PREPAY;

export async function insertBulkFourPackPrepayRow(params: {
  database: AppDrizzleDb;
  userId: number;
  kind: BulkFourPackKind;
  sceneIds: [string, string, string, string];
  creditsCharged: number;
}): Promise<number> {
  const meta: PrepayMetadata = { v: 1, sceneIds: params.sceneIds, consumedSceneIds: [] };
  const [row] = await params.database
    .insert(userCreations)
    .values({
      userId: params.userId,
      type: prepayTypeForKind(params.kind),
      title:
        params.kind === "cover"
          ? "四条竖版封面套裝（预付）"
          : "四条 2×4 分镜套裝（预付）",
      status: "completed",
      creditsUsed: params.creditsCharged,
      metadata: JSON.stringify(meta),
    })
    .returning({ id: userCreations.id });
  if (row?.id == null) {
    throw new Error("insertBulkFourPackPrepayRow: missing id");
  }
  return row.id;
}

/**
 * 核銷一題：通過則本題入隊應扣 **0** 分（套裝费已在预付时扣清）。
 */
export async function consumeBulkFourPackPrepayForScene(params: {
  database: AppDrizzleDb;
  userId: number;
  prepayCreationId: number;
  sceneId: string;
  kind: BulkFourPackKind;
}): Promise<void> {
  const sid = String(params.sceneId ?? "").trim();
  if (!sid) throw new Error("consumeBulkFourPackPrepayForScene: empty sceneId");

  const [row] = await params.database
    .select({
      id: userCreations.id,
      userId: userCreations.userId,
      type: userCreations.type,
      metadata: userCreations.metadata,
    })
    .from(userCreations)
    .where(
      and(
        eq(userCreations.id, params.prepayCreationId),
        eq(userCreations.userId, params.userId),
        eq(userCreations.type, prepayTypeForKind(params.kind)),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("套裝预付记录无效或已失效，请重新开始批量任务");
  }

  const meta = parsePrepayMetadata(row.metadata);
  if (!meta) {
    throw new Error("套裝预付记录损坏，请重新开始批量任务");
  }

  if (!meta.sceneIds.includes(sid)) {
    throw new Error("当前选题不在本套裝预付范围内");
  }

  if (meta.consumedSceneIds.includes(sid)) {
    throw new Error("该选题已核銷过一次套裝额度，请勿重复入队");
  }

  if (meta.consumedSceneIds.length >= 4) {
    throw new Error("本套裝四题已全部核銷");
  }

  const next: PrepayMetadata = {
    ...meta,
    consumedSceneIds: [...meta.consumedSceneIds, sid],
  };

  await params.database
    .update(userCreations)
    .set({
      metadata: JSON.stringify(next),
      updatedAt: new Date(),
    })
    .where(eq(userCreations.id, params.prepayCreationId));
}
