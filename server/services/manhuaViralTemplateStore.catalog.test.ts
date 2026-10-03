import { expect, it, vi, beforeEach } from "vitest";
const gcs = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }));
vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  listGcsObjectNamesByPrefix: gcs.list,
  downloadGcsObject: gcs.read,
}));
import { listGcsManhuaViralApproved } from "./manhuaViralTemplateStore";
import { craftFixture } from "../../shared/testFixtures/manhuaTemplateCraft";
beforeEach(() => vi.clearAllMocks());
it("正式目录读到第84张，单张失败不伪装完整目录", async () => {
  gcs.list.mockResolvedValue(
    Array.from(
      { length: 84 },
      (_, i) => `manhua-template-learn/approved/card${i}.json`
    )
  );
  gcs.read.mockImplementation(async ({ gcsUri }) => ({
    buffer: Buffer.from(
      JSON.stringify(
        craftFixture({ id: gcsUri.split("/").at(-1).replace(".json", "") })
      )
    ),
  }));
  expect(await listGcsManhuaViralApproved()).toHaveLength(84);
  expect(gcs.list.mock.calls[0][0].maxResults).toBeGreaterThan(84);
  gcs.read.mockRejectedValue(new Error("storage unavailable"));
  await expect(listGcsManhuaViralApproved()).rejects.toThrow(
    "storage unavailable"
  );
});
