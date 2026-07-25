import { describe, expect, it } from "vitest";
import {
  pickManhuaSceneTileSlot,
  resolveManhuaSceneTileUrl,
} from "./manhuaSceneTilePick";

describe("manhuaSceneTilePick", () => {
  it("没线索时回主视角", () => {
    expect(pickManhuaSceneTileSlot("")).toBe("topLeft");
    expect(pickManhuaSceneTileSlot(null)).toBe("topLeft");
    expect(pickManhuaSceneTileSlot("全景，平视，缓慢横移")).toBe("topLeft");
  });

  /**
   * 「正俯」类词通常也带「俯」字，判定顺序若反了会被斜俯先吃掉，
   * 于是垂直俯视的段落拿到斜俯图——地面动线对不上。
   */
  it("正俯不被斜俯吃掉", () => {
    expect(pickManhuaSceneTileSlot("近似垂直俯视，看清主体平面轮廓")).toBe("bottomRight");
    expect(pickManhuaSceneTileSlot("鸟瞰全城")).toBe("bottomRight");
    expect(pickManhuaSceneTileSlot("自屋顶斜俯，看清主体与地面动线")).toBe("bottomLeft");
    expect(pickManhuaSceneTileSlot("俯拍桥板")).toBe("bottomLeft");
  });

  it("正面推近走正面聚焦", () => {
    expect(pickManhuaSceneTileSlot("运镜轨迹：正面缓慢推近。景别：中近景。")).toBe("topRight");
  });

  /**
   * 运镜与景别跟角度正交：一段里写再多「推近/近景」也不能把「俯拍」比下去，
   * 否则俯视段会拿到平视图，地面动线全对不上。
   */
  it("角度线索压过运镜与景别", () => {
    const block = [
      "0–5s：运镜轨迹：俯拍推进。景别：全景。",
      "5–10s：运镜轨迹：缓慢推近。景别：中近景。",
      "10–15s：运镜轨迹：正面平移。景别：近景。",
    ].join("\n");
    expect(pickManhuaSceneTileSlot(block)).toBe("bottomLeft");
  });

  it("有切片就换，缺图逐级退回", () => {
    const tiles = {
      topLeft: "https://cdn.example/tl.png",
      bottomLeft: "https://cdn.example/bl.png",
    };
    expect(resolveManhuaSceneTileUrl("https://cdn.example/sheet.png", tiles, "俯拍")).toEqual({
      url: "https://cdn.example/bl.png",
      slot: "bottomLeft",
    });
    // 正俯没切出来 → 退主视角，而不是把拼板整张喂回去
    expect(resolveManhuaSceneTileUrl("https://cdn.example/sheet.png", tiles, "鸟瞰")).toEqual({
      url: "https://cdn.example/tl.png",
      slot: "topLeft",
    });
    // 一张切片都没有 → 才用原图
    expect(resolveManhuaSceneTileUrl("https://cdn.example/sheet.png", null, "俯拍")).toEqual({
      url: "https://cdn.example/sheet.png",
      slot: null,
    });
  });
});
