import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  unavailable: false,
}));
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "offline-bucket",
  uploadBufferToGcsIfAbsent: async ({
    objectName,
    buffer,
  }: {
    objectName: string;
    buffer: Buffer;
  }) => {
    if (state.unavailable) throw new Error("storage unavailable");
    const created = !state.objects.has(objectName);
    if (created) state.objects.set(objectName, buffer);
    return { created };
  },
  downloadGcsObject: async ({ gcsUri }: { gcsUri: string }) => {
    if (state.unavailable) throw new Error("storage unavailable");
    const buffer = state.objects.get(
      gcsUri.replace("gs://offline-bucket/", "")
    );
    if (!buffer) throw new Error("gcs_download_failed:404");
    return { buffer };
  },
}));
import {
  readHeavyMediaResult,
  saveHeavyMediaResult,
} from "./heavyMediaEvidence";
beforeEach(() => {
  state.objects.clear();
  state.unavailable = false;
});
it("full result bytes/hash survive another process read; repeated save cannot overwrite an existing receipt", async () => {
  const result = {
    raw: Array.from({ length: 160 }, (_, i) => ({
      scene: i,
      text: "完整原始回覆",
    })),
  };
  const saved = await saveHeavyMediaResult("offline_1", "7", result);
  expect(saved.bytes).toBe(Buffer.byteLength(JSON.stringify(result)));
  expect(saved.sha256).toHaveLength(64);
  await saveHeavyMediaResult("offline_1", "7", result);
  await expect(
    saveHeavyMediaResult("offline_1", "7", { raw: [] })
  ).rejects.toThrow("differs");
  expect(await readHeavyMediaResult("offline_1", "7")).toEqual(result);
  expect(state.objects.size).toBe(1);
});
it("storage outage, wrong user and corrupted JSON cannot be mistaken for absent recovery data", async () => {
  expect(await readHeavyMediaResult("absent", "7")).toBeNull();
  await saveHeavyMediaResult("offline_1", "7", { complete: true });
  await expect(readHeavyMediaResult("offline_1", "8")).rejects.toThrow(
    "Invalid"
  );
  const key = "heavy-media-evidence/offline_1/result.json";
  const value = JSON.parse(state.objects.get(key)!.toString());
  value.result.complete = false;
  state.objects.set(key, Buffer.from(JSON.stringify(value)));
  await expect(readHeavyMediaResult("offline_1", "7")).rejects.toThrow(
    "Invalid"
  );
  state.unavailable = true;
  await expect(readHeavyMediaResult("absent", "7")).rejects.toThrow(
    "unavailable"
  );
});
