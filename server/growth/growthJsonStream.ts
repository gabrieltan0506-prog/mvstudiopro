import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

/** Growth DTO 的大数组固定在 items 或 collection.items；其余元数据保持 JSON.stringify 语义。 */
export function* growthJsonChunks(value: unknown): Generator<string> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("growth_json_value_undefined");
    yield encoded;
    return;
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    yield JSON.stringify(value);
    return;
  }
  yield "{";
  let separator = "";
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    yield separator + JSON.stringify(key) + ":";
    separator = ",";
    if (key === "items" && Array.isArray(item)) {
      yield "[";
      let chunk = "";
      for (let i = 0; i < item.length; i++) {
        chunk += (i ? "," : "") + (JSON.stringify(item[i]) ?? "null");
        if (chunk.length >= 64 * 1024) { yield chunk; chunk = ""; }
      }
      if (chunk) yield chunk;
      yield "]";
    } else if (key === "collection" && item && typeof item === "object") {
      const nested = growthJsonChunks(item);
      for (let next = nested.next(); !next.done; next = nested.next()) yield next.value;
    } else {
      yield JSON.stringify(item);
    }
  }
  yield "}";
}

/** 不同时保留完整压缩 Buffer 和解压 Buffer，字符串仅用于标准 JSON.parse。 */
export async function readGrowthGzipJson<T>(file: string): Promise<T> {
  const input = createReadStream(file);
  const stream = input.pipe(createGunzip());
  input.on("error", error => stream.destroy(error));
  const chunks: string[] = [];
  stream.setEncoding("utf8");
  // pipe 不会自动转发源读取失败，必须销毁解压流，使 ENOENT 等错误能正确回退。
  try {
    for await (const chunk of stream) chunks.push(String(chunk));
  } finally { input.destroy(); stream.destroy(); }
  return JSON.parse(chunks.join("")) as T;
}

export async function writeGrowthGzipJson(plainPath: string, value: unknown) {
  const gzPath = `${plainPath}.gz`;
  const tempPath = `${gzPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.next`;
  try {
    await pipeline(Readable.from(growthJsonChunks(value)), createGzip({ level: 6 }), createWriteStream(tempPath, { flags: "wx" }));
    await rename(tempPath, gzPath);
    await rm(plainPath, { force: true });
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

export async function mapGrowthSequential<T, R>(values: readonly T[], run: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (const value of values) result.push(await run(value));
  return result;
}
