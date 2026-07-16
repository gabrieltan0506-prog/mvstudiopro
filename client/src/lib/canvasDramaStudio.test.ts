import { describe, expect, it } from "vitest";
import {
  MANHUA_FACTORY_STAGE_ORDER,
  resolveManhuaFactoryOrderedIds,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";

describe("canvasDramaStudio factory", () => {
  it("spawns six linked stages", () => {
    const { blocks, edges } = spawnManhuaDramaStudio();
    expect(blocks).toHaveLength(6);
    expect(edges).toHaveLength(5);
    for (const stage of MANHUA_FACTORY_STAGE_ORDER) {
      expect(blocks.some((b) => b.id.startsWith(`${stage}-`))).toBe(true);
    }
  });

  it("orders ids through reverse by default untilStage", () => {
    const { blocks } = spawnManhuaDramaStudio();
    const ids = resolveManhuaFactoryOrderedIds(blocks, "reverse");
    expect(ids).toHaveLength(4);
    expect(ids[0]).toMatch(/^story-/);
    expect(ids[3]).toMatch(/^reverse-/);
  });

  it("orders full pipeline to clip", () => {
    const { blocks } = spawnManhuaDramaStudio();
    const ids = resolveManhuaFactoryOrderedIds(blocks, "clip");
    expect(ids).toHaveLength(6);
    expect(ids[5]).toMatch(/^clip-/);
  });
});
