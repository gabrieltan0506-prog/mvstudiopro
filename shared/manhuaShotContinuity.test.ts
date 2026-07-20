import { describe, expect, it } from "vitest";
import {
  normalizeManhuaShotContinuityPrefs,
  resolvePreviousShotClipUrl,
  resolvePreviousShotKeyartUrl,
} from "./manhuaShotContinuity";

describe("manhuaShotContinuity", () => {
  const blocks = [
    {
      id: "keyart-e01-s01",
      episodeIndex: 1,
      status: "done",
      outputUrl: "https://cdn.example/k1.jpg",
    },
    {
      id: "keyart-e01-s02",
      episodeIndex: 1,
      status: "done",
      outputUrl: "https://cdn.example/k2.jpg",
    },
    {
      id: "clip-e01-s01",
      episodeIndex: 1,
      status: "done",
      outputUrl: "https://cdn.example/c1.mp4",
    },
    {
      id: "clip-e01-s02",
      episodeIndex: 1,
      status: "idle",
      outputUrl: undefined,
    },
  ];

  it("resolves previous keyart for shot 2+", () => {
    expect(resolvePreviousShotKeyartUrl(blocks, 1, 2)).toContain("k1.jpg");
    expect(resolvePreviousShotKeyartUrl(blocks, 1, 1)).toBeUndefined();
  });

  it("resolves previous clip for shot 2+", () => {
    expect(resolvePreviousShotClipUrl(blocks, 1, 2)).toContain("c1.mp4");
    expect(resolvePreviousShotClipUrl(blocks, 1, 3)).toBeUndefined();
  });

  it("normalizes prefs defaults", () => {
    expect(normalizeManhuaShotContinuityPrefs(null)).toEqual({
      keyartFromPrevStill: true,
      clipFromPrevTail: true,
    });
    expect(normalizeManhuaShotContinuityPrefs({ keyartFromPrevStill: false })).toEqual({
      keyartFromPrevStill: false,
      clipFromPrevTail: true,
    });
  });
});
