import { describe, expect, it } from "vitest";
import {
  assertValidManhuaGlbFile,
  MANHUA_GLB_IMPORT_MAX_BYTES,
} from "./manhuaGlbImport";

function glbFile(name = "character.glb", payloadBytes = 0): File {
  const header = new ArrayBuffer(12);
  const bytes = new Uint8Array(header);
  bytes.set([0x67, 0x6c, 0x54, 0x46], 0);
  const view = new DataView(header);
  view.setUint32(4, 2, true);
  view.setUint32(8, 12 + payloadBytes, true);
  return new File([header, new Uint8Array(payloadBytes)], name, {
    type: "model/gltf-binary",
  });
}

describe("人物已有 GLB 导入快检", () => {
  it("接受长度一致的 GLB 2.0", async () => {
    await expect(assertValidManhuaGlbFile(glbFile())).resolves.toBeUndefined();
  });

  it("拒绝错误扩展名、错误头与超限文件", async () => {
    await expect(assertValidManhuaGlbFile(glbFile("model.bin"))).rejects.toThrow(
      "请选择 .glb 文件",
    );
    const wrong = new File([new Uint8Array(12)], "model.glb");
    await expect(assertValidManhuaGlbFile(wrong)).rejects.toThrow("有效的 GLB");
    const huge = {
      name: "huge.glb",
      size: MANHUA_GLB_IMPORT_MAX_BYTES + 1,
      slice: () => new Blob(),
    } as File;
    await expect(assertValidManhuaGlbFile(huge)).rejects.toThrow("250 MB");
  });
});
