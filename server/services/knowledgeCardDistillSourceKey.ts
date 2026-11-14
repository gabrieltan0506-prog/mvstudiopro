import { createHash } from "node:crypto";

type StatFn = (params: { gcsUri: string; signal?: AbortSignal }) => Promise<{ byteLength?: number; crc32c?: string }>;

export type KnowledgeCardDistillSourceKey = {
  key: string;
  /** content = 字节数 + 存储端 CRC32C；name-size = 存储端没给校验和时退回文件名 + 字节数；text = 粘贴正文哈希 */
  basis: "content" | "name-size" | "text";
};

const sha256 = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/**
 * 读档提炼的「同一份原稿」身份（1114）：两个标签页各自直传，gcsUri 不同，不能按地址比。
 * 文件取存储端对象元数据（字节数 + CRC32C，上传时由存储端算好；只读元数据、不下载正文）；
 * 粘贴正文取 SHA-256。再并上提炼档位 / 成稿档 / 计费口径，任何设置不同都算另一份。
 * 元数据取不到时返回 null：宁可不去重，也不把两份不同的书误并成一单。
 */
export async function knowledgeCardDistillSourceKey(
  input: {
    sourceText: string;
    files?: Array<{ gcsUri: string; mimeType: string; fileName?: string }>;
    distillModel: string;
    detailLevel: string;
    billingPolicy?: string;
    chargeDistillFee: boolean;
  },
  deps: { stat?: StatFn; timeoutMs?: number } = {},
): Promise<KnowledgeCardDistillSourceKey | null> {
  const files = input.files ?? [];
  const text = String(input.sourceText || "").trim();
  if (!files.length && !text) return null;
  let basis: KnowledgeCardDistillSourceKey["basis"] = files.length ? "content" : "text";
  const parts: unknown[] = [];
  if (files.length) {
    const stat = deps.stat ?? (await import("./gcs.js")).statGcsObjectVersion;
    try {
      const metas = await Promise.all(files.map(f => stat({ gcsUri: f.gcsUri, signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000) })));
      for (let i = 0; i < files.length; i++) {
        const size = metas[i]?.byteLength;
        const crc = String(metas[i]?.crc32c || "").trim();
        if (!Number.isFinite(size) || Number(size) <= 0) return null;
        if (crc) parts.push({ mime: files[i].mimeType, size, crc32c: crc });
        else {
          const name = String(files[i].fileName || "").trim();
          if (!name) return null;
          basis = "name-size";
          parts.push({ mime: files[i].mimeType, size, name });
        }
      }
    } catch (error) {
      console.warn(`[knowledgeCardDistillSourceKey] 原稿元数据不可用，本次不做在途去重: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  const key = sha256([
    "kc-distill-source-v1",
    parts,
    text ? sha256(text) : "",
    input.distillModel,
    input.detailLevel,
    input.billingPolicy || "",
    input.chargeDistillFee === true,
  ]);
  return { key, basis };
}
