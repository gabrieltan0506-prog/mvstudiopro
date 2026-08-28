/**
 * 原生精读适配器回归。
 *
 * fixture 直接截取自 0823 真跑产出（qwen3.8-max 直读抖音 CDN，262 秒 → 95 镜），
 * 不是手编的形状 —— 手编 fixture 只能证明「代码自洽」，证明不了「能吃真实上游」。
 */
import { describe, expect, it } from "vitest";
import { mapNativeDeepReadSegments } from "./manhuaNativeDeepRead";
import {
  formatManhuaViralTemplateWriterSkillFromCard,
  parseManhuaViralTemplateCard,
  isNativeVideoLearnedTemplate,
  fitManhuaViralBeatGridToSegments,
  type ManhuaViralTemplateCard,
} from "./manhuaViralTemplateBank";

/** 真实产出的前两段，每段前 3 镜 */
const REAL_ROWS = [
  {
    "seg": 0,
    "startSec": 0,
    "endSec": 32,
    "text": "{\"shots\": [{\"startSec\": 0, \"endSec\": 1, \"shotSizeZh\": \"特写\", \"angleZh\": \"平视\", \"cameraMoveZh\": \"固定机位\", \"lightingZh\": \"整体暗调，中央暖橙背光勾出两人侧脸轮廓，高对比\", \"actionZh\": \"白发兽耳者与黑发棘甲者侧面近距离对峙，静止凝视\", \"transitionInZh\": \"硬切\"}, {\"startSec\": 1, \"endSec\": 2, \"shotSizeZh\": \"近景\", \"angleZh\": \"平视背影\", \"cameraMoveZh\": \"固定机位\", \"lightingZh\": \"背影朝向远处暖光源，人物近乎剪影，紫黑环境\", \"actionZh\": \"两人背面同框，望向深处暖光，暗示同行出发\", \"transitionInZh\": \"硬切\"}, {\"startSec\": 2, \"endSec\": 4, \"shotSizeZh\": \"全景\", \"angleZh\": \"平视\", \"cameraMoveZh\": \"固定机位\", \"lightingZh\": \"冷紫蓝雾状低光，左侧斜置巨岩壁占画面，人物背光剪影，亮度逐渐压暗\", \"actionZh\": \"兽耳背剑者独立岩壁旁，随后转身行进，尾段另一健壮剪影掠过岩壁\", \"transitionInZh\": \"硬切\"}], \"beatStructureZh\": \"0-2秒标题卡+对峙静帧憋住；2-8秒低调潜行与巨甲陈列持续积压约6秒；11秒群像雾中登场第一次抬起；17-18秒面部极\", \"reusableZh\": \"①侧脸对峙双人特写+中央背光快速建立对立感；②背影望向远处光源暗示目标与出发；③剪影+斜线构图+浓雾拍潜行紧张；④慢横移扫过巨型残躯/甲装暗示敌方体量而不直拍战\", \"genPromptHintZh\": \"需写明：角色特征对置（白发兽耳/黑发棘甲/红发鹿角首领/白猿随从）；光位（中央暖橙背光轮廓光、火光单一光源、冷蓝紫环境光、室内体积神光）；氛围（浓体积雾、悬浮残\"}"
  },
  {
    "seg": 1,
    "startSec": 316,
    "endSec": 362,
    "text": "{\"shots\": [{\"startSec\": 0, \"endSec\": 3, \"shotSizeZh\": \"大远景\", \"angleZh\": \"仰拍\", \"cameraMoveZh\": \"慢速拉远兼下摇：巨舟在云隙中相对缩小，画面下缘逐渐露出更多仰望人头与山顶塔尖\", \"lightingZh\": \"夜幕阴云，云后背光透出丁达尔光束，舟体冷白高光、地面人群剪影，明暗对比强\", \"actionZh\": \"巨型灵舟悬于云层缓缓隐现，光束扫下；前景人群仰头张望\", \"transitionInZh\": \"硬切（开场直入）\"}, {\"startSec\": 3, \"endSec\": 5, \"shotSizeZh\": \"全景\", \"angleZh\": \"平视略仰\", \"cameraMoveZh\": \"固定机位，仅雾气流雪与幡旗飘动\", \"lightingZh\": \"冷白背光、雾霭低对比，舟身冰蓝自亮\", \"actionZh\": \"冰雕楼船侧面近示，雪纹巨幡与楼阁细节呈现，左侧竖排字幕点名来者宗门\", \"transitionInZh\": \"硬切\"}, {\"startSec\": 5, \"endSec\": 8, \"shotSizeZh\": \"中景起幅推至近景\", \"angleZh\": \"平视\", \"cameraMoveZh\": \"约2秒内从中景匀速推至男子面部近景\", \"lightingZh\": \"阴天漫射灰蓝光，面部弱正面光，背景暖色灯点微弱\", \"actionZh\": \"男子举手指天惊呼，周围群众随之仰头，老者侧立皱眉\", \"transitionInZh\": \"硬切\"}], \"beatStructureZh\": \"前3秒巨舟悬云先立规模；5到25秒切人群视角，用一连串反应近景把『来者是谁』憋足20秒，中间挠头斗嘴做短暂喜剧泄压；26\", \"reusableZh\": \"①巨物入场先拍仰望者的反应与剪影比例尺，全景后置，反应镜头即悬念单位；②力量不拍光效拍环境反应：脚下冰裂、雾排开、百姓噤声；③爆点前插1到2秒空镜静拍重置节奏；\", \"genPromptHintZh\": \"要素：遮天巨型中式楼船灵舟；暴风云层与丁达尔光束；仰望人群剪影作比例尺；雪纹巨幡与冰雕船身；白袍银发修士队列；脚踏地面冰晶放射蔓延；空寂雾锁长街；冷蓝低饱和雾感\"}"
  }
];

describe("原生精读产出 → 模板卡（真实形状往返）", () => {
  it("解析真实上游形状：六栏保留、跨段秒位是全片绝对秒", () => {
    const out = mapNativeDeepReadSegments(REAL_ROWS);
    expect(out.segmentCount).toBe(2);
    expect(out.shotCount).toBe(6);

    const first = out.beatGrid[0]!;
    expect(first.shotSizeZh).toBe("特写");
    expect(first.angleZh).toBe("平视");
    expect(first.cameraMoveZh).toBe("固定机位");
    expect(first.lightingZh).toContain("暖橙背光");
    expect(first.transitionInZh).toBe("硬切");
    expect(first.visualZh).toContain("对峙");
    expect(first.endSec).toBe(1);

    // 第二段的镜头必须偏移到全片绝对秒，否则多段拼起来时间戳重叠
    const secondSegFirst = out.beatGrid[3]!;
    expect(secondSegFirst.atSec).toBeGreaterThanOrEqual(REAL_ROWS[1]!.startSec);

    expect(out.reusableZh).toBeTruthy();
    expect(out.genPromptHintZh).toBeTruthy();
  });

  it("往返：适配器 → 卡片 → 序列化 → 再解析 → 编剧注入，六栏一路不丢", () => {
    const out = mapNativeDeepReadSegments(REAL_ROWS);
    const card = parseManhuaViralTemplateCard({
      id: "tpl_series_native01",
      nameZh: "原生精读样例",
      laneZh: "古言种田",
      summaryZh: "逐镜六栏 + 可复用手法。",
      hook3sZh: "开场对峙即压满。",
      status: "approved",
      beatGrid: out.beatGrid,
      reusableZh: out.reusableZh,
      genPromptHintZh: out.genPromptHintZh,
      scenePoolHints: ["夹道"],
      castShape: { leadDesireZh: "求生", pressureZh: "被围" },
      densityHints: { minBodyChars: 800, minDialogueLines: 6, minLocationHits: 2 },
      sourceRefs: [],
    }) as ManhuaViralTemplateCard;
    expect(card).not.toBeNull();
    expect(isNativeVideoLearnedTemplate(card)).toBe(true);

    // 序列化落库 → 再读回来
    const round = parseManhuaViralTemplateCard(JSON.parse(JSON.stringify(card)))!;
    expect(round.beatGrid).toHaveLength(out.beatGrid.length);
    expect(round.beatGrid[0]!.cameraMoveZh).toBe("固定机位");
    expect(round.beatGrid[0]!.transitionInZh).toBe("硬切");
    expect(round.reusableZh).toBe(out.reusableZh);

    // 编剧注入必须带上这两栏，否则学到的手法进不了扩写模型
    const skill = formatManhuaViralTemplateWriterSkillFromCard(round);
    expect(skill).toContain("可复用导演手法");
    expect(skill).toContain("生成画面要素");
  });

  it("消费端保留完整镜头集，只按目标时长重映射秒位", () => {
    // 造 95 镜（与实测规模一致），映射到 6 段时一镜也不能少
    const many = Array.from({ length: 95 }, (_, i) => ({
      atSec: i * 3,
      conflictZh: `c${i}`,
      visualZh: `v${i}`,
      shotSizeZh: "特写",
    }));
    const fitted = fitManhuaViralBeatGridToSegments(many, 6);
    expect(fitted).toHaveLength(95);
    expect(fitted[0]!.atSec).toBe(0);
    expect(fitted[fitted.length - 1]!.atSec).toBe(75);
    expect(fitted[fitted.length - 1]!.visualZh).toBe("v94");
  });

  it("坏行不炸链路：failed 段与非法 JSON 直接跳过", () => {
    const out = mapNativeDeepReadSegments([
      ...REAL_ROWS,
      { seg: 9, startSec: 999, failed: true },
      { seg: 10, startSec: 1000, text: "不是 JSON" },
    ]);
    expect(out.segmentCount).toBe(2);
    expect(out.shotCount).toBe(6);
  });
});

describe("适配器失败与超限语义（复审第六项）", () => {
  const seg = (shots: unknown[], extra?: Record<string, unknown>) => ({
    seg: 0,
    startSec: 0,
    text: JSON.stringify({ shots, beatStructureZh: "憋4秒后爆", reusableZh: "手法" }),
    ...extra,
  });
  const shot = (i: number, patch?: Record<string, unknown>) => ({
    startSec: i,
    endSec: i + 1,
    shotSizeZh: "特写",
    actionZh: `动作${i}`,
    ...patch,
  });

  it("finish=length 的段整段丢弃，并计入 failedSegmentCount", () => {
    const out = mapNativeDeepReadSegments([
      seg([shot(0), shot(1)]),
      seg([shot(2)], { seg: 1, startSec: 30, finish: "length" }),
    ]);
    expect(out.segmentCount).toBe(1);
    expect(out.shotCount).toBe(2);
    expect(out.failedSegmentCount).toBe(1);
  });

  it("动作为空的镜头丢弃而不是写「未标注」占位", () => {
    const out = mapNativeDeepReadSegments([
      seg([shot(0), shot(1, { actionZh: "" }), shot(2, { actionZh: "   " })]),
    ]);
    expect(out.shotCount).toBe(1);
    expect(out.droppedCount).toBe(2);
    expect(JSON.stringify(out.beatGrid)).not.toContain("未标注");
  });

  it("超过 128 镜仍一镜不少，正式证据层不再抽稀", () => {
    const out = mapNativeDeepReadSegments([
      seg(Array.from({ length: 130 }, (_, i) => shot(i))),
    ]);
    expect(out.truncated).toBe(false);
    expect(out.shotCount).toBe(130);
    expect(out.beatGrid[128]!.visualZh).toBe("动作128");
    expect(out.beatGrid[out.beatGrid.length - 1]!.visualZh).toBe("动作129");
  });

  it("分片映射不裁 512 条字幕、20 个声音块或每类 8 个标签", () => {
    const row = JSON.parse(seg([shot(0)]).text) as Record<string, unknown>;
    row.subtitles = Array.from({ length: 520 }, (_, index) => ({ atSec: index / 10, textZh: `字幕${index}` }));
    row.audioResolution = [];
    row.classification = {
      emotionTagsZh: Array.from({ length: 12 }, (_, index) => `情绪${index}`),
      narrativeFeatureTagsZh: Array.from({ length: 11 }, (_, index) => `叙事${index}`),
      performanceTagsZh: Array.from({ length: 10 }, (_, index) => `表演${index}`),
      audiovisualTagsZh: Array.from({ length: 9 }, (_, index) => `视听${index}`),
      audienceExperienceTagsZh: Array.from({ length: 13 }, (_, index) => `体验${index}`),
    };
    const out = mapNativeDeepReadSegments([{ startSec: 0, text: JSON.stringify(row) }]);
    expect(out.subtitleTrack).toHaveLength(520);
    expect(out.classification?.emotionTagsZh).toHaveLength(12);
    expect(out.classification?.audienceExperienceTagsZh).toHaveLength(13);
  });

  it("未超限时 truncated=false 且一镜不少", () => {
    const out = mapNativeDeepReadSegments([
      seg(Array.from({ length: 95 }, (_, i) => shot(i))),
    ]);
    expect(out.truncated).toBe(false);
    expect(out.shotCount).toBe(95);
  });
});
