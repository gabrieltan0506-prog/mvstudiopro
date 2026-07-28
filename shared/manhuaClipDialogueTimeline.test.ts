import { describe, expect, it } from "vitest";
import {
  buildManhuaDialogueTimelineBeats,
  extractManhuaSceneHintFromPrompt,
  formatManhuaDialogueTimelineBlock,
  resolveManhuaBeatFunctionZh,
  MANHUA_BEAT_FUNCTION_VOCAB_ZH,
  MANHUA_CROSS_SHOT_CONTINUITY_LOCK,
  MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK,
} from "./manhuaClipDialogueTimeline";
import { formatWorkbenchSegmentClipInjectBlock } from "./manhuaScriptWorkbench";

describe("manhuaClipDialogueTimeline", () => {
  it("assigns second ranges and emotion fields per shot", () => {
    const beats = buildManhuaDialogueTimelineBeats(
      [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "抬头",
          dialogueZh: "拿着",
          emotionZh: "决绝",
          microExpressionZh: "下颌绷紧",
        },
        {
          index: 2,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "后退",
          dialogueZh: "你早就知道了？",
          emotionZh: "不信",
          microExpressionZh: "眼眶发红",
        },
      ],
      15,
    );
    expect(beats).toHaveLength(2);
    expect(beats[0]?.startSec).toBe(0);
    expect(beats[0]?.endSec).toBe(7.5);
    expect(beats[1]?.startSec).toBe(7.5);
    expect(beats[1]?.dialogueZh).toContain("你早就知道了");
    expect(beats[0]?.microExpressionZh).toContain("下颌");
  });

  it("formats second-axis with action/camera tracks and framing", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 5,
          durationSec: 0,
          cameraZh: "近景，微推",
          actionZh: "@角色2 握拳对峙",
          dialogueZh: "放开！",
          emotionZh: "怒",
          microExpressionZh: "咬牙",
          voiceToneZh: "压嗓",
        },
      ],
      15,
      {
        segmentIndex: 2,
        sceneHintZh: "古宅廊下",
        lightingCameraZh: "侧逆光压暗",
        paletteZh: "冷青",
      },
    );
    expect(block).toContain("0–15s：");
    // 顺叙白描：先机位后动作，不再是字段表
    expect(block).toContain("近景微推；握拳对峙，咬牙");
    expect(block).not.toContain("动作轨迹：");
    expect(block).not.toContain("景别：");
    // 演技三维都要落到秒轴：只给台词内容，引擎只会念不会演
    expect(block).toContain("怒");
    expect(block).toContain("以压嗓说「放开！」");
    // 光与氛围归段头【光影·景别·氛围】写一次；秒轴复读只会让同一串配色刷屏
    expect(block).not.toContain("光：侧逆光压暗");
    expect(block).not.toContain("氛围：冷青");
    expect(block).toContain("@角色2");
    expect(block).toContain("说「放开！」");
    expect(block).not.toContain("视频生成导戏单");
    expect(block).not.toMatch(/衔接：|\d+mm|快门/);
    expect(MANHUA_CROSS_SHOT_CONTINUITY_LOCK).toMatch(/换脸|服装|跳棚/);
    expect(MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK).toMatch(/引擎同轮出声|口型|时间轴|禁止另开后期配音/);
  });

  it("stops repeating segment-level light/palette/expression on every beat", () => {
    // 取自线上第1段实测：三镜的光、氛围、微表情逐字相同，配色一段里出现五次
    const shots = [
      {
        index: 1,
        durationSec: 5,
        cameraZh: "全景，平视，缓慢推近",
        actionZh: "极速拉远，夜雨中燃烧的火箭死死钉入湿滑桥板，火星四溅",
        dialogueZh: "箭上有火，账册在桥中央！",
        microExpressionZh: "眼神由惊转硬",
      },
      {
        index: 2,
        durationSec: 5,
        cameraZh: "中景，固定机位，三分构图",
        actionZh: "手持微晃，黑衣剑客抬脚重踏踩灭箭火",
        dialogueZh: "你取账，我断绳。",
        microExpressionZh: "眼神由惊转硬",
      },
      {
        index: 3,
        durationSec: 5,
        cameraZh: "中近景，轻微横移",
        actionZh: "过肩跟拍，白衣女子在雨中拔出赤绳短剑",
        dialogueZh: "桥上一个不留！",
        microExpressionZh: "眼神由惊转硬",
      },
    ];
    const block = formatManhuaDialogueTimelineBlock(shots, 15, {
      segmentIndex: 1,
      sceneHintZh: "断月桥",
      lightingCameraZh: "火箭入画开场，贴桥板低机位推进",
      paletteZh: "墨蓝雨夜、火焰橙红、湿木冷褐",
    });

    // 段级常量一次都不该出现在秒轴里
    expect(block).not.toContain("光：");
    expect(block).not.toContain("氛围：");
    expect(block).not.toContain("贴桥板低机位推进");
    expect(block).not.toContain("墨蓝雨夜");

    // 三镜同一个微表情 → 提到段头写一次，秒轴不复读
    expect(block).toContain("【表演基调】微表情：眼神由惊转硬（贯穿本段）。");
    expect(block.match(/眼神由惊转硬/g)).toHaveLength(1);

    // 运镜栏已有权威值时，动作栏开头的运镜词要剥掉，别和运镜栏打架
    expect(block).not.toContain("极速拉远");
    expect(block).not.toContain("手持微晃");
    expect(block).not.toContain("过肩跟拍");
    expect(block).toContain("夜雨中燃烧的火箭死死钉入湿滑桥板，火星四溅");
    expect(block).toContain("说「箭上有火，账册在桥中央！」");
  });

  it("keeps per-beat expression when the shots actually differ", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        { index: 1, durationSec: 5, cameraZh: "近景", actionZh: "抬头", microExpressionZh: "眼眶发红" },
        { index: 2, durationSec: 5, cameraZh: "中景", actionZh: "后退", microExpressionZh: "下颌绷紧" },
      ],
      10,
    );
    expect(block).not.toContain("【表演基调】");
    expect(block).toContain("眼眶发红");
    expect(block).toContain("下颌绷紧");
  });

  /**
   * 表演三维分开判定：情绪常贯穿整段，微表情却逐镜递进。合成一个值去重会
   * 把递进的那一维也当成复读吞掉，演技张力就被抹平了。
   */
  it("hoists only the dimension that actually repeats", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "近景",
          actionZh: "攥紧衣角",
          dialogueZh: "我没事。",
          emotionZh: "隐忍",
          microExpressionZh: "眼眶发红",
          voiceToneZh: "气声",
        },
        {
          index: 2,
          durationSec: 5,
          cameraZh: "中景",
          actionZh: "别开脸",
          dialogueZh: "你走吧。",
          emotionZh: "隐忍",
          microExpressionZh: "下颌绷紧",
          voiceToneZh: "气声",
        },
      ],
      10,
    );

    // 情绪与语气全段相同 → 段头写一次
    expect(block).toContain("【表演基调】情绪：隐忍｜语气：气声（贯穿本段）。");
    expect(block.match(/隐忍/g)).toHaveLength(1);
    expect(block.match(/气声/g)).toHaveLength(1);
    // 微表情逐镜不同 → 留在各自秒位，不能被一起吞掉
    expect(block).toContain("眼眶发红");
    expect(block).toContain("下颌绷紧");
    // 语气已提到段头，秒轴不再重复挂在台词上
    expect(block).toContain("说「我没事。」");
    expect(block).not.toContain("以气声说");
  });

  it("never strips a real action that merely starts with a camera-ish verb", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "中景，固定",
          // 「推开木门」是动作不是运镜，不能被当成运镜词剥掉
          actionZh: "推开木门，跨过门槛",
        },
      ],
      5,
    );
    expect(block).toContain("推开木门");
  });

  it("keeps the action camera word when there is no camera field to trust", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [{ index: 1, durationSec: 5, cameraZh: "", actionZh: "极速拉远，火箭钉入桥板" }],
      5,
    );
    expect(block).toContain("极速拉远");
  });

  it("expands inherently two-phase camera moves into a timed two-beat sequence", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "中景，推拉结合",
          actionZh: "@角色2 握拳对峙",
          dialogueZh: "放开！",
          emotionZh: "怒",
        },
      ],
      5,
    );
    // 不再只落「推拉结合」标签：单镜 ≥4s 展开成「先A，后B」时序
    expect(block).toContain("中景·先缓推贴近主体，后匀速拉远还原；");
    expect(block).not.toContain("中景推拉结合；");
  });

  it("keeps writer's own sequenced camera text as-is (no re-expansion)", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "全景，先环绕半周看清局势，再推近到面部",
          actionZh: "环视灵力流向",
        },
      ],
      5,
    );
    expect(block).toContain("先环绕半周看清局势，再推近到面部");
    expect(block).not.toContain("先先");
  });

  it("does not expand single-phase moves or sub-4s beats", () => {
    const single = formatManhuaDialogueTimelineBlock(
      [{ index: 1, durationSec: 5, cameraZh: "近景，微推", actionZh: "抬头" }],
      5,
    );
    expect(single).toContain("近景微推；");
    expect(single).not.toMatch(/先.+，后.+；/);

    // 15s 五镜 = 每镜 3s，不足 4s 不展开
    const short = formatManhuaDialogueTimelineBlock(
      Array.from({ length: 5 }, (_, i) => ({
        index: i + 1,
        durationSec: 3,
        cameraZh: "中景，推拉结合",
        actionZh: "对峙",
      })),
      15,
    );
    expect(short).not.toContain("先缓推贴近主体");
  });

  describe("节拍功能进秒轴（C）", () => {
    it("resolveManhuaBeatFunctionZh 按弧位/线索判功能", () => {
      // 全集第1段第1拍 → 开场钩子
      expect(
        resolveManhuaBeatFunctionZh({ globalSegmentIndex: 1, totalSegments: 6, beatIndex: 0, beatCount: 3 }),
      ).toBe("开场钩子");
      // 末段末拍 → 悬念钩子
      expect(
        resolveManhuaBeatFunctionZh({ globalSegmentIndex: 6, totalSegments: 6, beatIndex: 2, beatCount: 3 }),
      ).toBe("悬念钩子");
      // 带对白且命中揭示线索 → 信息揭示
      expect(
        resolveManhuaBeatFunctionZh({
          globalSegmentIndex: 3,
          totalSegments: 6,
          beatIndex: 1,
          beatCount: 3,
          hasDialogue: true,
          contextZh: "他掏出账册，账册就是证据",
        }),
      ).toBe("信息揭示");
      // 非末段末拍 → 转折
      expect(
        resolveManhuaBeatFunctionZh({ globalSegmentIndex: 2, totalSegments: 6, beatIndex: 2, beatCount: 3 }),
      ).toBe("转折");
      // 弧位兜底：前段建置 / 中段升级 / 后段高点
      expect(
        resolveManhuaBeatFunctionZh({ globalSegmentIndex: 2, totalSegments: 6, beatIndex: 0, beatCount: 3 }),
      ).toBe("建置");
      expect(
        resolveManhuaBeatFunctionZh({ globalSegmentIndex: 4, totalSegments: 6, beatIndex: 0, beatCount: 3 }),
      ).toBe("冲突升级");
      expect(
        resolveManhuaBeatFunctionZh({ globalSegmentIndex: 5, totalSegments: 6, beatIndex: 0, beatCount: 3 }),
      ).toBe("情绪高点");
      // 词库里的每个值都合法
      for (const v of MANHUA_BEAT_FUNCTION_VOCAB_ZH) expect(typeof v).toBe("string");
    });

    it("秒轴正文行首带〔功能〕标签，且不破坏时间头", () => {
      const block = formatManhuaDialogueTimelineBlock(
        [
          { index: 1, durationSec: 5, cameraZh: "近景", actionZh: "推门而入", dialogueZh: "你来了。" },
          { index: 2, durationSec: 5, cameraZh: "中景", actionZh: "拔刀" },
          { index: 3, durationSec: 5, cameraZh: "全景", actionZh: "收刀离去" },
        ],
        15,
        { segmentIndex: 1, totalSegments: 6, intentZh: "开场对峙" },
      );
      // 时间头保留、功能标签紧随其后
      expect(block).toContain("0–5s：〔开场钩子〕");
      // 每一拍都带一个功能标签
      expect((block.match(/〔[^〕]+〕/g) || []).length).toBe(3);
    });
  });

  it("extracts scene name from keyart prompt", () => {
    expect(
      extractManhuaSceneHintFromPrompt("前言\n【本集主场景优先】古宅廊下\n直接吸收"),
    ).toBe("古宅廊下");
  });

  it("segment clip inject locks scene/light and lists tracks per beat", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      sceneHintZh: "雨夜巷口",
      lightingCameraZh: "湿漉侧光",
      paletteZh: "青灰",
      sceneTag: "@场景1",
      shots: [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "@角色5 递出玉佩",
          dialogueZh: "拿着",
          emotionZh: "决绝",
          microExpressionZh: "目光钉死",
        },
        {
          index: 2,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "@角色4 握紧后退",
          dialogueZh: "你早就知道了？",
          emotionZh: "不信",
        },
      ],
    });
    expect(text).toContain("【第1段·15s】雨夜巷口");
    expect(text).toContain("【场景锁】");
    expect(text).toContain("@场景1");
    expect(text).toContain("【光影·景别·氛围】");
    expect(text).not.toContain("动作轨迹：");
    expect(text).toContain("近景");
    expect(text).toContain("中景");
    expect(text).toContain("说「拿着」");
    expect(text).toContain("说「你早就知道了？」");
    expect(text).not.toContain("视频生成导戏单");
    expect(text).not.toContain("跨镜连续硬锁");
    expect(text).not.toMatch(/衔接：|\d+mm|快门/);
  });

  it("backfills the segment's single speaker onto untagged lines (monologue scene)", () => {
    // 独角戏段：编剧只给第一句点了名，后面光秃「」句也归同一人——
    // 否则「说『…』」没有主语，口型与锁脸都挂不上。
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "近景，微推",
          actionZh: "@角色1 握剑而立",
          dialogueZh: "今晚过桥。",
        },
        {
          index: 2,
          durationSec: 5,
          cameraZh: "中景，固定",
          actionZh: "抬眼望向桥那头",
          dialogueZh: "谁拦谁死。",
        },
      ],
      10,
      { segmentIndex: 1 },
    );
    expect(block).toContain("@角色1说「今晚过桥。」");
    expect(block).toContain("@角色1说「谁拦谁死。」");
  });

  it("leaves untagged lines alone when the segment has multiple speakers", () => {
    // 群戏不猜说话人——猜错比不写更糟；该场景靠编剧引导点名。
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 1,
          durationSec: 5,
          cameraZh: "近景",
          actionZh: "@角色1 递出玉佩",
          dialogueZh: "拿着。",
        },
        {
          index: 2,
          durationSec: 5,
          cameraZh: "中景",
          actionZh: "@角色2 握紧后退",
          dialogueZh: "你早就知道了？",
        },
        {
          index: 3,
          durationSec: 5,
          cameraZh: "全景",
          actionZh: "两人对峙，风卷起衣摆",
          dialogueZh: "都别动。",
        },
      ],
      15,
      { segmentIndex: 1 },
    );
    expect(block).toContain("说「都别动。」");
    expect(block).not.toContain("@角色1说「都别动。」");
    expect(block).not.toContain("@角色2说「都别动。」");
  });
});
