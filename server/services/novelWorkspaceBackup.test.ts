import { it, expect, vi, beforeEach } from "vitest";
const mem = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("./gcs", () => ({
  uploadBufferToGcs: async ({ objectName, buffer }: any) => {
    mem.set(objectName, Buffer.from(buffer));
    return { gcsUri: `gs://bucket/${objectName}` };
  },
  downloadGcsObject: async ({ gcsUri }: any) => {
    const key = gcsUri.replace(/^gs:\/\/[^/]+\//, "");
    if (!mem.has(key)) throw new Error("404");
    return { buffer: mem.get(key) };
  },
  listGcsObjectNamesByPrefix: async ({ prefix }: any) =>
    Array.from(mem.keys()).filter(k => k.startsWith(prefix)),
}));
import {
  writeNovelWorkspaceBackup,
  readNovelWorkspaceBackup,
  listNovelWorkspaceBackups,
} from "./novelWorkspaceBackup";
import { emptyNovelWorkspace } from "../../client/src/lib/novelWorkspace";
beforeEach(() => mem.clear());
it("full source, 60 episodes, templates and previous season survive backup/restore with hashes and account isolation", async () => {
  const d = emptyNovelWorkspace();
  d.topic = "沈昀";
  d.targetEpisodeCount = 60;
  d.chapters = Array.from(
    { length: 60 },
    (_, i) => `第${i + 1}集` + "完整小说内容".repeat(800)
  );
  d.templates = [{ publicId: "mt_1", role: "权谋", weight: 100 }];
  d.seasons = [{ season: 1, workspace: "保留的第一季" }];
  const raw = JSON.stringify(d),
    saved = await writeNovelWorkspaceBackup(1, raw);
  expect(
    (await readNovelWorkspaceBackup(1, saved.backupId)).workspaceJson
  ).toBe(raw);
  expect(await listNovelWorkspaceBackups(1)).toHaveLength(1);
  expect(await listNovelWorkspaceBackups(2)).toEqual([]);
  await expect(readNovelWorkspaceBackup(2, saved.backupId)).rejects.toThrow(
    "404"
  );
  const second = await writeNovelWorkspaceBackup(
    1,
    JSON.stringify({ ...d, topic: "改名" })
  );
  expect(second.backupId).not.toBe(saved.backupId);
  expect(
    (await readNovelWorkspaceBackup(1, saved.backupId)).workspaceJson
  ).toBe(raw);
  mem.set(
    `novel-workspace-backups/user-1/${saved.backupId}.json`,
    Buffer.from("损坏")
  );
  await expect(readNovelWorkspaceBackup(1, saved.backupId)).rejects.toThrow(
    "完整性"
  );
});
