/** 测试夹具：自造最小合法 GLB 2.0（JSON chunk + 可选 BIN chunk，4 字节对齐）。只给测试用，不是生成器。 */
export function buildGlb(doc: Record<string, unknown>, payload = Buffer.alloc(0)): Buffer {
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadded = Math.ceil(json.byteLength / 4) * 4;
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const jsonChunk = Buffer.concat([jsonHeader, json, Buffer.alloc(jsonPadded - json.byteLength, 0x20)]);
  let body = jsonChunk;
  if (payload.byteLength) {
    const binPadded = Math.ceil(payload.byteLength / 4) * 4;
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binPadded, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    body = Buffer.concat([jsonChunk, binHeader, payload, Buffer.alloc(binPadded - payload.byteLength)]);
  }
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.byteLength, 8);
  return Buffer.concat([header, body]);
}
