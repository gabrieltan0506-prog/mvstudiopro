import { describe, it, expect } from "vitest";
import { inspectLyricText, buildLyricReviewContext } from "./lyricCraftReview";
describe("歌词工艺检查不冒充AI检测或听审",()=>{
 it("保留原行号和全部重复位置，表演标签不计唱词",()=>{
  const r=inspectLyricText("[Verse]\nCodex 在手\n\n[Chorus]\n向前！\n向前！");
  expect(r.lines.map(x=>x.line)).toEqual([2,5,6]);
  expect(r.repeatedLines).toEqual([{text:"向前！",lineNumbers:[5,6]}]);
  expect(r.scopeZh).toContain("不判断音节");
 });
 it("无歌词与纯器乐不误判，三份候选完整检查不截断",()=>{
  expect(buildLyricReviewContext({style:"摇滚"})).toBeUndefined();
  const r=buildLyricReviewContext({kind:"suno_song_v1",concepts:[{brief:{instrumental:true,prompt:"[Solo]"}},...Array.from({length:3},()=>({brief:{instrumental:false,prompt:"[Verse]\n灯还亮着"}}))]});
  expect(r?.diagnostics).toHaveLength(3);expect(r?.diagnostics[2].sourcePath).toBe("/candidate/concepts/3/brief/prompt");
 });
});
