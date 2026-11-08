import { describe, expect, it } from "vitest";
import {
  STOCK_KEYWORD_MAX_WORDS,
  STOCK_KEYWORD_MIN_WORDS,
  normalizeStockKeywordQuery,
  normalizeStockKeywordQueryZh,
  stockFootageSuggestKeywordsInputSchema,
  stripNonVisualText,
  suggestStockKeywordsByRules,
} from "./stockFootageKeywords";

const words = (q: string) => q.split(" ");
const rules = (text: string, purpose: "mv" | "marketing" | "digital_human" | "manhua" = "mv") =>
  suggestStockKeywordsByRules(text, purpose);

describe("suggestStockKeywordsByRules（正向：常见营销/MV/漫剧描述）", () => {
  it.each([
    ["城市夜景，车流穿梭", ["city", "night", "car"]],
    ["夕阳下的海边，海浪拍打沙滩", ["beach", "sunset", "ocean", "waves"]],
    ["女孩在咖啡店里喝咖啡，窗外下着雨", ["girl", "drinking", "coffee", "shop", "rain"]],
    ["白领在办公室对着电脑打字", ["businessman", "typing", "laptop", "office"]],
    ["妈妈在厨房做饭，温馨的家", ["woman", "cooking", "kitchen", "cozy"]],
    ["产品特写，口红缓慢旋转", ["product", "lipstick", "close", "up"]],
    ["熙熙攘攘的人群走过街道", ["crowd", "walking", "street"]],
    ["森林里的薄雾，清晨的阳光", ["forest", "fog", "morning"]],
    ["航拍雪山与天空", ["aerial", "snow", "mountain", "sky"]],
    ["古风宫殿庭院，灯笼在夜里亮起", ["ancient", "chinese", "palace", "courtyard"]],
    ["竹林中侠客舞剑", ["bamboo", "forest", "swordsman"]],
  ])("%s", (text, expected) => {
    const r = rules(text);
    for (const w of expected) expect(words(r.query)).toContain(w);
    expect(words(r.query).length).toBeGreaterThanOrEqual(STOCK_KEYWORD_MIN_WORDS);
    expect(words(r.query).length).toBeLessThanOrEqual(STOCK_KEYWORD_MAX_WORDS);
    expect(normalizeStockKeywordQuery(r.query)).toBe(r.query);
    expect(r.queryZh).toMatch(/[一-龥]/);
  });

  it("最长匹配：「城市夜景」不拆成「城市」+「夜」，中文展示对应", () => {
    const r = rules("城市夜景");
    expect(r.query).toBe("city night");
    expect(r.queryZh).toBe("城市夜景");
  });

  it("超过 6 词时按场景/人物优先截取，不出现重复词", () => {
    const r = rules("雨夜里女孩撑伞在城市街道奔跑，霓虹灯闪烁，慢动作特写，孤独伤感，航拍");
    const w = words(r.query);
    expect(w.length).toBeLessThanOrEqual(STOCK_KEYWORD_MAX_WORDS);
    expect(new Set(w).size).toBe(w.length);
    expect(w).toEqual(expect.arrayContaining(["girl", "city", "street"]));
  });

  it("只命中 1 个单词时补用途填充词凑够 2 词", () => {
    expect(rules("下雨", "mv").query).toBe("cinematic rain");
    expect(rules("下雨", "marketing").query).toBe("lifestyle rain");
  });

  it("英文直输只认词表单词，丢弃人名等任意英文", () => {
    const r = rules("Tom walking on the beach at sunset with Lucy");
    expect(r.query).toBe("walking beach sunset");
    expect(r.query).not.toMatch(/tom|lucy/);
  });
});

describe("suggestStockKeywordsByRules（反向：人名、对白、不可视概念）", () => {
  it("人名、对白与抽象概念不进搜索词", () => {
    const r = rules("林夏：“我们一定会成功的，梦想就在前方！”她站在天台上看着城市");
    expect(r.query).toBe("rooftop city");
    expect(r.query).not.toMatch(/dream|success|lin/);
  });

  it("「风格」「镜头」「马上」等拦截词不误命中风/马", () => {
    const r = rules("这个镜头的风格要马上改，画面高级一点");
    expect(r).toEqual({ query: "cinematic landscape", queryZh: "电影感风景" });
  });

  it("什么都没命中时给各用途默认词", () => {
    expect(rules("我们的理念是创新与坚持", "marketing")).toEqual({ query: "lifestyle people", queryZh: "生活场景" });
    expect(rules("……", "digital_human").query).toBe("modern office background");
    expect(rules("???", "manhua").query).toBe("ancient chinese landscape");
  });

  it("stripNonVisualText 去掉说话人前缀与引号对白", () => {
    expect(stripNonVisualText("张三：“快跑！”")).not.toContain("跑");
    expect(stripNonVisualText("张三：快跑！")).not.toContain("张三");
    expect(stripNonVisualText("卖点：轻薄防水")).toContain("轻薄防水");
    expect(stripNonVisualText("她站在天台上：城市在脚下")).toContain("天台");
    expect(stripNonVisualText("画面：“雨夜街头”")).toContain("雨夜街头");
    expect(stripNonVisualText("旁白（画外）：夜色降临")).not.toContain("旁白");
    expect(stripNonVisualText("旁白（画外）：夜色降临")).toContain("夜色降临");
    expect(stripNonVisualText("画面：城市夜景\n林夏：我们走吧。")).toContain("城市夜景");
    expect(stripNonVisualText("画面：城市夜景\n林夏：“我们走吧。”")).not.toContain("走");
    expect(stripNonVisualText("她说「下雨了」")).not.toContain("雨");
  });
});

describe("normalizeStockKeywordQuery（LLM 输出校验）", () => {
  it("正向：小写化、去填充词、接受逗号或数组", () => {
    expect(normalizeStockKeywordQuery("Woman drinking coffee, cafe")).toBe("woman drinking coffee cafe");
    expect(normalizeStockKeywordQuery("city night stock footage 4k")).toBe("city night");
    expect(normalizeStockKeywordQuery(["rain", "street"])).toBe("rain street");
  });
  it("正向：模型给出 7–10 个合格词时保留前 6 个（线上实测常见）", () => {
    expect(normalizeStockKeywordQuery("rainy city night neon reflections wet street")).toBe("rainy city night neon reflections wet");
  });
  it("反向：中文、数字符号、词数不足或超 10、非字符串一律拒收", () => {
    expect(normalizeStockKeywordQuery("城市 夜景")).toBeNull();
    expect(normalizeStockKeywordQuery("city night!!")).toBeNull();
    expect(normalizeStockKeywordQuery("rain")).toBeNull();
    expect(normalizeStockKeywordQuery(Array(11).fill("word").join(" "))).toBeNull();
    expect(normalizeStockKeywordQuery("Here are keywords: city night")).toBeNull();
    expect(normalizeStockKeywordQuery(42)).toBeNull();
    expect(normalizeStockKeywordQuery("")).toBeNull();
  });
  it("中文展示：必须含汉字、不含英文、≤20 字", () => {
    expect(normalizeStockKeywordQueryZh("城市夜景、街道")).toBe("城市夜景 街道");
    expect(normalizeStockKeywordQueryZh("city night")).toBeNull();
    expect(normalizeStockKeywordQueryZh("城市 Pexels")).toBeNull();
    expect(normalizeStockKeywordQueryZh("长".repeat(21))).toBeNull();
    expect(normalizeStockKeywordQueryZh(null)).toBeNull();
  });
});

describe("stockFootageSuggestKeywordsInputSchema", () => {
  it("正向：裁空白、方向可选", () => {
    expect(stockFootageSuggestKeywordsInputSchema.parse({ text: " 海边 ", purpose: "mv" })).toEqual({ text: "海边", purpose: "mv" });
    expect(stockFootageSuggestKeywordsInputSchema.parse({ text: "海边", purpose: "manhua", orientation: "portrait" }).orientation).toBe("portrait");
  });
  it("反向：空文本、超 1000 字、未知用途/方向、多余字段", () => {
    expect(stockFootageSuggestKeywordsInputSchema.safeParse({ text: "   ", purpose: "mv" }).success).toBe(false);
    expect(stockFootageSuggestKeywordsInputSchema.safeParse({ text: "海".repeat(1001), purpose: "mv" }).success).toBe(false);
    expect(stockFootageSuggestKeywordsInputSchema.safeParse({ text: "海边", purpose: "ads" }).success).toBe(false);
    expect(stockFootageSuggestKeywordsInputSchema.safeParse({ text: "海边", purpose: "mv", orientation: "wide" }).success).toBe(false);
    expect(stockFootageSuggestKeywordsInputSchema.safeParse({ text: "海边", purpose: "mv", userId: 1 }).success).toBe(false);
  });
});
