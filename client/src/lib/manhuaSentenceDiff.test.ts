import { expect, it } from "vitest";
import { compareScriptSentences } from "./manhuaSentenceDiff";
it("插入、删除、修改逐句对齐，后续未改句保持对应", () => {
 expect(compareScriptSentences("甲来了。乙走了。", "甲来了。先等一下！乙走了。").map(r => r.kind)).toEqual(["same", "added", "same"]);
 expect(compareScriptSentences("甲来了。先等一下！乙走了。", "甲来了。乙走了。").map(r => r.kind)).toEqual(["same", "removed", "same"]);
 expect(compareScriptSentences("甲来了。你留下。乙走了。", "甲来了。你在这里照顾她。乙走了。").map(r => r.kind)).toEqual(["same", "changed", "same"]);
});
it("保留全部标点、空白、引号和重复句，长文不丢字", () => {
 for (const [before,after] of [["", "新稿"], ["旧稿", ""], ["阿菁：「你别走！」\n\n她拉住他。 ", "阿菁：「等等，我跟你走。」\n她起身。"], ["是。是。否。", "是。否。是。"], ["甲。".repeat(1500), "乙！".repeat(1500)]]) {
  const rows = compareScriptSentences(before!, after!);
  expect(rows.map(r=>r.before).join("")).toBe(before);
  expect(rows.map(r=>r.after).join("")).toBe(after);
 }
});
