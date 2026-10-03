import type JSZip from "jszip";

/** Read bounded entries only; illustrations never get inflated or sent to a model. */
export async function readDocumentZipText(file: JSZip.JSZipObject | null, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (!file) throw new Error("文件缺少章节或正文，未导入；当前原文保留。");
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let bytes = 0; let failed = false;
    // JSZip implements this in zipObject.js; its shipped declarations only expose the generator variant.
    const stream = (file as JSZip.JSZipObject & { internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream("uint8array");
    stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { failed = true; stream.pause(); reject(new Error("文件中的文本部分过大，请分卷导入；当前原文保留。")); return; }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (failed) return;
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
      try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(joined)); }
      catch { reject(new Error("文件文字编码无法完整读取，请转换为 UTF-8 后导入。")); }
    });
    stream.resume();
  });
}

