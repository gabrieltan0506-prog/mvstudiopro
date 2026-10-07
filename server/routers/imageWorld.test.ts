import { expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(async () => "gs://offline/owned.png"),
  sign: vi.fn(() => "https://offline.invalid/fresh.png"),
  model: vi.fn(),
}));
vi.mock("../services/postProdMediaSource", () => ({
  resolveRegisteredPostProdMediaSource: mocks.resolve,
}));
vi.mock("../services/gcs", () => ({ signGsUriV4ReadUrl: mocks.sign }));
vi.mock("../services/manhua3dTask", () => ({
  createManhua3dTask: mocks.model,
}));
vi.mock("../services/manhuaWorldTask", () => ({
  createManhuaWorldTask: mocks.model,
}));
vi.mock("../services/imageWorldAnalysis", () => ({
  analyzeImageWorld: mocks.model,
}));
import { imageWorldRouter } from "./imageWorld";
it("source signing is owner-scoped and read-only, rejects anonymous and unowned inputs", async () => {
  const caller = imageWorldRouter.createCaller({
    user: { id: 7, role: "admin" },
  } as TrpcContext);
  expect(
    await caller.source({ sourceUri: "/api/canvas-media/generated/a.png" })
  ).toEqual({
    canonical: "gs://offline/owned.png",
    url: "https://offline.invalid/fresh.png",
  });
  expect(mocks.resolve).toHaveBeenCalledWith({
    userId: "7",
    source: "/api/canvas-media/generated/a.png",
  });
  expect(mocks.model).not.toHaveBeenCalled();
  await expect(
    imageWorldRouter
      .createCaller({ user: null } as TrpcContext)
      .source({ sourceUri: "gs://offline/owned.png" })
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  mocks.resolve.mockRejectedValueOnce(new Error("not owned"));
  await expect(
    caller.source({ sourceUri: "gs://offline/other.png" })
  ).rejects.toThrow("not owned");
  expect(mocks.model).not.toHaveBeenCalled();
});
