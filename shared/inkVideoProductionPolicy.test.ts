import { expect, it } from "vitest";
import { planInkGeneratedShot } from "./inkVideoProductionPolicy";
it("后台按档位固定模型分辨率，音讯参考不会走首尾帧模式", () => {
  expect(
    planInkGeneratedShot({
      tier: "free",
      duration: 5,
      imageCount: 1,
      videoCount: 0,
      audioCount: 2,
    })
  ).toEqual({
    model: "seedance-2.0-mini",
    version: "2.0-mini",
    resolution: "480p",
    duration: 5,
    mode: "reference_to_video",
  });
  expect(
    planInkGeneratedShot({
      tier: "paid",
      duration: 5,
      imageCount: 1,
      videoCount: 0,
      audioCount: 0,
    })
  ).toMatchObject({
    model: "seedance-2.5",
    resolution: "720p",
    mode: "image_to_video",
  });
});
it("mini总参考9、2.5总参考50，同时检查单类通道上限，不截断参考", () => {
  expect(() =>
    planInkGeneratedShot({
      tier: "free",
      duration: 5,
      imageCount: 8,
      videoCount: 0,
      audioCount: 2,
    })
  ).toThrow("合计");
  expect(() =>
    planInkGeneratedShot({
      tier: "free",
      duration: 5,
      imageCount: 1,
      videoCount: 0,
      audioCount: 4,
    })
  ).toThrow("单类");
  expect(
    planInkGeneratedShot({
      tier: "paid",
      duration: 5,
      imageCount: 30,
      videoCount: 10,
      audioCount: 10,
    }).mode
  ).toBe("reference_to_video");
  expect(() =>
    planInkGeneratedShot({
      tier: "paid",
      duration: 31,
      imageCount: 1,
      videoCount: 0,
      audioCount: 0,
    })
  ).toThrow("30秒");
});
it("paid accepts8 to30 seconds with complete references while free still rejects8",()=>{
  for(const duration of [8,30])expect(planInkGeneratedShot({tier:"paid",duration,imageCount:1,videoCount:0,audioCount:2})).toMatchObject({duration,mode:"reference_to_video",version:"2.5"});
  expect(()=>planInkGeneratedShot({tier:"free",duration:8,imageCount:1,videoCount:0,audioCount:1})).toThrow("4–5秒");
});
