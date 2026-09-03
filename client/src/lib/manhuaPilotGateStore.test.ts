import { describe, expect, it } from "vitest";
import { recordManhuaPilotGenerated } from "@shared/manhuaPilotGate";
import {
  MANHUA_PILOT_GATE_STORAGE_KEY,
  loadManhuaPilotGateStore,
  saveManhuaPilotGateStore,
} from "./manhuaPilotGateStore";

describe("manhuaPilotGateStore", () => {
  it("round-trips a valid local-only pilot review record", () => {
    let value = "";
    const store = recordManhuaPilotGenerated({}, {
      episodeIndex: 1,
      videoModel: "seedance-2.5",
      outputUrl: "https://cdn.example/pilot.mp4",
    });
    expect(
      saveManhuaPilotGateStore(store, {
        setItem(key, next) {
          expect(key).toBe(MANHUA_PILOT_GATE_STORAGE_KEY);
          value = next;
        },
      }),
    ).toBe(true);
    expect(
      loadManhuaPilotGateStore({
        getItem(key) {
          expect(key).toBe(MANHUA_PILOT_GATE_STORAGE_KEY);
          return value;
        },
      }),
    ).toEqual(store);
  });

  it("fails closed for invalid json", () => {
    expect(loadManhuaPilotGateStore({ getItem: () => "{" })).toEqual({});
  });
});
