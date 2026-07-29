import { describe, expect, it } from "vitest";
import {
  buildManhuaPropPlateGenPrompt,
  buildManhuaScenePlateGenPrompt,
  compileManhuaScriptVisualBrief,
  looksLikeRawScriptDump,
  stripPropNarrativeFromVisualZh,
  summarizeManhuaVisualBriefForUi,
} from "./manhuaScriptVisualBrief";

describe("道具图软边界（修烧海报标题 bug）", () => {
  it("正面描述静物摄影与素净表面，不堆叠禁令", () => {
    const p = buildManhuaPropPlateGenPrompt({
      propNameZh: "赤绳短剑",
      propPromptZh: "窄刃短剑，剑柄缠赤绳",
    });
    expect(p).toContain("博物馆藏品级静物摄影");
    expect(p).toContain("素净的旧料本色");
    expect(p).toContain("窄刃短剑，剑柄缠赤绳");
    // 「标题/海报/书法」这些词本身会把概念喂旺，中文段里不许再出现
    expect(p).not.toMatch(/标题|海报|书法|印文/);
  });

  it("不把道具名、剧作功能、归属人名、题材句递进去当写字素材", () => {
    const p = buildManhuaPropPlateGenPrompt({
      propNameZh: "漕银账册",
      propPromptZh:
        "原创道具特写·漕银账册。外形材质：麻纸封皮，边角卷曲。剧作功能：父辈仇恨的直接来源，也是伪造线索。禁止可读文字。",
      ownerNameZh: "陆镇渊",
      topic: "朝堂江湖权谋恩仇记",
    });
    expect(p).toContain("麻纸封皮，边角卷曲");
    expect(p).not.toContain("漕银账册");
    expect(p).not.toContain("剧作功能");
    expect(p).not.toContain("伪造线索");
    expect(p).not.toContain("陆镇渊");
    expect(p).not.toContain("朝堂江湖权谋恩仇记");
  });

  it("文书/令牌类补一句纸面留白的正向描述", () => {
    for (const name of ["漕银账册", "双层密信", "巡察银令", "象牙色朝笏"]) {
      const p = buildManhuaPropPlateGenPrompt({ propNameZh: name });
      expect(p).toContain("一律留白");
      expect(p).toContain("压痕与折痕");
    }
  });

  it("普通器物不追加文书专用句", () => {
    const p = buildManhuaPropPlateGenPrompt({
      propNameZh: "残局棋盘",
      propPromptZh: "木质棋盘，黑白子散落",
    });
    expect(p).not.toContain("一律留白");
  });
});

describe("stripPropNarrativeFromVisualZh", () => {
  it("剥掉名字前缀、剧作功能与旧禁令，只留外形材质", () => {
    expect(
      stripPropNarrativeFromVisualZh(
        "原创道具特写·双层密信。外形材质：羊皮纸夹层，暗红火漆残缺。剧作功能：伪造线索。主体居中、材质可读、背景干净、竖屏9:16。禁止可读文字。",
        "双层密信",
      ),
    ).toBe("外形材质：羊皮纸夹层，暗红火漆残缺。");
  });

  it("没有叙事段时原样保留", () => {
    expect(stripPropNarrativeFromVisualZh("木质棋盘，黑白子散落")).toBe(
      "木质棋盘，黑白子散落",
    );
  });
});

describe("manhuaScriptVisualBrief", () => {
  it("compiles writer pack into visual brief instead of raw dump", () => {
    const pack = [
      "【已确认编剧包·强制遵守】",
      "系列：雨夜客栈",
      "梗概：江湖恩怨",
      "",
      "## 人物表",
      "主角欲望：称霸武林",
      "核心冲突：夺刀",
      "世界观一句：刀光剑影",
      "",
      "## 本集优先：第1集《拔刀》",
      "1. 雨夜客栈全景，火把摇晃",
      "2. 中近景对峙，拔刀交锋与闪避",
      "3. 切到庙外，追逐冲刺",
      "片尾钩子：下一集揭晓身份",
    ].join("\n");

    const brief = compileManhuaScriptVisualBrief(pack, {
      topic: "江湖刀光打斗",
      forStage: "key_art",
    });
    expect(brief).toContain("【视觉提示词简报·禁止灌剧本】");
    expect(brief).toMatch(/运镜|动作轨迹|场景/);
    expect(brief).not.toContain("## 人物表");
    expect(brief).not.toContain("主角欲望：称霸武林");
    expect(looksLikeRawScriptDump(brief)).toBe(false);
  });

  it("keeps short visual summary seed", () => {
    const brief = compileManhuaScriptVisualBrief(
      "【编剧视觉摘要】女帝青衣佩剑，雨夜秘境石阶，冷青雾气。",
      { forStage: "key_art" },
    );
    expect(brief).toContain("女帝青衣佩剑");
    expect(brief).toContain("【视觉提示词简报");
  });

  it("summarizes brief for workbench gate UI", () => {
    const ui = summarizeManhuaVisualBriefForUi(
      "雨夜客栈全景对峙，中近景拔刀交锋，切到庙外追逐冲刺",
      { topic: "江湖刀光打斗" },
    );
    expect(ui.fullBriefZh).toContain("【视觉提示词简报");
    expect(ui.topicZh).toContain("江湖");
    expect(ui.pathLabelZh || ui.actionLabelZh || ui.events.length).toBeTruthy();
  });

  it("builds scene plate prompt with hard no-text lock", () => {
    const p = buildManhuaScenePlateGenPrompt({
      sceneNameZh: "秘境洞府",
      scenePromptZh: "发光晶石与石阶",
      topic: "外门闯秘境",
    });
    expect(p).toContain("主场景空镜参考");
    expect(p).toContain("秘境洞府");
    expect(p).toContain("禁字硬锁");
    expect(p).toContain("STRICT NO TEXT");
  });
});
