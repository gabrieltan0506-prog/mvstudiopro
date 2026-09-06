import { describe, expect, it } from "vitest";
import { assertNativeStructuringAnalysis } from "./manhuaNativeStructuringAnalysis.js";

// 同源真实探针的分析字段；不含凭证或模型原始长响应。
const qwenAnalysis = {
  "templateTitleZh": "女司斩妖揭寺敛财·假佛荒庙型首集立威卡名：从镇魔司密语接令、酒肆民怨铺陈，到女首领斩僧立威、黑熊精假佛惑众，突出首集独有的斩妖立威与伪佛讽刺主线。核心主线是黑熊精案卷引出宝刹寺包庇与民间盲信，手法特色集中在特写推近、白闪斩、逆光剪影与伪佛荒诞对照。卡名控制在10到20字，并避开禁用通用词。情绪线从回廊密谈的警惕戒备起，经酒肆盲信与挑夫悲控推高愤怒，县衙对质里压抑与机锋交叠，最终在女首领瞬杀狂僧与脚踩装昏官员时翻成爽快霸气的立威；尾段黑熊精假佛讲法又把情绪压入荒诞惊悚的寒意里。叙事上用多重视角交叉铺陈黑熊精案卷，先以同僚密语与酒肆民怨悬念蓄势，再让县衙对质、庭院拔剑与内堂银票谈判双线并行，最后以雷厉风行的斩僧、审官和直捣破庙完成反转制裁与真相揭露。表演上靠微表情克制与眼神情绪转变撑起姜队正的冷峻威严，同时用僧人的癫狂叫嚣、县令的虚伪逢迎、挑夫的悲怆嘶吼与青年的愤怒拔剑形成强烈群像反差。视听上以冷暖对比打光、前后景纵深构图和紧凑动势剪辑推进冲突，关键处用特写推镜、剑刃抽拔、破门打击、白闪斩与逆光剪影把情绪爆点放大，黑熊精的佛妖杂糅造型进一步强化荒诞惊悚。观众体验从引人入胜的悬念与代入感起步，随百姓哭诉和门派包庇激起义愤，再在掌掴围殴与瞬杀狂僧处获得压抑释放的痛快解气，最后被假佛惑众的荒谬讽刺拉出脊背发凉的热血期待。",
  "classification": {
    "emotionTagsZh": [
      "警惕戒备",
      "狂暴战意",
      "荒诞盲信",
      "悲愤控诉",
      "威严从容",
      "悲愤",
      "压抑",
      "嘲弄",
      "紧张",
      "机锋",
      "隐忍",
      "愤怒",
      "果断",
      "爽快",
      "肃杀",
      "霸气",
      "荒诞",
      "嘲讽"
    ],
    "narrativeFeatureTagsZh": [
      "多重视角交叉",
      "悬念铺陈",
      "群像性格反差",
      "虚实对照",
      "双线并行",
      "利益交换",
      "正邪讽刺",
      "冲突升级",
      "阶级冲突",
      "权谋立威",
      "反转制裁",
      "节奏紧凑",
      "雷厉风行",
      "反派作态",
      "真相揭露",
      "讽刺现实",
      "群像对比"
    ],
    "performanceTagsZh": [
      "微表情克制",
      "肢体爆发力强",
      "对白节奏鲜明",
      "眼神情绪转变",
      "冷面隐忍",
      "虚伪逢迎",
      "暴怒拔剑",
      "从容诡黠",
      "冷峻威严",
      "小人得志",
      "暴烈刚猛",
      "狼狈惊怒",
      "冷面果决",
      "色厉内荏",
      "癫狂叫嚣",
      "谄媚丑态",
      "虚伪狂妄"
    ],
    "audiovisualTagsZh": [
      "冷暖对比打光",
      "紧凑动势剪辑",
      "前后景纵深构图",
      "写实声效强化",
      "特写推镜",
      "剑刃抽拔",
      "光影对峙",
      "紧凑剪辑",
      "近景特写",
      "破门打击",
      "高速剪辑",
      "拳肉声效",
      "白光闪斩",
      "逆光剪影",
      "音画留白",
      "极特写对决",
      "佛妖杂糅"
    ],
    "audienceExperienceTagsZh": [
      "引人入胜",
      "情绪大起大落",
      "代入感深刻",
      "期待感拉满",
      "义愤填膺",
      "悬念丛生",
      "剧情反转",
      "压抑释放",
      "痛快解气",
      "爽快利落",
      "脊背发凉",
      "荒谬讽刺",
      "热血期待"
    ]
  }
};
const glmAnalysis = {
  "templateTitleZh": "女队正剿妖斩伪佛僧·万妖图录得道行型",
  "classification": {
    "emotionTagsZh": [
      "警惕戒备",
      "狂暴战意",
      "荒诞盲信",
      "悲愤控诉",
      "威严从容",
      "悲愤",
      "压抑",
      "嘲弄",
      "紧张",
      "机锋",
      "隐忍",
      "愤怒",
      "果断",
      "爽快",
      "肃杀",
      "霸气",
      "荒诞",
      "嘲讽"
    ],
    "narrativeFeatureTagsZh": [
      "多重视角交叉",
      "悬念铺陈",
      "群像性格反差",
      "虚实对照",
      "双线并行",
      "利益交换",
      "正邪讽刺",
      "冲突升级",
      "阶级冲突",
      "权谋立威",
      "反转制裁",
      "节奏紧凑",
      "雷厉风行",
      "反派作态",
      "真相揭露",
      "讽刺现实",
      "群像对比"
    ],
    "performanceTagsZh": [
      "微表情克制",
      "肢体爆发力强",
      "对白节奏鲜明",
      "眼神情绪转变",
      "冷面隐忍",
      "虚伪逢迎",
      "暴怒拔剑",
      "从容诡黠",
      "冷峻威严",
      "小人得志",
      "暴烈刚猛",
      "狼狈惊怒",
      "冷面果决",
      "色厉内荏",
      "癫狂叫嚣",
      "谄媚丑态",
      "虚伪狂妄"
    ],
    "audiovisualTagsZh": [
      "冷暖对比打光",
      "紧凑动势剪辑",
      "前后景纵深构图",
      "写实声效强化",
      "特写推镜",
      "剑刃抽拔",
      "光影对峙",
      "紧凑剪辑",
      "近景特写",
      "破门打击",
      "高速剪辑",
      "拳肉声效",
      "白光闪斩",
      "逆光剪影",
      "音画留白",
      "极特写对决",
      "佛妖杂糅"
    ],
    "audienceExperienceTagsZh": [
      "引人入胜",
      "情绪大起大落",
      "代入感深刻",
      "期待感拉满",
      "义愤填膺",
      "悬念丛生",
      "剧情反转",
      "压抑释放",
      "痛快解气",
      "爽快利落",
      "脊背发凉",
      "荒谬讽刺",
      "热血期待"
    ]
  },
  "classificationProseZh": {
    "emotionZh": "情绪线以警惕戒备与压抑开篇，中段经酒肆盲信狂辩与挑夫血泪控诉翻入悲愤，再由破门掌掴与白光闪杀的爽快霸气推向宣泄顶点，收在黑熊假佛惑众的荒诞惊悚里。",
    "narrativeZh": "叙事以领案剿妖为主线，县衙对质与密室利诱双线并行，借养寇自重借妖敛财的真相揭露和假佛讲法的反派作态，完成正邪讽刺与冲突的层层升级。",
    "performanceZh": "表演上女首领冷面果决、微表情克制，恶僧先倨后恭色厉内荏，行者与虬髯大汉以暴烈刚猛的肢体爆发外化义愤，县令的谄媚丑态与青年的冷面隐忍互为反衬。",
    "audiovisualZh": "视听以冷暖对比打光与逆光剪影立威，白光闪斩、破门、掌掴等写实声效强化爆点，密集特写推镜捕捉眼神情绪转变，佛珠滚落的音画留白衬托杀伐后的死寂。",
    "audienceZh": "观众体验从长街跪求的压抑到围殴惩戒的痛快解气，情绪大起大落，又在假佛惑众处脊背发凉，荒谬讽刺与热血期待交织，剿妖之战的期待被拉满。"
  }
};

describe("整形分析消费契约", () => {
  it("拒绝真实 Qwen 564 字标题且不裁剪原始返回", () => {
    const original = JSON.stringify(qwenAnalysis);
    expect(qwenAnalysis.templateTitleZh).toHaveLength(564);
    expect(() => assertNativeStructuringAnalysis(qwenAnalysis)).toThrow(/templateTitleZh/);
    expect(JSON.stringify(qwenAnalysis)).toBe(original);
  });
  it("标题修短仍不能掩盖有分类证据却缺五维分析", () => {
    expect(() => assertNativeStructuringAnalysis({ ...qwenAnalysis, templateTitleZh: "女司斩妖揭寺敛财·假佛荒庙型" })).toThrow(/emotionZh/);
  });
  it("真实 GLM 标题与五维分析通过，原文保持不变", () => {
    const original = JSON.stringify(glmAnalysis);
    expect(() => assertNativeStructuringAnalysis(glmAnalysis)).not.toThrow();
    expect(JSON.stringify(glmAnalysis)).toBe(original);
  });
  it.each(["", "   ", null, 123, "题".repeat(61)])("拒绝非法标题 %s", (templateTitleZh) => {
    expect(() => assertNativeStructuringAnalysis({ ...glmAnalysis, templateTitleZh })).toThrow(/templateTitleZh/);
  });
  it.each([null, [], {}, { ...glmAnalysis.classificationProseZh, emotionZh: 123 }])("已存在的五维对象必须有五个字符串", (classificationProseZh) => {
    expect(() => assertNativeStructuringAnalysis({ classificationProseZh })).toThrow(/classificationProseZh/);
  });
  it("新卡有标签证据的维度拒绝纯空格判词", () => {
    expect(() => assertNativeStructuringAnalysis({ ...glmAnalysis, classificationProseZh: { ...glmAnalysis.classificationProseZh, emotionZh: "  " } })).toThrow(/emotionZh/);
  });
  it("兼容无标题旧卡和确定性拼接卡，不替它们生成分析", () => {
    expect(() => assertNativeStructuringAnalysis({ classification: glmAnalysis.classification })).not.toThrow();
    expect(() => assertNativeStructuringAnalysis({ reusableZh: "源证据", shots: [] })).not.toThrow();
  });
  it("无分类证据的维度允许空串", () => {
    expect(() => assertNativeStructuringAnalysis({ ...glmAnalysis, classification: {}, classificationProseZh: Object.fromEntries(Object.keys(glmAnalysis.classificationProseZh).map((key) => [key, ""])) })).not.toThrow();
  });
});

 it("新模型结果不能借旧卡兼容规则省略标题和五维分析", () => {
   const strict = { requireGeneratedAnalysis: true };
   expect(() => assertNativeStructuringAnalysis({ classification: glmAnalysis.classification }, strict)).toThrow(/templateTitleZh/);
   expect(() => assertNativeStructuringAnalysis({ templateTitleZh: "剧情标题", classification: glmAnalysis.classification }, strict)).toThrow(/classificationProseZh/);
   expect(() => assertNativeStructuringAnalysis(glmAnalysis, strict)).not.toThrow();
 });
