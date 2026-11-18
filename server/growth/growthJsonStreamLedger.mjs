// history-ledger 共用逻辑（纯 .mjs）：服务端 trendStore 与冷备 runner 脚本 import 同一份代码，
// 保证流式读取与合并规则线上、备份资产、恢复三处一致。
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

/** 增量 JSON 游标：只切出单个值的原文交给 JSON.parse，不拼整份文件。 */
class GrowthJsonCursor {
  buf = "";
  pos = 0;
  ended = false;
  /** @param {AsyncIterator<unknown>} source */
  constructor(source) { this.source = source; }

  async fill() {
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

  async expect(ch) {
    const next = await this.peek();
    if (next !== ch) throw new Error(`growth_json_stream_unexpected:${JSON.stringify(next)}!=${JSON.stringify(ch)}`);
    this.pos++;
  }

  /** 读出一个完整 JSON 值的原文（字符串/对象/数组/原子值），跨块拼接。 */
  async rawValue() {
    if (!(await this.peek())) throw new Error("growth_json_stream_truncated");
    const parts = [];
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
    const key = JSON.parse(await this.rawValue());
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
export async function readGrowthJsonItemsStream(file, options) {
  const input = createReadStream(file);
  const stream = options.gzip ? input.pipe(createGunzip()) : input;
  if (options.gzip) input.on("error", error => stream.destroy(error));
  stream.setEncoding("utf8");
  const cursor = new GrowthJsonCursor(stream[Symbol.asyncIterator]());
  const fields = {};
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

/** 与 server/growth/trendNormalize.ts normalizeStringList 同语义（测试钉住两者输出一致）。 */
export function normalizeLedgerLabels(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
  }
  if (typeof value === "string") {
    return Array.from(new Set(value.split(/[|,]/).map((item) => item.trim()).filter(Boolean)));
  }
  return [];
}

/**
 * 账本按键合并（并集）：remote 有而 local 无的直接加入；同键时 bucket 取 remote 优先，
 * 标签取并集，firstSeenAt 取更早、lastSeenAt 取更晚。线上 .json/.json.gz 并存读取与冷备资产合并共用此函数。
 */
export function mergeHistoryLedgerEntries(local, remote) {
  const merged = { ...local };
  for (const [key, entry] of Object.entries(remote)) {
    const current = merged[key];
    if (!current) {
      merged[key] = entry;
      continue;
    }
    merged[key] = {
      ...current,
      bucket: entry.bucket || current.bucket,
      industryLabels: normalizeLedgerLabels([...(current.industryLabels || []), ...(entry.industryLabels || [])]),
      ageLabels: normalizeLedgerLabels([...(current.ageLabels || []), ...(entry.ageLabels || [])]),
      contentLabels: normalizeLedgerLabels([...(current.contentLabels || []), ...(entry.contentLabels || [])]),
      firstSeenAt: current.firstSeenAt < entry.firstSeenAt ? current.firstSeenAt : entry.firstSeenAt,
      lastSeenAt: current.lastSeenAt > entry.lastSeenAt ? current.lastSeenAt : entry.lastSeenAt,
    };
  }
  return merged;
}
