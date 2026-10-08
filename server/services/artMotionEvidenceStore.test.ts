import { expect, it, vi } from "vitest";
import { persistArtMotionEvidence } from "./artMotionEvidenceStore";
const bytes = Buffer.from('{"original":true}'),
  user = "7",
  id = "c1007000-1234-4234-8234-123456789abc",
  key = `post-prod/${user}/art-motion-evidence/${id}/request.raw.json`;
it("GCS成功不访问网站；网站失联不会阻断正常证据写入", async () => {
  const upload = vi.fn().mockResolvedValue({ gcsUri: `gs://test/${key}` }),
    fallback = vi.fn().mockRejectedValue(new Error("website down"));
  const result = await persistArtMotionEvidence(user, id, key, bytes, {
    upload,
    fallback,
  });
  expect(result).toMatchObject({
    storage: "gcs",
    bytes: 17,
    gcsUri: `gs://test/${key}`,
  });
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(fallback).not.toHaveBeenCalled();
});
it("GCS失败后才写网站/data；回执不伪称GCS成功", async () => {
  const order: string[] = [];
  const upload = vi.fn(async () => {
    order.push("gcs");
    throw new Error("cloud down");
  });
  const fallback = vi.fn(async () => {
    order.push("website_data");
  });
  const result = await persistArtMotionEvidence(user, id, key, bytes, {
    upload,
    fallback,
  });
  expect(order).toEqual(["gcs", "website_data"]);
  expect(result.storage).toBe("website_data");
  expect(result.gcsUri).toBeUndefined();
  expect(fallback).toHaveBeenCalledWith(user, id, key, bytes);
});
it("GCS和网站同时失败必须报错，不丢证据继续渲染", async () => {
  await expect(
    persistArtMotionEvidence(user, id, key, bytes, {
      upload: vi.fn().mockRejectedValue(new Error("gcs down")),
      fallback: vi.fn().mockRejectedValue(new Error("website down")),
    })
  ).rejects.toThrow("website down");
});
