import { describe, expect, it } from "vitest";
import {
  applyShotDialoguesFromText,
  MANHUA_DIALOGUE_SILENCE_TOKEN,
  patchShotDialogueSection,
  parseShotDialogueTable,
  upsertShotDialogueSection,
} from "./manhuaShotDialoguePersist";

describe("manhuaShotDialoguePersist", () => {
  it("upserts and parses dialogue table", () => {
    const text = upsertShotDialogueSection("前文", { 1: "拿着", 2: "你早就知道了？" });
    expect(text).toContain("## 分镜台词");
    const map = parseShotDialogueTable(text);
    expect(map[1]).toBe("拿着");
    expect(map[2]).toBe("你早就知道了？");
  });

  it("applies dialogue overrides onto shots", () => {
    const shots = applyShotDialoguesFromText(
      [
        { index: 1, dialogueZh: "旧" },
        { index: 2, dialogueZh: "" },
      ],
      upsertShotDialogueSection("", { 2: "新台词" }),
    );
    expect(shots[0]?.dialogueZh).toBe("旧");
    expect(shots[1]?.dialogueZh).toBe("新台词");
  });

  it("persists explicit silence without deleting sibling overrides", () => {
    const first = upsertShotDialogueSection("前文", { 1: "旧台词", 2: "保留我" });
    const patched = patchShotDialogueSection(first, {
      1: MANHUA_DIALOGUE_SILENCE_TOKEN,
    });
    expect(parseShotDialogueTable(patched)).toEqual({
      1: MANHUA_DIALOGUE_SILENCE_TOKEN,
      2: "保留我",
    });
    const shots = applyShotDialoguesFromText(
      [
        { index: 1, dialogueZh: "会复活的旧台词" },
        { index: 2, dialogueZh: "旧二" },
      ],
      patched,
    );
    expect(shots[0]?.dialogueZh).toBeUndefined();
    expect(shots[0]?.dialogueSuppressed).toBe(true);
    expect(shots[1]?.dialogueZh).toBe("保留我");
  });
});
