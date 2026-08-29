/**
 * 原生精读适配器回归。
 *
 * fixture 直接截取自 0823 真跑产出（qwen3.8-max 直读抖音 CDN，262 秒 → 95 镜），
 * 不是手编的形状 —— 手编 fixture 只能证明「代码自洽」，证明不了「能吃真实上游」。
 */
import { describe, expect, it } from "vitest";
import { mapNativeDeepReadSegments } from "./manhuaNativeDeepRead";
import {
  formatManhuaViralTemplateWriterAddonFromCard,
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

  it("独立站位与表演字段从段 JSON 经卡片往返后进入编剧消费端", () => {
    const detailed = shot(0, {
      unitTypeZh: "剪辑镜头",
      angleZh: "平视",
      compositionZh: "双人分居画面两侧，中间保留压迫负空间",
      cameraMoveZh: "固定机位，以构图变化承接关系变化",
      blockingZh: "主角靠左后退，对手从右侧逼近",
      bodyActionZh: "主角重心后移后重新站稳",
      limbPropActionZh: "主角左手护住卷轴，右手撑地起身",
      microExpressionZh: "瞳孔收紧后下颌绷住",
      gazeBreathZh: "视线先避让再锁定对手，呼吸由乱转稳",
      relationshipReactionZh: "对手逼近触发主角后退，主角站稳迫使对手停步",
      lightingZh: "右侧冷光压迫，左侧暖光逐渐抬起",
      transitionInZh: "硬切",
    });
    const out = mapNativeDeepReadSegments([seg([detailed])]);
    const parsed = parseManhuaViralTemplateCard({
      id: "tpl_series_detailed01",
      nameZh: "独立表演证据",
      laneZh: "古言种田",
      summaryZh: "保留站位与表演证据。",
      hook3sZh: "关系变化立即可见。",
      status: "approved",
      beatGrid: out.beatGrid,
      scenePoolHints: [],
      castShape: { leadDesireZh: "站稳", pressureZh: "逼近" },
      densityHints: { minBodyChars: 800, minDialogueLines: 6, minLocationHits: 2 },
      sourceRefs: [],
    })!;
    expect(parsed.beatGrid[0]).toMatchObject({
      unitTypeZh: "剪辑镜头",
      blockingZh: "主角靠左后退，对手从右侧逼近",
      microExpressionZh: "瞳孔收紧后下颌绷住",
      gazeBreathZh: "视线先避让再锁定对手，呼吸由乱转稳",
      relationshipReactionZh: "对手逼近触发主角后退，主角站稳迫使对手停步",
    });
    const writerAddon = formatManhuaViralTemplateWriterAddonFromCard(parsed);
    expect(writerAddon).toContain("站位调度=主角靠左后退，对手从右侧逼近");
    expect(writerAddon).toContain("微表情=瞳孔收紧后下颌绷住");
    expect(writerAddon).toContain("关系反应=对手逼近触发主角后退，主角站稳迫使对手停步");
  });

  it("0829 新口径：finish=length 的段保留可解析内容，不再整段丢弃", () => {
    const out = mapNativeDeepReadSegments([
      seg([shot(0), shot(1)]),
      seg([shot(2)], { seg: 1, startSec: 30, finish: "length" }),
    ]);
    // 截断段的已有镜头照常入卡（0829 实证：两段 65k token 内容曾被整段丢弃白烧 ¥13）
    expect(out.segmentCount).toBe(2);
    expect(out.shotCount).toBe(3);
    expect(out.failedSegmentCount).toBe(0);
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

  it("招商镜头保留在原始 JSON，但不进入 beatGrid；广告区间字幕同步排除", () => {
    const row = JSON.parse(seg([
      shot(0, { evidenceRole: "non_story_ad", actionZh: "片头招商落版" }),
      shot(1, { evidenceRole: "story", actionZh: "角色进入正片场景" }),
    ]).text) as Record<string, unknown>;
    row.subtitles = [
      { atSec: 0.5, textZh: "招商字幕" },
      { atSec: 1.5, textZh: "剧情字幕" },
    ];
    const out = mapNativeDeepReadSegments([{ startSec: 0, text: JSON.stringify(row) }]);
    expect(out.beatGrid).toHaveLength(1);
    expect(out.beatGrid[0]!.visualZh).toBe("角色进入正片场景");
    expect(out.subtitleTrack).toEqual([{ atSec: 1.5, textZh: "剧情字幕" }]);
    expect(out.droppedCount).toBe(0);
  });

  it("整集卡 excludedAdRanges 过 schema 后原样透传；无广告缺省；非法区间整段拒收", () => {
    const row = JSON.parse(seg([
      shot(0, { evidenceRole: "story" }),
      shot(1, { evidenceRole: "story" }),
    ]).text) as Record<string, unknown>;
    row.excludedAdRanges = [{ startSec: 2, endSec: 8 }];
    const out = mapNativeDeepReadSegments([{ startSec: 0, text: JSON.stringify(row) }]);
    expect(out.excludedAdRanges).toEqual([{ startSec: 2, endSec: 8 }]);

    // 无广告：字段缺省不出现
    const plain = mapNativeDeepReadSegments([seg([shot(0)])]);
    expect(plain.excludedAdRanges).toBeUndefined();

    // end<=start 或负秒位属非法区间，整段过不了 schema
    row.excludedAdRanges = [{ startSec: 8, endSec: 8 }];
    const invalid = mapNativeDeepReadSegments([{ startSec: 0, text: JSON.stringify(row) }]);
    expect(invalid.segmentCount).toBe(0);
    expect(invalid.failedSegmentCount).toBe(1);
  });

  it("未超限时 truncated=false 且一镜不少", () => {
    const out = mapNativeDeepReadSegments([
      seg(Array.from({ length: 95 }, (_, i) => shot(i))),
    ]);
    expect(out.truncated).toBe(false);
    expect(out.shotCount).toBe(95);
  });
});

describe("音频广告过滤只认真实段界（chunkSpans），禁猜起点", () => {
  const track = (fromSec: number, toSec: number, cueAtSecs: number[] = []) => ({
    fromSec,
    toSec,
    emotionArcZh: `情绪${fromSec}到${toSec}`,
    cues: cueAtSecs.map((atSec) => ({ atSec, kind: "sfx", detailZh: `事件${atSec}` })),
  });
  const analysis = (tracks: unknown[]) => ({
    audioTrack: tracks,
    audioBeatStructureZh: "先压后爆",
    mixNotesZh: "混音备注",
    reusableAudioZh: "可复用声音",
    genAudioHintZh: "生成提示",
  });
  const storyShot = (startSec: number, endSec: number) => ({
    startSec,
    endSec,
    shotSizeZh: "特写",
    actionZh: `动作${startSec}`,
    evidenceRole: "story",
  });
  const adShot = (startSec: number, endSec: number) => ({
    startSec,
    endSec,
    shotSizeZh: "全景",
    actionZh: "招商落版",
    evidenceRole: "non_story_ad",
  });
  const row = (inner: Record<string, unknown>) => ({
    startSec: 0,
    finish: "stop",
    text: JSON.stringify({ beatStructureZh: "憋4秒后爆", ...inner }),
  });

  it("确定性多行路径：段首广告删整轨、跨界轨保留但剔广告 cue（360s 非 300s 段）", () => {
    // 段 0 真实段界 0..360（360 秒旧段，非 300s），段首 0..10 是广告。
    const out = mapNativeDeepReadSegments([
      row({
        shots: [adShot(0, 10), storyShot(10, 360)],
        audioResolution: [{
          chunkIndex: 0,
          analysis: analysis([
            track(0, 10), // 局部 0..10 = 绝对 0..10，整段落广告 → 删
            track(8, 30, [9, 12]), // 跨界轨保留；cue 绝对 9 在广告内删，12 保留
          ]),
        }],
        chunkSpans: [{ chunkIndex: 0, startSec: 0, endSec: 360 }],
      }),
      // 段 1 真实段界 360..600：段中广告 400..410。
      row({
        shots: [storyShot(360, 400), adShot(400, 410), storyShot(410, 600)],
        audioResolution: [{
          chunkIndex: 1,
          analysis: analysis([
            track(40, 50), // 绝对 400..410 整段落广告 → 删
            track(0, 40, [30]), // 绝对 360..400，cue 绝对 390 保留
            track(45, 80, [46, 55]), // 绝对 405..440 跨界保留；cue 绝对 406 删、415 留
          ]),
        }],
        chunkSpans: [{ chunkIndex: 1, startSec: 360, endSec: 600 }],
      }),
    ]);
    expect(out.audioAdFilterSkipped).toBeUndefined();
    expect(out.resolvedAudioChunks).toHaveLength(2);

    const chunk0 = out.resolvedAudioChunks[0]!;
    expect(chunk0.chunkIndex).toBe(0);
    expect(chunk0.analysis.audioTrack).toHaveLength(1);
    expect(chunk0.analysis.audioTrack[0]!.fromSec).toBe(8);
    expect(chunk0.analysis.audioTrack[0]!.cues.map((cue) => cue.atSec)).toEqual([12]);

    const chunk1 = out.resolvedAudioChunks[1]!;
    expect(chunk1.chunkIndex).toBe(1);
    expect(chunk1.analysis.audioTrack.map((t) => t.fromSec)).toEqual([0, 45]);
    expect(chunk1.analysis.audioTrack[0]!.cues.map((cue) => cue.atSec)).toEqual([30]);
    expect(chunk1.analysis.audioTrack[1]!.cues.map((cue) => cue.atSec)).toEqual([55]);
  });

  it("GLM 合并单行卡：多 chunk 各按自己的真实起点换算，min(shot.startSec) 猜法必然错删/漏删", () => {
    // 整集单行卡：shots 从 0 起，excludedAdRanges 在 400..410；
    // chunk1 真实起点 360 —— 若按旧猜法 min(shot.startSec)=0，局部 40..50 会被当成绝对 40..50 漏删。
    const out = mapNativeDeepReadSegments([
      row({
        shots: [storyShot(0, 360), storyShot(360, 400), storyShot(410, 600)],
        excludedAdRanges: [{ startSec: 400, endSec: 410 }],
        audioResolution: [
          {
            chunkIndex: 0,
            analysis: analysis([track(350, 360)]), // 绝对 350..360，不在广告 → 保留
          },
          {
            chunkIndex: 1,
            analysis: analysis([
              track(40, 50), // 绝对 400..410 整段落广告 → 删
              track(0, 60, [39, 45, 50]), // 跨界保留；cue 绝对 399 留、405 删、410（=区间右开端）留
            ]),
          },
        ],
        chunkSpans: [
          { chunkIndex: 0, startSec: 0, endSec: 360 },
          { chunkIndex: 1, startSec: 360, endSec: 600 },
        ],
      }),
    ]);
    expect(out.audioAdFilterSkipped).toBeUndefined();
    expect(out.resolvedAudioChunks).toHaveLength(2);
    expect(out.resolvedAudioChunks[0]!.analysis.audioTrack).toHaveLength(1);
    expect(out.resolvedAudioChunks[0]!.analysis.audioTrack[0]!.fromSec).toBe(350);

    const chunk1 = out.resolvedAudioChunks[1]!;
    expect(chunk1.analysis.audioTrack).toHaveLength(1);
    expect(chunk1.analysis.audioTrack[0]!.fromSec).toBe(0);
    expect(chunk1.analysis.audioTrack[0]!.cues.map((cue) => cue.atSec)).toEqual([39, 50]);
  });

  it("全广告 chunk：真实段界完全落入广告区间时音轨全删但 chunk 身份保留", () => {
    const out = mapNativeDeepReadSegments([
      row({
        shots: [adShot(0, 30), storyShot(30, 60)],
        audioResolution: [{
          chunkIndex: 0,
          analysis: analysis([track(0, 10), track(10, 30, [15])]),
        }],
        chunkSpans: [{ chunkIndex: 0, startSec: 0, endSec: 30 }],
      }),
    ]);
    expect(out.resolvedAudioChunks).toHaveLength(1);
    expect(out.resolvedAudioChunks[0]!.chunkIndex).toBe(0);
    expect(out.resolvedAudioChunks[0]!.analysis.audioTrack).toEqual([]);
  });

  it("旧卡无 chunkSpans 且有广告：跳过音频过滤、原样保留并打 audioAdFilterSkipped 标记", () => {
    const out = mapNativeDeepReadSegments([
      row({
        shots: [adShot(0, 10), storyShot(10, 60)],
        audioResolution: [{
          chunkIndex: 0,
          analysis: analysis([track(0, 10, [5]), track(10, 60)]),
        }],
        // 故意不带 chunkSpans：旧卡形状
      }),
    ]);
    expect(out.audioAdFilterSkipped).toBe(true);
    // 宁可保留原始音轨（含广告区间内 0..10 轨与 cue 5），也不用猜的偏移错删
    expect(out.resolvedAudioChunks[0]!.analysis.audioTrack).toHaveLength(2);
    expect(out.resolvedAudioChunks[0]!.analysis.audioTrack[0]!.cues.map((cue) => cue.atSec)).toEqual([5]);
  });

  it("无广告区间：无论有没有 chunkSpans 都不打标记、音轨原样", () => {
    const out = mapNativeDeepReadSegments([
      row({
        shots: [storyShot(0, 60)],
        audioResolution: [{ chunkIndex: 0, analysis: analysis([track(0, 60, [30])]) }],
      }),
    ]);
    expect(out.audioAdFilterSkipped).toBeUndefined();
    expect(out.resolvedAudioChunks[0]!.analysis.audioTrack).toHaveLength(1);
    expect(out.resolvedAudioChunks[0]!.analysis.audioTrack[0]!.cues.map((cue) => cue.atSec)).toEqual([30]);
  });
});


describe("v11 · advisory 段号与 truncated 落盘", () => {
  const shot = (startSec: number, endSec: number) => ({
    startSec,
    endSec,
    shotSizeZh: "特写",
    actionZh: `动作${startSec}`,
    evidenceRole: "story",
  });
  const segRow = (input: {
    startSec: number;
    finish?: string;
    failed?: boolean;
    inner?: Record<string, unknown>;
  }) => ({
    startSec: input.startSec,
    finish: input.finish ?? "stop",
    ...(input.failed ? { failed: true } : {}),
    text: JSON.stringify({
      beatStructureZh: "憋4秒后爆",
      shots: [shot(0, 30)],
      ...(input.inner ?? {}),
    }),
  });

  it("seg0 失败时，seg1 的截断提示必须挂在第2段（不能用过滤后下标）", () => {
    const out = mapNativeDeepReadSegments([
      segRow({ startSec: 0, failed: true }),
      segRow({ startSec: 300, finish: "length" }),
    ]);
    const truncatedRows = (out.advisories ?? []).filter((row) => row.code === "truncated");
    expect(truncatedRows).toHaveLength(1);
    expect(truncatedRows[0]!.segmentIndex).toBe(1);
    expect(truncatedRows[0]!.detailZh).toContain("第2段");
  });

  it("段卡自带 truncated:true（缓存命中路径）同样算截断，不依赖外层 finish", () => {
    const out = mapNativeDeepReadSegments([
      segRow({ startSec: 0, inner: { truncated: true } }),
    ]);
    expect(out.truncated).toBe(true);
    expect((out.advisories ?? []).some((row) => row.code === "truncated")).toBe(true);
  });

  it("段卡已带 truncated advisory 时不重复补第二条", () => {
    const out = mapNativeDeepReadSegments([
      segRow({
        startSec: 0,
        finish: "length",
        inner: {
          truncated: true,
          advisories: [{ code: "truncated", detailZh: "第1段被截断", segmentIndex: 0 }],
        },
      }),
    ]);
    expect((out.advisories ?? []).filter((row) => row.code === "truncated")).toHaveLength(1);
  });

  it("段卡自带 advisory 缺 segmentIndex 时按入参下标补全", () => {
    const out = mapNativeDeepReadSegments([
      segRow({ startSec: 0 }),
      segRow({
        startSec: 300,
        inner: { advisories: [{ code: "audio_track_thin", detailZh: "音轨仅 1 段" }] },
      }),
    ]);
    const thin = (out.advisories ?? []).find((row) => row.code === "audio_track_thin");
    expect(thin?.segmentIndex).toBe(1);
  });
});
