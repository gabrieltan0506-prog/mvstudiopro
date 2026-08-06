import { describe, expect, it } from "vitest";
import { platformEngineEffort } from "./platformEngineTiers.js";

describe("platformEngineEffort", () => {
  it("uses a dedicated expand step distinct from shortlist/polish", () => {
    expect(platformEngineEffort("expand", "excellent")).toBe("medium");
    expect(platformEngineEffort("expand", "superb")).toBe("high");
    expect(platformEngineEffort("expand", "top")).toBe("high");
  });
});
