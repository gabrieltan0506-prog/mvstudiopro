/** 仅用于已有采集库初始化索引：逐条解析 collection.items，不把全量JSON留在内存。 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import type { PlatformTrendCollection, TrendItem } from "./trendCollector";

type Header = { updatedAt: string; collection: Omit<PlatformTrendCollection, "items"> };
export async function streamTrendCollection(file: string, onHeader: (header: Header) => void, onItem: (item: TrendItem) => void, signal: AbortSignal) {
  const input = createReadStream(file, { signal });
  const stream = file.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  input.on("error", error => stream.destroy(error));
  stream.setEncoding("utf8");
  let header = "", started = false, ended = false;
  let item = "", depth = 0, quoted = false, escaped = false;
  let count = 0, tail = "", needsSeparator = false, afterComma = false;
  try {
    for await (const raw of stream) {
      signal.throwIfAborted();
      let chunk = String(raw);
      if (!started) {
        header += chunk;
        const marker = /"items"\s*:\s*\[/.exec(header);
        if (!marker) { if (header.length > 1024 * 1024) throw new Error("采集库索引头过大或缺少items"); continue; }
        // 验证路径确为根对象的collection.items，拒绝字符串内伪标记及别处嵌套items。
        const prefix = header.slice(0, marker.index + marker[0].lastIndexOf("["));
        const parsed = JSON.parse(prefix + "[]}}") as Header;
        if (!parsed.collection || !parsed.collection.platform || !parsed.collection.source) throw new Error("采集库索引头无效");
        onHeader(parsed);
        chunk = header.slice(marker.index + marker[0].length);
        header = ""; started = true;
      }
      if (ended) { tail += chunk; if (tail.length > 8 * 1024 * 1024) throw new Error("采集库尾部过大"); continue; }
      let segment = depth ? 0 : -1;
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (!depth) {
          if (/\s/.test(c)) continue;
          if (c === ",") { if (!needsSeparator || afterComma) throw new Error("采集库items分隔符无效"); needsSeparator = false; afterComma = true; continue; }
          if (c === "]") { if (afterComma) throw new Error("采集库items尾逗号无效"); ended = true; tail = chunk.slice(i); break; }
          if (c !== "{" || needsSeparator) throw new Error("采集库items包含非对象记录或缺分隔符");
          afterComma = false;
          segment = i; depth = 1; quoted = false; escaped = false; continue;
        }
        if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        if (!depth) {
          item += chunk.slice(segment, i + 1);
          if (item.length > 8 * 1024 * 1024) throw new Error("采集库单条记录过大");
          onItem(JSON.parse(item)); count++; needsSeparator = true; item = ""; segment = -1;
        }
      }
      if (depth && segment >= 0) item += chunk.slice(segment);
      if (item.length > 8 * 1024 * 1024) throw new Error("采集库单条记录过大");
    }
    if (!started || !ended || depth) throw new Error("采集库截断，索引未采用");
    // 校验尾部结构和gzip CRC，不能把items完整但根对象截断的文件当作成功。
    JSON.parse('{"collection":{"items":[' + tail);
    return count;
  } finally { input.destroy(); stream.destroy(); }
}
