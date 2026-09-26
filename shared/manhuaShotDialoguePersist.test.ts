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

  it("keeps each speaker's closing quote when a shot has multiple lines", () => {
    const dialogue = "娘：「阿菁，那馬是怎麼回事呀？」 阿菁：「娘，先睡一会，等等就到医馆了。」";
    const first = upsertShotDialogueSection("前文", { 16: dialogue });
    expect(parseShotDialogueTable(first)[16]).toBe(dialogue);
    expect(parseShotDialogueTable(patchShotDialogueSection(first, { 15: "墨屠：「好痛。」" }))[16]).toBe(dialogue);
  });

  it("removes only a quote pair wrapping the whole cell", () => {
    const text = "## 分镜台词\n\n| 镜号 | 台词 |\n| --- | --- |\n| 1 | 「整句」 |\n| 2 | 「第一句」 「第二句」 |";
    expect(parseShotDialogueTable(text)).toEqual({ 1: "整句", 2: "「第一句」 「第二句」" });
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
