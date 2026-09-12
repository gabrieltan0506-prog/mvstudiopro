import { describe, it, expect } from "vitest";
import {
  buildManhuaLocalVideoSourceRef,
  parseManhuaLocalVideoSourceRef,
  MANHUA_LOCAL_VIDEO_CHUNK_BYTES,
} from "./manhuaLocalVideoUpload";
const uploadId = "11111111-1111-4111-8111-111111111111";
const sha256 = "a".repeat(64);
describe("私有原片来源身份", () => {
  it("严格往返且2MiB块保持固定", () => {
    const source = buildManhuaLocalVideoSourceRef({
      userId: 7,
      uploadId,
      sha256,
    });
    expect(source).toBe(`manhua-upload://u7/${uploadId}/${sha256}`);
    expect(parseManhuaLocalVideoSourceRef(source)).toEqual({
      userId: "7",
      uploadId,
      sha256,
    });
    expect(MANHUA_LOCAL_VIDEO_CHUNK_BYTES).toBe(2097152);
  });
  it.each([
    "/data/private",
    `manhua-upload://u07/${uploadId}/${sha256}`,
    `manhua-upload://u7/${uploadId}/${sha256}?x=1`,
    `manhua-upload://u7/${uploadId}/${sha256}#x`,
    `manhua-upload://u7/../${sha256}`,
    null,
    1,
  ])("拒绝非规范来源 %s", value =>
    expect(parseManhuaLocalVideoSourceRef(value)).toBeNull()
  );
  it("构造器拒绝路径和伪摘要", () =>
    expect(() =>
      buildManhuaLocalVideoSourceRef({ userId: "../7", uploadId, sha256 })
    ).toThrow());
});
