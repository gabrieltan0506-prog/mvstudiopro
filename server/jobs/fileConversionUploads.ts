import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { conversionDb } from "./fileConversionRepository";
import type { FileConversionSource, FileConversionLane } from "../../shared/fileConversion";
const rows = <T>(value: unknown): T[] => (value as { rows?: T[] }).rows || [];
export type ConversionUpload = { id: string; userId: string; ipHash: string; day: string; objectName: string; fileName: string; formatId: string; bytes: number; lane: FileConversionLane; status: string; source: FileConversionSource | null };
let ready: Promise<void> | undefined;
async function db() {
  const store = await conversionDb();
  if (!ready) ready = store.execute(sql`CREATE TABLE IF NOT EXISTS file_conversion_uploads (
    id uuid PRIMARY KEY, "userId" text NOT NULL,"ipHash" text NOT NULL,day date NOT NULL,"objectName" text UNIQUE NOT NULL,
    "fileName" text NOT NULL,"formatId" text NOT NULL,bytes bigint NOT NULL,lane text NOT NULL,status text NOT NULL DEFAULT 'issued',
    "userSlot" integer NOT NULL,"ipSlot" integer NOT NULL,"userDaySlot" integer,"ipDaySlot" integer,
    source jsonb,"createdAt" timestamptz NOT NULL DEFAULT now(),"expiresAt" timestamptz NOT NULL DEFAULT now()+interval '15 minutes')`).then(() => undefined).catch(error => { ready = undefined; throw error; });
  await ready;
  await store.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS conversion_upload_user_active ON file_conversion_uploads("userId","userSlot") WHERE status IN ('issued','receiving','uploaded')`);
  await store.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS conversion_upload_ip_active ON file_conversion_uploads("ipHash","ipSlot") WHERE status IN ('issued','receiving','uploaded')`);
  await store.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS conversion_upload_user_day ON file_conversion_uploads("userId",day,"userDaySlot")`);
  await store.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS conversion_upload_ip_day ON file_conversion_uploads("ipHash",day,"ipDaySlot")`);
  return store;
}
export async function createConversionUpload(input: Omit<ConversionUpload, "id" | "objectName" | "status" | "source">) {
  const store = await db(), id = randomUUID(), objectName = `file-conversion/u${input.userId}/sources/${id}`;
  // 三个未完成授权；免费每日最多九次上传授权（含失败），约束不进入检查的存储滥用。
  await store.execute(sql`UPDATE file_conversion_uploads SET status='expired' WHERE status='issued' AND "expiresAt"<now()`);
  await store.execute(sql`UPDATE file_conversion_uploads SET status='failed' WHERE status='receiving' AND "createdAt"<now()-interval '30 minutes'`);
  let ticket: ConversionUpload | undefined;
  for (let attempt=0; attempt<4 && !ticket; attempt++) {
    [ticket] = rows<ConversionUpload>(await store.execute(sql`INSERT INTO file_conversion_uploads
      (id,"userId","ipHash",day,"objectName","fileName","formatId",bytes,lane,"userSlot","ipSlot","userDaySlot","ipDaySlot")
      SELECT ${id}::uuid,${input.userId},${input.ipHash},${input.day}::date,${objectName},${input.fileName},${input.formatId},${input.bytes},${input.lane},u.slot,i.slot,ud.slot,id.slot
      FROM (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS(SELECT 1 FROM file_conversion_uploads WHERE "userId"=${input.userId} AND "userSlot"=slot AND status IN ('issued','receiving','uploaded')) ORDER BY slot LIMIT 1) u
      CROSS JOIN (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS(SELECT 1 FROM file_conversion_uploads WHERE "ipHash"=${input.ipHash} AND "ipSlot"=slot AND status IN ('issued','receiving','uploaded')) ORDER BY slot LIMIT 1) i
      CROSS JOIN (SELECT CASE WHEN ${input.lane === "free"} THEN slot ELSE NULL END AS slot FROM generate_series(1,9) slot WHERE ${input.lane !== "free"} OR NOT EXISTS(SELECT 1 FROM file_conversion_uploads WHERE "userId"=${input.userId} AND day=${input.day}::date AND "userDaySlot"=slot) ORDER BY slot LIMIT 1) ud
      CROSS JOIN (SELECT CASE WHEN ${input.lane === "free"} THEN slot ELSE NULL END AS slot FROM generate_series(1,9) slot WHERE ${input.lane !== "free"} OR NOT EXISTS(SELECT 1 FROM file_conversion_uploads WHERE "ipHash"=${input.ipHash} AND day=${input.day}::date AND "ipDaySlot"=slot) ORDER BY slot LIMIT 1) id
      ON CONFLICT DO NOTHING RETURNING *`));
  }
  if (!ticket) throw new Error("上传授权已达上限，请先完成已有文件检查或稍后重试");
  return { objectName, uploadUrl: `/api/file-conversion/upload/${id}`, requiredHeaders: {} };
}
export async function conversionUploadByObject(objectName: string) {
  return rows<ConversionUpload>(await (await db()).execute(sql`SELECT * FROM file_conversion_uploads WHERE "objectName"=${objectName}`))[0] || null;
}
export async function claimConversionUpload(id: string, userId: string): Promise<ConversionUpload | null> {
  return rows<ConversionUpload>(await (await db()).execute(sql`UPDATE file_conversion_uploads SET status='receiving'
    WHERE id=${id}::uuid AND "userId"=${userId} AND status='issued' AND "expiresAt">now() RETURNING *`))[0] || null;
}
export async function finishConversionUpload(ticket: ConversionUpload, source: FileConversionSource | null) {
  await (await db()).execute(sql`UPDATE file_conversion_uploads SET status=${source ? "uploaded" : "failed"},source=${JSON.stringify(source)}::jsonb
    WHERE id=${ticket.id}::uuid AND "userId"=${ticket.userId} AND status='receiving'`);
}
export async function markConversionUploadChecked(objectName: string, userId: string) {
  await (await db()).execute(sql`UPDATE file_conversion_uploads SET status='checked' WHERE "objectName"=${objectName} AND "userId"=${userId} AND status='uploaded'`);
}
