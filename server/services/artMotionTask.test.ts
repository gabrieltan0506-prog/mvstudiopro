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

it("映客新建任务不能从通用后期绕过名额，原任务仍可只读恢复", async () => {
  const { codeMotionCompositionSchema } = await import(
    "../../shared/codeMotionComposition"
  );
  const spec = defaultArtMotionSpec();
  const input = {
    action: "art_motion",
    scopeKey: "generic",
    requestId: "c1007000-1234-4234-8234-123456789abe",
    params: {
      ...spec,
      composition: codeMotionCompositionSchema.parse({
        version: 1,
        scenes: [
          {
            id: "s",
            duration: spec.duration,
            elements: [{ id: "t", type: "text", text: "有效画面" }],
          },
        ],
      }),
    },
  };
  let inserted = 0;
  const deps: ArtMotionQueueDeps = {
    load: async () => null,
    insert: async () => {
      inserted++;
    },
  };
  await expect(queueArtMotion("7", input, deps)).rejects.toThrow(
    "请从映客已保存作品入口"
  );
  await expect(
    queueArtMotion(
      "7",
      { ...input, scopeKey: "code-motion:project", params: spec },
      deps
    )
  ).rejects.toThrow("请从映客已保存作品入口");
  expect(inserted).toBe(0);
  const { artMotionJobSchema } = await import("../../shared/artMotion");
  const parsed = artMotionJobSchema.parse(input);
  expect(
    await queueArtMotion("7", input, {
      ...deps,
      load: async id => ({
        id,
        userId: "7",
        type: "post_prod",
        status: "succeeded",
        input: parsed,
      }),
    })
  ).toMatchObject({ status: "succeeded" });
});
