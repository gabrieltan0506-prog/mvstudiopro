import { expect, it } from "vitest";
import { canvasVideoEnhanceQuote, canvasVideoUpscaleCredits, canvasVideoFrameCredits } from "./canvasGenerationPricing";
it.each([
  ["2k",30,119,476], ["2k",60,149,596], ["4k",30,199,796], ["4k",60,229,916],
] as const)("%s/%s帧：每开始30秒固定%s积分，整集报价%s", (target, fps, unit, episode) => {
  expect(canvasVideoEnhanceQuote(target,fps,0.1).totalCredits).toBe(unit);
  expect(canvasVideoEnhanceQuote(target,fps,30).totalCredits).toBe(unit);
  expect(canvasVideoEnhanceQuote(target,fps,30.001).totalCredits).toBe(unit*2);
  expect(canvasVideoEnhanceQuote(target,fps,106.168)).toMatchObject({ units:4, billedSeconds:120, totalCredits:episode });
});
it("独立超分和补帧使用同一价表，不叠加散客倍率", () => {
  expect(canvasVideoUpscaleCredits("2k",30,{freeform:true})).toBe(100);
  expect(canvasVideoUpscaleCredits("4k",30,{freeform:true})).toBe(180);
  expect(canvasVideoFrameCredits(30,30)).toBe(19);
  expect(canvasVideoFrameCredits(30,60)).toBe(49);
});
it.each([0,-1,600.001,NaN,Infinity])("非法时长%s不生成报价", duration => {
  expect(()=>canvasVideoEnhanceQuote("4k",60,duration)).toThrow();
});
