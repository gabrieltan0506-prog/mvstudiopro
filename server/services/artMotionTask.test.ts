import { expect, it } from "vitest";
import { queueArtMotion, type ArtMotionQueueDeps } from "./artMotionTask";
import {
  defaultArtMotionSpec,
  artMotionStateSchema,
} from "../../shared/artMotion";
it("deduplicates simultaneous requests, rejects changed input and restores full history", async () => {
  const rows = new Map<string, any>();
  let inserts = 0;
  const deps: ArtMotionQueueDeps = {
    load: async id => rows.get(id) ?? null,
    insert: async (id, userId, input) => {
      inserts++;
      if (!rows.has(id))
        rows.set(id, {
          id,
          userId,
          type: "post_prod",
          input,
          status: "queued",
        });
    },
  };
  const input = {
    action: "art_motion",
    scopeKey: "project",
    requestId: "c1007000-1234-4234-8234-123456789abc",
    params: defaultArtMotionSpec(),
  };
  const [a, b] = await Promise.all([
    queueArtMotion("7", input, deps),
    queueArtMotion("7", input, deps),
  ]);
  expect(a.jobId).toBe(b.jobId);
  expect(rows.size).toBe(1);
  await expect(
    queueArtMotion("7", { ...input, scopeKey: "other" }, deps)
  ).rejects.toThrow("不同作品");
  expect((await queueArtMotion("8", input, deps)).jobId).not.toBe(a.jobId);
  const state = artMotionStateSchema.parse({
    version: 1,
    spec: input.params,
    history: [
      {
        id: input.requestId,
        spec: input.params,
        status: "succeeded",
        jobId: a.jobId,
        gcsUri: "gs://offline/result.mp4",
      },
    ],
  });
  expect(
    artMotionStateSchema.parse(JSON.parse(JSON.stringify(state))).history[0]
      .gcsUri
  ).toBe("gs://offline/result.mp4");
});
