import { describe, expect, it } from "vitest";
import {
  MANHUA_EDIT_MOTION_MAX,
  listManhuaEditMotionEntries,
  manhuaEditMotionInjectPreview,
  toggleManhuaEditMotionId,
} from "./manhuaEditMotionPick";

describe("manhuaEditMotionPick", () => {
  it("lists logo/caption/product categories", () => {
    const logos = listManhuaEditMotionEntries("logo");
    expect(logos.length).toBeGreaterThan(0);
    expect(logos.every((e) => e.category === "logo")).toBe(true);
  });

  it("toggles with max cap", () => {
    const a = logosPick(2);
    let cur: string[] = [];
    for (const id of a) cur = toggleManhuaEditMotionId(cur, id, MANHUA_EDIT_MOTION_MAX);
    expect(cur).toHaveLength(2);
    const third = logosPick(3)[2]!;
    cur = toggleManhuaEditMotionId(cur, third, MANHUA_EDIT_MOTION_MAX);
    expect(cur).toHaveLength(2);
    expect(cur).toContain(third);
    expect(manhuaEditMotionInjectPreview(cur).length).toBeGreaterThan(10);
  });
});

function logosPick(n: number): string[] {
  return listManhuaEditMotionEntries("logo")
    .slice(0, n)
    .map((e) => e.id);
}
