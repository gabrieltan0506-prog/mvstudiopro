import type { ManhuaViralTemplateCard } from "./manhuaViralTemplateBank";

export const TEMPLATE_CATALOG_REQUEST_MARKER = "【按创作手法推荐模板】";

/** A search index over existing learning evidence, never a replacement for that evidence. */
export const TEMPLATE_CRAFT_DIMENSIONS = [
  ["narrative", "人物选择与转折"],
  ["dialogue", "对白与交锋"],
  ["performance", "动作与表演"],
  ["staging", "场景与调度"],
  ["visual", "服化与灯光"],
  ["sound", "声音与剪辑"],
] as const;
export type TemplateCraftDimension =
  (typeof TEMPLATE_CRAFT_DIMENSIONS)[number][0];
export const TEMPLATE_CRAFT_RULES = [
  {
    id: "choice-cost",
    dimension: "narrative",
    label: "选择带来代价",
    match: /选择.{0,30}(代价|牺牲)|代价.{0,30}选择|牺牲.{0,30}(守护|保护)/,
  },
  {
    id: "object-relationship",
    dimension: "narrative",
    label: "道具推动关系转折",
    match: /(信物|道具|书信|画卷|卷轴).{0,60}(毁|焚|决裂|转折|关系)/,
  },
  {
    id: "information-turn",
    dimension: "narrative",
    label: "信息揭露改变局势",
    match:
      /(信息差|隐瞒|秘密|真相|线索).{0,40}(揭|反转|改变|追问|交换)|揭露.{0,30}(信息|身份|真相)/,
  },
  {
    id: "comic-counter",
    dimension: "dialogue",
    label: "反差言语化解压力",
    match:
      /(荒诞|自恋|调侃|幽默).{0,45}(破局|捧杀|化解|消解|解构)|一本正经.{0,15}(胡说|调侃)/,
  },
  {
    id: "verbal-tactics",
    dimension: "dialogue",
    label: "对白试探与攻防",
    match:
      /(对白|言语|对话|台词).{0,35}(试探|交锋|博弈|威胁|诱导|攻防)|言外之意|潜台词/,
  },
  {
    id: "silence-reply",
    dimension: "dialogue",
    label: "停顿与沉默回应",
    match:
      /(沉默|停顿|留白).{0,30}(回应|对话|对白|台词)|对白.{0,25}(停顿|沉默)/,
  },
  {
    id: "micro-reaction",
    dimension: "performance",
    label: "细微反应推动情绪",
    match: /微表情|眼神戏|眼神.{0,20}(转变|变化|反应)|呼吸.{0,20}(变化|急促)/,
  },
  {
    id: "contact-trust",
    dimension: "performance",
    label: "肢体接触改变关系",
    match:
      /(肢体接触|握手|拭手|牵手).{0,45}(信任|防备|破冰|盟约|情感)|肢体破冰/,
  },
  {
    id: "action-response",
    dimension: "performance",
    label: "动作与反应接力",
    match: /动作因果|受力反应|反应顺序|踩脚|肢体.{0,25}反差/,
  },
  {
    id: "space-pressure",
    dimension: "staging",
    label: "空间与站位制造压力",
    match:
      /(空间|站位|俯拍|仰拍).{0,40}(压迫|压力|张力|落差)|空间压迫|大俯瞰绝壁/,
  },
  {
    id: "barrier",
    dimension: "staging",
    label: "遮挡与阻隔表达关系",
    match:
      /(门扇|门窗|朱门|遮挡|阻隔).{0,45}(关系|心理|阻隔|隔绝|隐喻)|门扇隐喻/,
  },
  {
    id: "group-reaction",
    dimension: "staging",
    label: "群像反应与视线调度",
    match: /群像|多条人物视线|视线.{0,30}(交织|调度)|全场.{0,15}(哄笑|反应)/,
  },
  {
    id: "light-contrast",
    dimension: "visual",
    label: "冷暖与明暗对照",
    match: /冷暖|明暗对比|光.{0,20}(反差|对冲)|火光高反差/,
  },
  {
    id: "costume-contrast",
    dimension: "visual",
    label: "服饰与色彩对照",
    match:
      /(服饰|服装|红白|妆容).{0,35}(对比|对照|身份|张力)|色彩.{0,25}(对比|身份)/,
  },
  {
    id: "light-emotion",
    dimension: "visual",
    label: "光线突出人物情绪",
    match: /(光线|侧光|逆光|柔光).{0,40}(情绪|眼神|面部|轮廓)|特写.{0,25}光影/,
  },
  {
    id: "music-turn",
    dimension: "sound",
    label: "音乐推动剧情转折",
    match: /(音乐|乐曲|独奏|二胡).{0,60}(推动|反转|高潮|催泪|共鸣)|曲中藏情/,
  },
  {
    id: "sound-space",
    dimension: "sound",
    label: "环境声建立空间",
    match: /环境声|环境拟音|空间声场|脚步声|环境音/,
  },
  {
    id: "rhythm-contrast",
    dimension: "sound",
    label: "动静与声画反差",
    match:
      /动静反差|声画.{0,20}(反差|对比|错位)|音乐.{0,25}(骤停|突然|切入)|静默/,
  },
] as const satisfies readonly {
  id: string;
  dimension: TemplateCraftDimension;
  label: string;
  match: RegExp;
}[];
export type TemplateCraftId = (typeof TEMPLATE_CRAFT_RULES)[number]["id"];
export type TemplateCraftProfile = {
  version: 1;
  features: {
    id: TemplateCraftId;
    dimension: TemplateCraftDimension;
    label: string;
  }[];
};
export type TemplateCraftEvidence = { field: string; text: string };

/** Preserve the learned material independently of its source medium. */
export function templateCraftEvidence(
  card: ManhuaViralTemplateCard
): TemplateCraftEvidence[] {
  const entries: [string, string | undefined][] = [
    ["reusableZh", card.reusableZh],
    ["genPromptHintZh", card.genPromptHintZh],
    ["storyStructure.conflictEngineZh", card.storyStructure?.conflictEngineZh],
    [
      "storyStructure.relationshipEngineZh",
      card.storyStructure?.relationshipEngineZh,
    ],
    ["audioStory.audioBeatStructureZh", card.audioStory?.audioBeatStructureZh],
    ["audioStory.mixNotesZh", card.audioStory?.mixNotesZh],
    ["audioStory.reusableAudioZh", card.audioStory?.reusableAudioZh],
  ];
  for (const [key, tags] of Object.entries(card.classification || {})) {
    tags.forEach((text, index) =>
      entries.push([`classification.${key}[${index}]`, text])
    );
  }
  return entries
    .filter((e): e is [string, string] => !!e[1]?.trim())
    .map(([field, text]) => ({ field, text }));
}

export function buildTemplateCraftProfile(
  card: ManhuaViralTemplateCard
): TemplateCraftProfile {
  const evidence = templateCraftEvidence(card);
  return {
    version: 1,
    features: TEMPLATE_CRAFT_RULES.filter(rule =>
      evidence.some(item => rule.match.test(item.text))
    ).map(({ id, dimension, label }) => ({ id, dimension, label })),
  };
}

/** Owner/service-only evidence. Never place this output in the public catalog. */
export function buildTemplateCraftReview(card: ManhuaViralTemplateCard) {
  const profile = buildTemplateCraftProfile(card),
    evidence = templateCraftEvidence(card);
  return {
    ...profile,
    features: profile.features.map(feature => ({
      ...feature,
      evidence: evidence.filter(item =>
        TEMPLATE_CRAFT_RULES.find(rule => rule.id === feature.id)!.match.test(
          item.text
        )
      ),
    })),
    unindexed: evidence.filter(
      item => !TEMPLATE_CRAFT_RULES.some(rule => rule.match.test(item.text))
    ),
  };
}

export const TEMPLATE_CRAFT_APPLICATION_RULES =
  "模板是创作方法参考，不是题材套路。先确定当前人物目标、阻力与选择，再决定借用哪种对白、动作、场面或声画方法，以及它要造成什么变化。没有适用前提的手法不硬套；不得凭分类补出重生、系统、穿越等新设定。借用节奏、内容组织与创作方法，不按作品形式限制参考范围；如当前项目已选导演包，保留其约束并结合本场目的使用，不擅自更换导演包；不得照搬来源人物、台词或固定秒长。组合模板按各自分工协作，不要求每场把所有手法用一遍。";

/** Full learned summaries remain intact; this adds organization, not another fixed-size excerpt. */
export function formatTemplateCraftApplication(
  card: ManhuaViralTemplateCard
): string {
  const profile = buildTemplateCraftProfile(card);
  return [
    TEMPLATE_CRAFT_APPLICATION_RULES,
    ...TEMPLATE_CRAFT_DIMENSIONS.map(([key, label]) => {
      const names = profile.features
        .filter(f => f.dimension === key)
        .map(f => f.label);
      return names.length ? `${label}：${names.join("、")}` : "";
    }),
    "以上仅为已有手法的检索线索，不是已证实的适配结论；依据下方原始学习摘要决定是否使用。未被索引收录的学习内容同样有效。",
  ]
    .filter(Boolean)
    .join("\n");
}
