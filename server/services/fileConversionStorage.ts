import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, link, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import type { FileConversionSource } from "../../shared/fileConversion";
import { statGcsObjectVersion, getGcsBucketName, inspectGcsObjectBounded, uploadBufferToGcsIfAbsent } from "./gcs";
import { resolveJobWorkerRole } from "../jobs/workerRole";
import { listFlyMachines, resolveFlyMachinesConfig } from "./flyMachines";
import { artEvidenceSignature } from "./artMotionEvidence";
export const CONVERSION_STORE_ROUTE = "/api/internal/file-conversion-storage";
const ROOT = "/data/growth/file-conversion";
export const conversionSha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export type ConversionObject = { userId: string; objectName: string; taskId?: string; bytes?: number; sha256?: string };
export function assertConversionObject(input: ConversionObject) {
  if (!/^[1-9]\d*$/.test(input.userId) || !input.objectName.startsWith(`file-conversion/u${input.userId}/`)
    || !/^[a-zA-Z0-9/_.-]+$/.test(input.objectName) || input.objectName.split("/").some(p => !p || p === "." || p === "..")
    || !(input.objectName.includes("/sources/") || input.taskId && input.objectName.startsWith(`file-conversion/u${input.userId}/results/${input.taskId}/`)
      || input.taskId && input.objectName === `file-conversion/u${input.userId}/receipts/${input.taskId}.json`)) throw new Error("文件存储归属无效");
}
export async function assertConversionWebsiteVolume() {
  if (resolveJobWorkerRole() !== "app") throw new Error("文件持久化只能写网站机/data");
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  if (!mounts.split("\n").some(row => row.split(" ")[4] === "/data")) throw new Error("网站持久卷不可用");
}
/** 不可覆盖、原子落盘；测试只注入独立临时目录。 */
export async function writeConversionWebsite(input: ConversionObject, data: Buffer, root = ROOT) {
  assertConversionObject(input);
  if (data.length !== input.bytes || conversionSha(data) !== input.sha256) throw new Error("文件大小或SHA不符");
  const destination = path.join(root, input.objectName), directory = path.dirname(destination);
  await mkdir(directory, { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`, handle = await open(temporary, "wx");
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  try { await link(temporary, destination); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = await readFile(destination);
    if (!previous.equals(data)) throw new Error("文件已存在且内容不同，保留原件");
  } finally { await unlink(temporary); }
  const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
}
export async function readConversionWebsite(input: ConversionObject, root = ROOT) {
  assertConversionObject(input);
  return readFile(path.join(root, input.objectName));
}
async function bridge(input: ConversionObject, data?: Buffer, signal?: AbortSignal): Promise<Buffer> {
  assertConversionObject(input);
  if (resolveJobWorkerRole() === "app") {
    await assertConversionWebsiteVolume();
    if (data) { await writeConversionWebsite(input, data); return Buffer.alloc(0); }
    return readConversionWebsite(input);
  }
  const config = resolveFlyMachinesConfig(), secret = process.env.JWT_SECRET || "";
  if (!config || secret.length < 24) throw new Error("网站文件降级桥未配置");
  const sites = (await listFlyMachines(config)).filter(m => m.state === "started" && m.processGroup === "app" && m.id !== process.env.MANHUA_HEAVY_MACHINE_ID);
  if (sites.length !== 1) throw new Error("无法确认唯一网站机");
  const body = Buffer.from(JSON.stringify(input)), timestamp = String(Date.now());
  const response = await fetch(`https://${config.appName}.fly.dev${CONVERSION_STORE_ROUTE}`, { method: data ? "PUT" : "POST",
    headers: { "Content-Type": "application/octet-stream", "Fly-Force-Instance-Id": sites[0].id,
      "X-Conversion-Metadata": body.toString("base64"), "X-Art-Evidence-Time": timestamp,
      "X-Art-Evidence-Signature": artEvidenceSignature(secret, timestamp, body) },
    body: new Uint8Array(data || body), redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`网站文件降级不可用:${response.status}`);
  if (data) {
    const receipt = await response.json() as { bytes: number; sha256: string };
    if (receipt.bytes !== input.bytes || receipt.sha256 !== input.sha256) throw new Error("网站文件回执不符");
    return Buffer.alloc(0);
  }
  return Buffer.from(await response.arrayBuffer());
}
export async function saveConversionObject(input: ConversionObject, data: Buffer, contentType: string, signal?: AbortSignal) {
  assertConversionObject(input); signal?.throwIfAborted();
  const verified = { ...input, bytes: data.length, sha256: conversionSha(data) };
  const operationSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  let stored: Awaited<ReturnType<typeof uploadBufferToGcsIfAbsent>>;
  try { stored = await uploadBufferToGcsIfAbsent({ objectName: input.objectName, buffer: data, contentType, signal: operationSignal }); }
  catch (error) { signal?.throwIfAborted(); await bridge(verified, data, signal); return { storage: "website_data" as const, generation: "1" }; }
  // 既存对象必须同SHA，冲突不能通过降级另写来掩盖。
  if (!stored.created) {
    const buffer = await readGcsConversionObject(verified, signal);
    if (!buffer.equals(data)) throw new Error("GCS文件已存在且内容不同，保留原件");
  }
  if (stored.generation) return { storage: "gcs" as const, generation: stored.generation };
  try {
    const { generation } = await statGcsObjectVersion({ gcsUri: `gs://${getGcsBucketName()}/${input.objectName}`, signal: operationSignal });
    return { storage: "gcs" as const, generation };
  } catch {
    // 已成功写入的同一内容仍可降级；不伪造GCS版本，也不覆盖原对象。
    signal?.throwIfAborted(); await bridge(verified, data, signal);
    return { storage: "website_data" as const, generation: "1" };
  }
}
export async function readConversionSource(userId: string, source: FileConversionSource, options: Omit<Parameters<typeof inspectGcsObjectBounded>[0], "gcsUri" | "generation">) {
  assertConversionObject({ userId, objectName: source.objectName });
  if (source.storage !== "website_data") {
    let checked: Awaited<ReturnType<typeof inspectGcsObjectBounded>>;
    const chunks: Buffer[] = [];
    try { checked = await inspectGcsObjectBounded({ ...options, onChunk: chunk => chunks.push(Buffer.from(chunk)), gcsUri: `gs://${getGcsBucketName()}/${source.objectName}`, generation: source.generation }); }
    catch (error) { options.signal?.throwIfAborted(); return checkWebsite(); }
    if (checked.byteLength !== source.bytes || source.sha256 && checked.sha256 !== source.sha256) throw new Error("原文件大小或SHA已变化");
    for (const chunk of chunks) options.onChunk?.(chunk);
    return checked;
  }
  return checkWebsite();
  async function checkWebsite() {
    const buffer = await bridge({ userId, objectName: source.objectName }, undefined, options.signal);
    if (buffer.length > options.maxBytes || buffer.length !== source.bytes || source.sha256 && conversionSha(buffer) !== source.sha256) throw new Error("网站原文件大小或SHA不符");
    options.onChunk?.(buffer);
    return { byteLength: buffer.length, sha256: conversionSha(buffer), header: buffer.subarray(0,12), objectName: source.objectName, bucket: "website_data", generation: source.generation };
  }
}
async function readGcsConversionObject(input: ConversionObject, signal?: AbortSignal) {
  const chunks: Buffer[] = [];
  await inspectGcsObjectBounded({ gcsUri: `gs://${getGcsBucketName()}/${input.objectName}`, maxBytes: input.bytes || 16*1024*1024,
    signal, timeoutMs: 30_000, onChunk: chunk => chunks.push(Buffer.from(chunk)) });
  return Buffer.concat(chunks);
}
export async function readConversionObject(input: ConversionObject & { storage?: "gcs" | "website_data" }, signal?: AbortSignal) {
  assertConversionObject(input);
  let buffer: Buffer;
  if (input.storage === "website_data") buffer = await bridge(input, undefined, signal);
  else {
    try { buffer = await readGcsConversionObject(input, signal); }
    catch { signal?.throwIfAborted(); buffer = await bridge(input, undefined, signal); }
  }
  if (input.bytes !== undefined && buffer.length !== input.bytes || input.sha256 && conversionSha(buffer) !== input.sha256) throw new Error("文件存储大小或SHA不符");
  return buffer;
}
const receiptObject = (id: string, userId: string) => ({ userId, taskId: id, objectName: `file-conversion/u${userId}/receipts/${id}.json` });
export async function saveConversionReceipt(id: string, userId: string, result: unknown, signal?: AbortSignal) {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const normalized = canonical(result), resultBytes = Buffer.from(JSON.stringify(normalized));
  const content = Buffer.from(JSON.stringify({ version: 1, id, userId, bytes: resultBytes.length, sha256: conversionSha(resultBytes), result: normalized }));
  return saveConversionObject(receiptObject(id, userId), content, "application/json", signal);
}
export async function readConversionReceipt(id: string, userId: string, signal?: AbortSignal): Promise<unknown | null> {
  let content: Buffer;
  try { content = await readConversionObject(receiptObject(id, userId), signal); } catch (error) { if (/ENOENT|不可用:404/.test(String(error))) return null; throw error; }
  const receipt = JSON.parse(content.toString("utf8"));
  if (receipt.version !== 1 || receipt.id !== id || receipt.userId !== userId || receipt.bytes !== Buffer.byteLength(JSON.stringify(receipt.result)) || receipt.sha256 !== conversionSha(Buffer.from(JSON.stringify(receipt.result)))) throw new Error("转换回执身份不符");
  return receipt.result;
}
