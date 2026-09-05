import { describe, expect, it } from "vitest";
import { assertValidGlb2, Glb2StreamValidator } from "./glbValidation.js";

function chunk(type: number, body: Buffer): Buffer {
  const paddedLength = Math.ceil(body.byteLength / 4) * 4;
  const header = Buffer.alloc(8);
  header.writeUInt32LE(paddedLength, 0);
  header.writeUInt32LE(type, 4);
  return Buffer.concat([header, body, Buffer.alloc(paddedLength - body.byteLength, 0x20)]);
}

function validGlb(bin = Buffer.alloc(0)): Buffer {
  const parts = [chunk(0x4e4f534a, Buffer.from('{"asset":{"version":"2.0"}}'))];
  if (bin.byteLength) parts.push(chunk(0x004e4942, bin));
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.byteLength + body.byteLength, 8);
  return Buffer.concat([header, body]);
}

describe("GLB 2.0 结构验真", () => {
  it("跨任意流分块验证 JSON 与 BIN chunk", () => {
    const glb = validGlb(Buffer.from([1, 2, 3, 4]));
    const validator = new Glb2StreamValidator();
    for (let offset = 0; offset < glb.byteLength; offset += 3) {
      validator.push(glb.subarray(offset, offset + 3));
    }
    expect(() => validator.finish()).not.toThrow();
    expect(() => assertValidGlb2(glb)).not.toThrow();
  });

  it.each([
    ["缺 JSON chunk", (() => { const b = validGlb(); b.writeUInt32LE(0x004e4942, 16); return b; })()],
    ["JSON 无效", (() => { const b = validGlb(); b.write("xxxx", 20, "ascii"); return b; })()],
    ["chunk 越界", (() => { const b = validGlb(); b.writeUInt32LE(0xffff, 12); return b; })()],
    ["尾部截断", validGlb().subarray(0, -1)],
  ])("拒绝%s", (_label, glb) => {
    expect(() => assertValidGlb2(glb)).toThrow(/^invalid_glb_/);
  });
});
