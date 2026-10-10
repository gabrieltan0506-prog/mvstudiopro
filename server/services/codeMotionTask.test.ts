import { expect, it, vi } from "vitest";
import {
  codeMotionRenderIdentity,
  submitCodeMotion,
  type CodeMotionTaskDeps,
} from "./codeMotionTask";
import { codeMotionProjectSchema } from "../../shared/codeMotion";
const project = codeMotionProjectSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  brief: {
    title: "作品",
    request: "介绍原文",
    text: "",
    style: "words",
    duration: 15,
    orientation: "landscape",
    images: [],
    data: [],
    unit: "",
  },
  plan: {
    version: 1,
    summary: "一页说明",
    scenes: [{ heading: "介绍", body: "原文", duration: 15 }],
  },
});
it("同版本重复点击与重进页面恢复原任务，不新排队", async () => {
  const identity = codeMotionRenderIdentity("1", project);
  const row = {
    id: identity.jobId,
    userId: "1",
    type: "post_prod",
    status: "failed",
    input: {
      action: "art_motion",
      scopeKey: identity.scopeKey,
      requestId: identity.requestId,
      params: Object.fromEntries(Object.entries(identity.spec).reverse()),
    },
    output: null,
    error: "fixture",
    provider: "canvas-art-motion",
    createdAt: null,
    updatedAt: null,
  };
  const queue = vi.fn(),
    resolve = vi.fn();
  const deps = {
    load: async () => row,
    queue,
    resolve,
    view: (r: typeof row) => ({ ...r, jobId: r.id }),
  } as unknown as CodeMotionTaskDeps;
  expect(
    await submitCodeMotion("1", project, identity.fingerprint, deps)
  ).toEqual({ jobId: identity.jobId, status: "failed" });
  expect(queue).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  await expect(
    submitCodeMotion("1", project, "0".repeat(64), deps)
  ).rejects.toThrow("内容已修改");
  expect(codeMotionRenderIdentity("2", project).jobId).not.toBe(identity.jobId);
});
it("首次提交先走素材归属核验，再走原幂等队列", async () => {
  const identity = codeMotionRenderIdentity("1", project),
    queue = vi
      .fn()
      .mockResolvedValue({ jobId: identity.jobId, status: "queued" }),
    resolve = vi.fn(async (v: { input: unknown }) => v.input);
  const deps = {
    load: async () => null,
    queue,
    resolve,
    view: vi.fn(),
  } as unknown as CodeMotionTaskDeps;
  await submitCodeMotion("1", project, identity.fingerprint, deps);
  expect(resolve).toHaveBeenCalledOnce();
  expect(queue).toHaveBeenCalledWith("1", {
    action: "art_motion",
    scopeKey: identity.scopeKey,
    requestId: identity.requestId,
    params: identity.spec,
  });
});
