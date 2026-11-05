import { expect, it, vi } from "vitest";
vi.mock("../services/editableLayoutStore", () => ({
  LayoutConflict: class extends Error {},
  readLayoutLibrary: vi.fn(async (owner: number) => ({ owner })),
  writeLayoutLibrary: vi.fn(
    async (owner: number, library: unknown, generation: string) => ({
      owner,
      library,
      generation,
    })
  ),
}));
import { editableLayoutRouter } from "./editableLayout";
import {
  readLayoutLibrary,
  writeLayoutLibrary,
} from "../services/editableLayoutStore";
it("排版云稿两个入口都要求登录，账号只能来自会话", async () => {
  const anon = editableLayoutRouter.createCaller({ user: null } as any);
  await expect(anon.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    anon.save({
      library: { version: 1, owner: "7", documents: [] },
      expectedGeneration: "0",
    })
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(anon.publicationQuote({documentId:"11111111-1111-4111-8111-111111111111"})).rejects.toMatchObject({code:"UNAUTHORIZED"});
  await expect(anon.exportPublication({documentId:"11111111-1111-4111-8111-111111111111",expectedGeneration:"0"})).rejects.toMatchObject({code:"UNAUTHORIZED"});
  expect(readLayoutLibrary).not.toHaveBeenCalled();
  expect(writeLayoutLibrary).not.toHaveBeenCalled();
  const caller = editableLayoutRouter.createCaller({ user: { id: 8 } } as any);
  await caller.get();
  await caller.save({
    library: { version: 1, owner: "7", documents: [] },
    expectedGeneration: "0",
  });
  expect(readLayoutLibrary).toHaveBeenCalledWith(8);
  expect(writeLayoutLibrary).toHaveBeenCalledWith(
    8,
    { version: 1, owner: "7", documents: [] },
    "0"
  );
  await expect(
    caller.save({
      library: { version: 1, owner: "8", documents: [] },
      expectedGeneration: "0",
      userId: 7,
    } as any)
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
