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
    } else if (key === "items" && item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype
      && typeof (item as { toJSON?: unknown }).toJSON !== "function") {
      // history-ledger 的 items 是按键索引的对象；逐条序列化，避免整份账本拼成一个超长字符串。
      yield "{";
      let chunk = "";
      let entrySeparator = "";
      for (const [entryKey, entry] of Object.entries(item)) {
        const encoded = JSON.stringify(entry);
        if (encoded === undefined) continue;
        chunk += entrySeparator + JSON.stringify(entryKey) + ":" + encoded;
        entrySeparator = ",";
        if (chunk.length >= 64 * 1024) { yield chunk; chunk = ""; }
      }
      if (chunk) yield chunk;
      yield "}";
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

export async function writeGrowthGzipJson(plainPath: string, value: unknown, options?: { keepPlain?: boolean }) {
  const gzPath = `${plainPath}.gz`;
  const tempPath = `${gzPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.next`;
  try {
    await pipeline(Readable.from(growthJsonChunks(value)), createGzip({ level: 6 }), createWriteStream(tempPath, { flags: "wx" }));
    await rename(tempPath, gzPath);
    // keepPlain：调用方需先回读校验新 .gz 再自行删除旧 .json（history-ledger 迁移）。
    if (!options?.keepPlain) await rm(plainPath, { force: true });
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

/** 增量 JSON 游标：只切出单个值的原文交给 JSON.parse，不拼整份文件。 */
class GrowthJsonCursor {
  private buf = "";
  private pos = 0;
  private ended = false;
  constructor(private readonly source: AsyncIterator<unknown>) {}

  private async fill() {
    while (this.pos >= this.buf.length) {
      if (this.ended) return false;
      const next = await this.source.next();
      if (next.done) { this.ended = true; return false; }
      this.buf = String(next.value);
      this.pos = 0;
    }
    return true;
  }

  /** 跳过空白后返回下一个字符；文件结束返回空串。 */
  async peek() {
    for (;;) {
      if (!(await this.fill())) return "";
      while (this.pos < this.buf.length) {
        const c = this.buf.charCodeAt(this.pos);
        if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0xfeff) this.pos++;
        else return this.buf[this.pos];
      }
    }
  }

  async expect(ch: string) {
    const next = await this.peek();
    if (next !== ch) throw new Error(`growth_json_stream_unexpected:${JSON.stringify(next)}!=${JSON.stringify(ch)}`);
    this.pos++;
  }

  /** 读出一个完整 JSON 值的原文（字符串/对象/数组/原子值），跨块拼接。 */
  async rawValue() {
    if (!(await this.peek())) throw new Error("growth_json_stream_truncated");
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (;;) {
      const buf = this.buf;
      const start = this.pos;
      for (let i = start; i < buf.length; i++) {
        const c = buf.charCodeAt(i);
        if (inString) {
          if (escaped) escaped = false;
          else if (c === 0x5c) escaped = true;
          else if (c === 0x22) {
            inString = false;
            if (depth === 0) { parts.push(buf.slice(start, i + 1)); this.pos = i + 1; return parts.join(""); }
          }
          continue;
        }
        if (c === 0x22) { inString = true; continue; }
        if (c === 0x7b || c === 0x5b) { depth++; continue; }
        if (c === 0x7d || c === 0x5d) {
          if (depth === 0) { parts.push(buf.slice(start, i)); this.pos = i; return parts.join(""); }
          depth--;
          if (depth === 0) { parts.push(buf.slice(start, i + 1)); this.pos = i + 1; return parts.join(""); }
          continue;
        }
        if (depth === 0 && (c === 0x2c || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09)) {
          parts.push(buf.slice(start, i)); this.pos = i; return parts.join("");
        }
      }
      parts.push(buf.slice(start));
      this.pos = buf.length;
      if (!(await this.fill())) throw new Error("growth_json_stream_truncated");
    }
  }

  async key() {
    if ((await this.peek()) !== "\"") throw new Error("growth_json_stream_key_expected");
    const key = JSON.parse(await this.rawValue()) as string;
    await this.expect(":");
    return key;
  }

  skip() { this.pos++; }
}

/**
 * 流式读取顶层对象：`items`（对象或数组）逐条回调 onItem，其余顶层字段原样返回。
 * 兼容缩进与紧凑 JSON、.json 与 .json.gz；任何截断/语法错误/读失败都抛错（ENOENT 保留 code）。
 * 返回值里 `itemCount` 为回调条数，`hasItems` 表示文件里确有 items 容器。
 */
export async function readGrowthJsonItemsStream(
  file: string,
  options: { gzip: boolean; onItem: (key: string, value: unknown) => void },
): Promise<{ fields: Record<string, unknown>; itemCount: number; hasItems: boolean }> {
  const input = createReadStream(file);
  const stream = options.gzip ? input.pipe(createGunzip()) : input;
  if (options.gzip) input.on("error", error => stream.destroy(error));
  stream.setEncoding("utf8");
  const cursor = new GrowthJsonCursor(stream[Symbol.asyncIterator]());
  const fields: Record<string, unknown> = {};
  let itemCount = 0;
  let hasItems = false;
  try {
    await cursor.expect("{");
    if ((await cursor.peek()) === "}") cursor.skip();
    else for (;;) {
      const key = await cursor.key();
      const open = await cursor.peek();
      if (key === "items" && (open === "{" || open === "[")) {
        hasItems = true;
        const close = open === "{" ? "}" : "]";
        cursor.skip();
        if ((await cursor.peek()) === close) cursor.skip();
        else for (let index = 0; ; index++) {
          const itemKey = open === "{" ? await cursor.key() : String(index);
          options.onItem(itemKey, JSON.parse(await cursor.rawValue()));
          itemCount++;
          const separator = await cursor.peek();
          if (separator === ",") { cursor.skip(); continue; }
          if (separator === close) { cursor.skip(); break; }
          throw new Error("growth_json_stream_items_separator");
        }
      } else {
        fields[key] = JSON.parse(await cursor.rawValue());
      }
      const separator = await cursor.peek();
      if (separator === ",") { cursor.skip(); continue; }
      if (separator === "}") { cursor.skip(); break; }
      throw new Error("growth_json_stream_object_separator");
    }
    if ((await cursor.peek()) !== "") throw new Error("growth_json_stream_trailing_data");
  } finally { input.destroy(); stream.destroy(); }
  return { fields, itemCount, hasItems };
}

export async function mapGrowthSequential<T, R>(values: readonly T[], run: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (const value of values) result.push(await run(value));
  return result;
}
