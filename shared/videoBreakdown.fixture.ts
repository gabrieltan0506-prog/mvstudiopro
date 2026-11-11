/** 单测共用假数据：17 秒、4 段，符合 shared/videoBreakdown.ts 契约。只给测试用。 */
import type { VideoBreakdown, VideoBreakdownSegment } from "./videoBreakdown";

export const bounds: Array<[number, number, string]> = [[0, 4.2, "雨林潜行"], [4.2, 8.5, "闪电对峙"], [8.5, 12.8, "扑咬反击"], [12.8, 17, "泥沼收束"]];

export function fixtureSegment(index: number): VideoBreakdownSegment {
  const [startSec, endSec, title] = bounds[index];
  const mid = Math.round(((startSec + endSec) / 2) * 10) / 10;
  const length = Math.round((endSec - startSec) * 10) / 10;
  return {
    index, startSec, endSec, title,
    shots: [
      { startSec, endSec: mid, framing: `第${index + 1}段远景`, camera: "平视 · 缓推", blockingAndFocus: "主体居左三分线 | 焦点在眼睛" },
      { startSec: mid, endSec, framing: `第${index + 1}段特写`, camera: "低机位 · 手持", blockingAndFocus: "雨滴在前景虚化" },
    ],
    expression: {
      narrativeIntent: `第${index + 1}段建立威胁`, technique: "冷暖对比", rhythm: "先慢后快",
      ...(index === 3 ? {} : { sound: "雷声与低频呼吸" }),
    },
    recreatePrompt: {
      subject: "同一只成年恐龙，琥珀色眼睛", scene: "暴雨中的蕨类雨林",
      timeline: [{ fromSec: 0, toSec: length / 2, text: "缓慢探头，雨水顺鳞片滑落" }, { fromSec: length / 2, toSec: length, text: "猛然张口，闪电照亮牙齿" }],
      camera: "低机位仰拍，缓推", lightColor: "冷蓝环境光加闪电白", rhythm: "前半静默，后半鼓点", constraints: "保留雨幕；避免卡通化",
    },
  };
}

export const videoBreakdownFixture: VideoBreakdown = {
  kind: "video_breakdown_v1",
  durationSec: 17,
  summary: "暴雨雨林里两只恐龙从对峙到扑咬，最后幼兽坠入泥沼。",
  overview: {
    visualGenes: { mediumAndArtStyle: "写实三维动画", color: "墨绿与冷蓝", lighting: "闪电硬光", materialTexture: "湿润鳞片", composition: "前景遮挡", camera: "低机位为主" },
    recurringElements: ["琥珀色眼睛", "雨水高光"],
    mustKeep: ["体型对比", "闪电节拍"],
  },
  segments: [0, 1, 2, 3].map(fixtureSegment),
};


/** 同一支片，带上全部可选块（手法/节奏情绪/风格判词、声音拆解、重点时刻）。 */
export const videoBreakdownFixtureRich: VideoBreakdown = {
  ...videoBreakdownFixture,
  overview: {
    ...videoBreakdownFixture.overview,
    craft: {
      reusableTechniques: ["前景遮挡制造窥视感", "闪电作为剪辑节拍点"],
      rhythmStructure: "静态铺垫 → 对峙升温 → 扑咬爆发 → 泥沼收束",
      emotionArc: "不安 → 紧张 → 惊惧 → 怅然",
      styleTags: ["压迫", "写实", "冷色", "快切"],
    },
    sound: {
      rhythm: "前 8 秒稀疏雨声，8.5 秒起鼓点加密，末段只剩低频",
      mix: "环境雨声为主，吼叫音效突出，无对白",
      reusableTechniques: "雷声前一拍抽空所有声音",
      generationElements: "低音大鼓、弦乐颤音、雷声采样，速度由 70 到 120 bpm",
    },
    keyMoments: [
      { atSec: 10.2, type: "emotion", note: "张口特写" },
      { atSec: 4.2, type: "cut", note: "闪电硬切" },
      { atSec: 15, type: "story", note: "幼兽坠入泥沼" },
    ],
  },
};
/** 与 keyMoments 原下标对应；第 3 个抽帧失败为空串。 */
export const videoBreakdownFixtureRichFrames = [
  "https://cdn.example.com/f0.jpg",
  "https://cdn.example.com/f1.jpg",
  "",
];
