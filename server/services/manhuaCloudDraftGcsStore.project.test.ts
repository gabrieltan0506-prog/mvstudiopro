import { it, expect, vi, beforeEach } from "vitest";
const files = new Map<string, Buffer>();
vi.mock("./gcs.js", () => ({
  uploadBufferToGcs: vi.fn(
    async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
      files.set(objectName, buffer);
      return { gcsUri: `gs://test/${objectName}` };
    }
  ),
  downloadGcsObject: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
    const key = gcsUri.replace(/^gs:\/\/[^/]+\//, "");
    if (!files.has(key)) throw new Error("gcs_download_failed:404");
    return { buffer: files.get(key)! };
  }),
  createGcsSignedUploadUrl: vi.fn(
    async ({ objectName }: { objectName: string }) => ({
      objectName,
      uploadUrl: "https://test.invalid/upload",
      gcsUri: `gs://test/${objectName}`,
    })
  ),
  listGcsObjectNamesByPrefix: vi.fn(async ({ prefix }: { prefix: string }) =>
    Array.from(files.keys()).filter(k => k.startsWith(prefix))
  ),
}));
import {
  manhuaCloudDraftObjectName,
  writeManhuaCloudDraftToGcs,
  readManhuaCloudDraftFromGcs,
  createManhuaCloudDraftSignedUpload,
  listManhuaProjects,
} from "./manhuaCloudDraftGcsStore";
import { buildManhuaCloudDraftPayload } from "../../shared/manhuaCloudDraft";
beforeEach(() => files.clear());
it("旧对象路径不变，作品与账号各自写入、读取、签名和列举", async () => {
  const a = "11111111-1111-4111-8111-111111111111",
    b = "22222222-2222-4222-8222-222222222222";
  const payload = (title: string) =>
    buildManhuaCloudDraftPayload({
      clientUpdatedAt: new Date().toISOString(),
      writerSession: { topic: title, episodeCount: 3 },
      blocks: [],
      edges: [],
    });
  expect(manhuaCloudDraftObjectName(1)).toBe("manhua-cloud-drafts/user-1.json");
  for (const [userId, projectId, title] of [
    [1, undefined, "墨菁传"],
    [1, a, "剧A"],
    [1, b, "剧B"],
    [2, a, "另一个账号"],
  ] as const)
    await writeManhuaCloudDraftToGcs({
      userId,
      projectId,
      payload: payload(title),
    });
  expect(
    (await readManhuaCloudDraftFromGcs(1))?.payload.writerSession.topic
  ).toBe("墨菁传");
  expect(
    (await readManhuaCloudDraftFromGcs(1, a))?.payload.writerSession.topic
  ).toBe("剧A");
  expect(
    (await readManhuaCloudDraftFromGcs(2, a))?.payload.writerSession.topic
  ).toBe("另一个账号");
  expect((await createManhuaCloudDraftSignedUpload(1, b)).objectName).toBe(
    `manhua-cloud-drafts/user-1/projects/${b}.json`
  );
  expect(
    (await listManhuaProjects(1)).projects.map(p => p.title).sort()
  ).toEqual(["剧A", "剧B"]);
  expect((await listManhuaProjects(2)).projects.map(p => p.title)).toEqual([
    "另一个账号",
  ]);
  expect(await readManhuaCloudDraftFromGcs(2, b)).toBeNull();
});

it("100部以上云端作品索引全量列举，不套用草稿30天过期", async () => {
  for (let i = 0; i < 105; i++) {
    const id = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
    const payload = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2020-01-01T00:00:00Z",
      writerSession: { topic: `剧${i}` },
      blocks: [],
      edges: [],
    });
    await writeManhuaCloudDraftToGcs({ userId: 1, projectId: id, payload });
  }
  expect((await listManhuaProjects(1)).projects).toHaveLength(105);
  const key = manhuaCloudDraftObjectName(
    1,
    "11111111-1111-4111-8111-000000000000"
  );
  const old = JSON.parse(files.get(key)!.toString());
  old.serverUpdatedAt = "2020-01-01T00:00:00Z";
  files.set(key, Buffer.from(JSON.stringify(old)));
  expect(
    (
      await readManhuaCloudDraftFromGcs(
        1,
        "11111111-1111-4111-8111-000000000000"
      )
    )?.payload.writerSession.topic
  ).toBe("剧0");
});
