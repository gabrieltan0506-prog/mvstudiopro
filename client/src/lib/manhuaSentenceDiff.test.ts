import { expect, it } from "vitest";
import { compareScriptSentences, compareScriptCharacters } from "./manhuaSentenceDiff";
it("插入、删除、修改逐句对齐，后续未改句保持对应", () => {
 expect(compareScriptSentences("甲来了。乙走了。", "甲来了。先等一下！乙走了。").map(r => r.kind)).toEqual(["same", "added", "same"]);
 expect(compareScriptSentences("甲来了。先等一下！乙走了。", "甲来了。乙走了。").map(r => r.kind)).toEqual(["same", "removed", "same"]);
 expect(compareScriptSentences("甲来了。你留下。乙走了。", "甲来了。你在这里照顾她。乙走了。").map(r => r.kind)).toEqual(["same", "changed", "same"]);
});
it("句内只标记改动字词，前后及中间相同内容不高亮", () => {
 const parts = compareScriptCharacters("他慢慢推门，轻轻坐下。", "他猛地推门，缓缓坐下。");
 expect(parts.before.filter(p=>p.changed).map(p=>p.text)).toEqual(["慢慢", "轻轻"]);
 expect(parts.after.filter(p=>p.changed).map(p=>p.text)).toEqual(["猛地", "缓缓"]);
 expect(parts.before.filter(p=>!p.changed).map(p=>p.text).join("")).toBe("他推门，坐下。");
});
it("纯增删、Unicode和长句都保留完整原文", () => {
 for(const [before,after] of [["相同内容。","相同内容。"],["","新增"],["删去",""],["她🙂举灯。","她😟举灯。"],["长".repeat(20000)+"旧"+"尾".repeat(20000),"长".repeat(20000)+"新"+"尾".repeat(20000)]]) {
  const parts=compareScriptCharacters(before!,after!);
  expect(parts.before.map(p=>p.text).join("")).toBe(before);expect(parts.after.map(p=>p.text).join("")).toBe(after);
  expect(parts.before.filter(p=>!p.changed).map(p=>p.text).join("")).toBe(parts.after.filter(p=>!p.changed).map(p=>p.text).join(""));
 }
 expect(compareScriptCharacters("相同内容。","相同内容。").before.every(p=>!p.changed)).toBe(true);
});
it("保留全部标点、空白、引号和重复句，长文不丢字", () => {
 for (const [before,after] of [["", "新稿"], ["旧稿", ""], ["阿菁：「你别走！」\n\n她拉住他。 ", "阿菁：「等等，我跟你走。」\n她起身。"], ["是。是。否。", "是。否。是。"], ["甲。".repeat(1500), "乙！".repeat(1500)]]) {
  const rows = compareScriptSentences(before!, after!);
  expect(rows.map(r=>r.before).join("")).toBe(before);
  expect(rows.map(r=>r.after).join("")).toBe(after);
 }
});
