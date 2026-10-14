import { digitalHumanDraftSchema, type DigitalHumanDraft } from "../../shared/digitalHumanStudio";
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcs } from "./gcs";

export class DigitalHumanDraftConflict extends Error {
  constructor() { super("云端数字人稿件已变化，未覆盖；请保留本机副本后读取云端版本"); }
}
const objectName = (owner: number) => {
  if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("需要有效登录账号");
  return `digital-human-drafts/user-${owner}/current.json`;
};
const real = { read: downloadGcsObjectVersioned, write: uploadBufferToGcs };
export async function readDigitalHumanCloudDraft(owner: number, deps = real) {
  const name = objectName(owner);
  try {
    const value = await deps.read({ gcsUri: `gs://${getGcsBucketName()}/${name}` });
    const envelope = JSON.parse(value.buffer.toString("utf8"));
    if (envelope.format !== "digital-human-draft-v1" || envelope.owner !== owner) throw new Error("云端数字人稿件身份无法校验");
    const draft = digitalHumanDraftSchema.parse(envelope.draft);
    if (draft.owner !== String(owner)) throw new Error("云端稿件账号不匹配");
    return { draft, generation: value.generation, updatedAt: String(envelope.updatedAt) };
  } catch (e) {
    if (e instanceof Error && e.message === "gcs_stat_failed:404") return { draft: null, generation: "0", updatedAt: null };
    throw e;
  }
}
export async function writeDigitalHumanCloudDraft(owner: number, raw: DigitalHumanDraft, generation: string, deps = real) {
  const draft = digitalHumanDraftSchema.parse(raw);
  if (draft.owner !== String(owner)) throw new Error("稿件账号不匹配，未写入");
  if (!/^\d+$/.test(generation)) throw new DigitalHumanDraftConflict();
  const updatedAt = new Date().toISOString();
  const buffer = Buffer.from(JSON.stringify({ format: "digital-human-draft-v1", owner, updatedAt, draft }));
  if (buffer.length > 8 * 1024 * 1024) throw new Error("数字人稿件超过8MB，未截断或覆盖");
  try {
    const result = await deps.write({ objectName: objectName(owner), buffer, contentType: "application/json", ifGenerationMatch: generation });
    if (!result.generation) throw new Error("云端保存缺少版本回执，请查询原稿");
    return { generation: result.generation, updatedAt };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("gcs_upload_failed:412:")) throw new DigitalHumanDraftConflict();
    throw e;
  }
}
