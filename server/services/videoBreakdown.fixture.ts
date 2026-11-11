/** 拉片测试夹具（仅测试引用）：合法的 30 秒、三段拆解。 */
import type { VideoBreakdown } from "../../shared/videoBreakdown";

const prompt = (length: number) => ({
  subject: "短发女生，白衬衫，左手腕红绳",
  scene: "傍晚天台，晾衣绳与远处楼群",
  timeline: [
    { fromSec: 0, toSec: Math.round(length * 5) / 10, text: "女生背对镜头站定，侧光，暖橙氛围" },
    { fromSec: Math.round(length * 5) / 10, toSec: length, text: "她缓慢回头，嘴角微扬，逆光勾边" },
  ],
  camera: "中景固定机位，轻微手持晃动",
  lightColor: "夕阳低角度暖光，衣料柔软",
  rhythm: "慢节奏，环境风声",
  constraints: "保留红绳与白衬衫；避免出现文字",
});

export function videoBreakdownFixture(): VideoBreakdown {
  const seg = (index: number, startSec: number, endSec: number) => ({
    index,
    startSec,
    endSec,
    title: `第${index + 1}段`,
    shots: [
      { startSec, endSec: Math.round(((startSec + endSec) / 2) * 10) / 10, framing: "中景", camera: "固定机位", blockingAndFocus: "人物居中，焦点在脸" },
      { startSec: Math.round(((startSec + endSec) / 2) * 10) / 10, endSec, framing: "近景", camera: "缓推", blockingAndFocus: "三分构图，焦点在手" },
    ],
    expression: { narrativeIntent: "铺垫人物情绪", technique: "逆光剪影", rhythm: "舒缓", sound: "风声" },
    recreatePrompt: prompt(Math.round((endSec - startSec) * 10) / 10),
  });
  return {
    kind: "video_breakdown_v1",
    durationSec: 30,
    summary: "天台上的女生在夕阳中回头微笑",
    overview: {
      visualGenes: {
        mediumAndArtStyle: "实拍写实",
        color: "暖橙与青灰对比",
        lighting: "低角度夕阳逆光",
        materialTexture: "棉麻衣料、粗糙水泥",
        composition: "三分构图为主",
        camera: "手持中景与缓推",
      },
      recurringElements: ["红绳", "晾衣绳"],
      mustKeep: ["夕阳逆光", "回头微笑"],
    },
    segments: [seg(0, 0, 10), seg(1, 10, 20), seg(2, 20, 30)],
  };
}
