/**
 * 漫剧导演策略契约。
 *
 * 目标不是模仿任何创作者的外观，而是把已通过审计的决策规律压成一份
 * 可版本化、可分阶段投影的安全合同。浏览器和草稿只保存这个去名合同；
 * 来源人物、作品和证据编号只留在本文件的审计注册表，绝不进入接口响应。
 */

export const MANHUA_DIRECTOR_STRATEGY_FORMAT =
  "mv-manhua-director-strategy-v2" as const;
export const MANHUA_DIRECTOR_STRATEGY_VERSION = 2 as const;
/** 只代表本地白名单清单版本，不携带任何来源人物或作品信息。 */
export const MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION =
  "approved-20260904-r1" as const;

export type ManhuaDirectorStrategyStage =
  | "story"
  | "assets"
  | "storyboard"
  | "keyframe"
  | "clip"
  | "review";

export type ManhuaDirectorStrategyId =
  | "information_causality"
  | "emotion_space"
  | "character_action"
  | "audience_discovery"
  | "embodied_world"
  | "relational_action";

type ManhuaDirectorStrategyProjection = {
  objectiveZh: string;
  directivesZh: readonly string[];
  avoidZh: string;
};

export type ManhuaDirectorStrategyContract = {
  format: typeof MANHUA_DIRECTOR_STRATEGY_FORMAT;
  version: typeof MANHUA_DIRECTOR_STRATEGY_VERSION;
  revision: typeof MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION;
  strategyId: ManhuaDirectorStrategyId;
  /** 前台与生产提示词可见的中性名称。 */
  labelZh: string;
  projections: Readonly<
    Record<ManhuaDirectorStrategyStage, ManhuaDirectorStrategyProjection>
  >;
};

type StrategySeed = Omit<
  ManhuaDirectorStrategyContract,
  "format" | "version" | "revision"
> & {
  /** 内部审计字段；toContract 必须剥离，不能进入浏览器或草稿。 */
  sourceProfileIds: readonly string[];
  /** 仅含已通过独立审计的正式规律。 */
  sourceClaimIds: readonly string[];
  /** 来源文件自身的 schema/date 修订；仅内部审计读取。 */
  sourceRevision: string;
  /** 跨卡复用模块；整卡未过门槛不等于已通过的单条规律作废。 */
  moduleIds: readonly (
    | "spatial-previsualization"
    | "final-perceptual-allocation"
  )[];
  keywords: readonly string[];
  craftShotPrefixes: readonly string[];
};

const UNIVERSAL_MODULES = [
  "spatial-previsualization",
  "final-perceptual-allocation",
] as const;

/**
 * 六张通过标准档终审的去名策略卡。两张未达整卡门槛但已通过的单条规律
 * 作为通用模块进入每份合同，不把研究对象姓名带入浏览器包。
 */
const STRATEGIES: readonly StrategySeed[] = [
  {
    strategyId: "information_causality",
    labelZh: "信息因果推进",
    sourceProfileIds: [
      "parallel_action_editing",
      "world_space_previsualization",
      "mystery_reveal",
    ],
    sourceClaimIds: [
      "CN-DM-02",
      "CN-DM-04",
      "CN-DM-05",
      "CN-DM-06",
      "CN-DM-10",
      "WSPV-001",
      "AB-D-01",
    ],
    sourceRevision: "parallel_action_editing@2026-09-04",
    moduleIds: UNIVERSAL_MODULES,
    keywords: [
      "悬疑",
      "推理",
      "调查",
      "谜",
      "秘密",
      "时间",
      "多线",
      "谍战",
      "情报",
      "反转",
    ],
    craftShotPrefixes: ["cam_04", "light_07", "emo_07", "tr_05"],
    projections: {
      story: {
        objectiveZh: "把观众知道什么、何时知道以及因果交会写成剧情变量。",
        directivesZh: [
          "每条并行行动保留一个可辨目标或威胁线索",
          "只在行动产生因果交接时转线，揭示必须改变理解或选择",
        ],
        avoidZh: "禁止只藏答案却抹掉目标，也禁止为显复杂而无因果交叉剪辑。",
      },
      assets: {
        objectiveZh: "让关键空间和道具承担信息定位。",
        directivesZh: [
          "标明每条行动的空间起点、目标物和可见线索",
          "只把会改变判断的道具列为叙事锚点",
        ],
        avoidZh: "装饰性资产不得冒充线索。",
      },
      storyboard: {
        objectiveZh: "每镜交出一个清楚的信息位置。",
        directivesZh: [
          "跨线前后保留目标、方向或时间锚",
          "切镜围绕决定性行动、关系变化与结果",
        ],
        avoidZh:
          "不要拍齐每条线的机械全覆盖，也不要用固定焦段或固定快切冒充策略。",
      },
      keyframe: {
        objectiveZh: "用静态终态明确决定性信息的位置。",
        directivesZh: [
          "冻结主体、线索与遮挡关系的清楚构图",
          "用光影层级和材质差异保证关键信息可读",
        ],
        avoidZh: "只描述静态构图终态；不得写运镜、镜头位移或运动过程。",
      },
      clip: {
        objectiveZh: "用起点、决定性行动和结果维持跨镜因果。",
        directivesZh: [
          "每镜只推进一个信息变化",
          "复杂动作拆为起手、关键接触与结果",
        ],
        avoidZh: "禁止无信息变化的空切和多主体同时抢动作。",
      },
      review: {
        objectiveZh: "检查观众能否复述每次转线的原因。",
        directivesZh: [
          "删掉不改变目标、威胁、选择或结果的镜头",
          "确认关键揭示前后均有可辨证据",
        ],
        avoidZh: "不能靠旁白补救画面本应交代的因果。",
      },
    },
  },
  {
    strategyId: "emotion_space",
    labelZh: "情绪空间因果",
    sourceProfileIds: [
      "human_scale_causal_staging",
      "world_space_previsualization",
      "mystery_reveal",
    ],
    sourceClaimIds: [
      "HSCS-001",
      "HSCS-002",
      "HSCS-003",
      "HSCS-004",
      "WSPV-001",
      "AB-D-01",
    ],
    sourceRevision: "human_scale_causal_staging@2026-09-04",
    moduleIds: UNIVERSAL_MODULES,
    keywords: [
      "灾难",
      "末日",
      "战争",
      "史诗",
      "深海",
      "星际",
      "飞船",
      "巨物",
      "生存",
      "救援",
    ],
    craftShotPrefixes: ["cam_07", "light_04", "emo_08"],
    projections: {
      story: {
        objectiveZh: "奇观先改变人物选择，再扩大尺度。",
        directivesZh: [
          "每个大场面先写人物要保护什么以及失败代价",
          "空间变化必须迫使人物改路线、关系或决定",
        ],
        avoidZh: "禁止只有规模升级却没有人物后果。",
      },
      assets: {
        objectiveZh: "资产先服务眼线、接触、受力与路线。",
        directivesZh: [
          "列出可触碰的关键表面和接触点",
          "危险、尺度与不可控部分留给数字延展",
        ],
        avoidZh: "不要为实体感建造无反馈、危险或昂贵的资产。",
      },
      storyboard: {
        objectiveZh: "先让表演与空间关系成立，再选择摄影。",
        directivesZh: [
          "建立方向、距离、眼线和接触结果",
          "关键动作按发起、路径、结果、反应组织覆盖",
        ],
        avoidZh: "不要用运动摄影遮住方向和身体因果。",
      },
      keyframe: {
        objectiveZh: "冻结人物选择与空间压力相遇后的静态终态。",
        directivesZh: [
          "以构图固定方向、距离、眼线和接触结果",
          "用光影与表面材质显示尺度、重量和环境反馈",
        ],
        avoidZh: "关键帧只呈现静态终态，不写运镜或动作过程。",
      },
      clip: {
        objectiveZh: "让重量、接触与反应证明事件发生。",
        directivesZh: [
          "同帧主要动作主体不超过两人",
          "接触后必须给承受者可见反应或环境反馈",
        ],
        avoidZh: "禁止用大面积模糊和无落点破坏身份与接触点。",
      },
      review: {
        objectiveZh: "先验人物因果，再验奇观强度。",
        directivesZh: [
          "逐段核对目标、路线、接触、结果",
          "资源优先补观众真正感知的破绽",
        ],
        avoidZh: "不可用更多特效掩盖情绪或空间不清。",
      },
    },
  },
  {
    strategyId: "character_action",
    labelZh: "角色视点动作",
    sourceProfileIds: [
      "kinetic_ensemble",
      "world_space_previsualization",
      "mystery_reveal",
    ],
    sourceClaimIds: [
      "KE-01-character-pov-before-scale",
      "KE-02-beat-contract-before-scale",
      "KE-03-spatial-tactile-causality",
      "WSPV-001",
      "AB-D-01",
    ],
    sourceRevision: "kinetic_ensemble@1.1-standard",
    moduleIds: UNIVERSAL_MODULES,
    keywords: [
      "追逐",
      "赛车",
      "竞速",
      "竞技",
      "动作",
      "逃亡",
      "太空战",
      "群战",
      "闯关",
    ],
    craftShotPrefixes: ["cam_03", "tr_04", "emo_06"],
    projections: {
      story: {
        objectiveZh: "动作规模由角色视点、目标和结果承受者决定。",
        directivesZh: [
          "每段动作写清谁发起、要到哪里、谁承担结果",
          "升级前先让人物目标或危险等级发生变化",
        ],
        avoidZh: "禁止把动作段写成脱离人物的能量展示。",
      },
      assets: {
        objectiveZh: "让地点和物件成为动作路径的一部分。",
        directivesZh: [
          "标出目标点、障碍、出口和可交互物",
          "保留能显示重量、惯性和碰撞后果的表面",
        ],
        avoidZh: "资产不能只好看却不允许角色使用。",
      },
      storyboard: {
        objectiveZh: "按发起、路径、结果、反应组织动作镜头。",
        directivesZh: [
          "先建立方向轴，再用近景确认执行者与接触点",
          "只有目标、方向、危险或结果变化时才切",
        ],
        avoidZh: "连续特写不得抹掉谁追谁和运动方向。",
      },
      keyframe: {
        objectiveZh: "冻结主动作完成后可读的静态结果。",
        directivesZh: [
          "用姿态、接触点和空间构图交代发起者与承受者",
          "以光影和材质痕迹呈现重量、碰撞与结果",
        ],
        avoidZh: "只画动作终态，不写运镜、速度变化或连续动作。",
      },
      clip: {
        objectiveZh: "每镜保留一个主动作和一个可见结果。",
        directivesZh: [
          "每镜只用一个主运镜",
          "复杂群体按关系对拆镜，其余角色只保留短反应",
        ],
        avoidZh: "禁止复合甩镜、多人高速动作和背景同时变化。",
      },
      review: {
        objectiveZh: "检查动作是否可复述为完整因果链。",
        directivesZh: [
          "核对方向轴、目标点、接触点和承受者",
          "删掉没有改变目标或结果的动作镜",
        ],
        avoidZh: "不要期待后期重新发明拍摄时缺失的动作逻辑。",
      },
    },
  },
  {
    strategyId: "audience_discovery",
    labelZh: "观众感知揭示",
    sourceProfileIds: [
      "audience_aligned_discovery",
      "world_space_previsualization",
      "mystery_reveal",
    ],
    sourceClaimIds: ["AAD-001", "AAD-002", "WSPV-001", "AB-D-01"],
    sourceRevision: "audience_aligned_discovery@director-card-provenance/1.0",
    moduleIds: UNIVERSAL_MODULES,
    keywords: [
      "发现",
      "未知",
      "亲情",
      "家庭",
      "成长",
      "治愈",
      "重逢",
      "秘密身份",
      "初见",
    ],
    craftShotPrefixes: ["cam_05", "emo_02", "light_06", "cam_08"],
    projections: {
      story: {
        objectiveZh: "先确定观众跟谁知道，再安排未知与发现。",
        directivesZh: [
          "写清当前感知主体、已知与暂不可见信息",
          "揭示必须改变人物理解或关系",
        ],
        avoidZh: "禁止把藏信息本身当悬念，也不规定固定揭示镜序。",
      },
      assets: {
        objectiveZh: "资产围绕人物能够看见和触及的信息布置。",
        directivesZh: [
          "让关键线索处在所选感知位置可读范围内",
          "高耦合动作资产提前锁路径和接口",
        ],
        avoidZh: "表演核心不要被装饰或过度预演挤掉。",
      },
      storyboard: {
        objectiveZh: "切镜只为更换有效感知位置或补动作接口。",
        directivesZh: [
          "同画面仍能读懂线索与关系时保留镜头",
          "信息改变后给新对象或人物状态一个清楚落点",
        ],
        avoidZh: "不要机械规定先反应后揭示、固定低机位或固定镜长。",
      },
      keyframe: {
        objectiveZh: "冻结观众完成发现后的静态感知位置。",
        directivesZh: [
          "用构图、视线和遮挡关系交代新信息",
          "以光影转折和材质细节突出被揭示对象",
        ],
        avoidZh: "只保留清晰静态终态，不写运镜或揭示过程。",
      },
      clip: {
        objectiveZh: "用视线、遮挡和清楚落点完成认知变化。",
        directivesZh: [
          "先锁人物目标与知识差",
          "高耦合动作保必要覆盖，普通表演保可调整空间",
        ],
        avoidZh: "不能用声音补造画面中不存在的因果。",
      },
      review: {
        objectiveZh: "从观众视角检查每次发现是否既清楚又有意义。",
        directivesZh: [
          "确认每镜交出的新信息",
          "按镜头耦合风险决定补拍或保留现场反应",
        ],
        avoidZh: "避免全知信息误闯单一人物视点。",
      },
    },
  },
  {
    strategyId: "embodied_world",
    labelZh: "具身世界叙事",
    sourceProfileIds: [
      "embodied_fable_system",
      "world_space_previsualization",
      "mystery_reveal",
    ],
    sourceClaimIds: [
      "GDT-001",
      "GDT-002",
      "GDT-003",
      "GDT-005",
      "WSPV-001",
      "AB-D-01",
    ],
    sourceRevision: "embodied_fable_system@director-distill-standard-v1",
    moduleIds: UNIVERSAL_MODULES,
    keywords: [
      "怪物",
      "异类",
      "生物",
      "巨兽",
      "精灵",
      "妖",
      "非人",
      "奇幻",
      "异世界",
      "仪式",
    ],
    craftShotPrefixes: ["cam_09", "cam_10", "light_04"],
    projections: {
      story: {
        objectiveZh: "非人角色先成为人物，复杂空间先说清一件事。",
        directivesZh: [
          "先写角色任务、伦理位置、身体运动与关系",
          "为复杂场景定义一句空间命题和主视点",
        ],
        avoidZh: "禁止用器官、纹理和固定外观配方代替人物与空间因果。",
      },
      assets: {
        objectiveZh: "建立项目自己的视觉语义和最小身体互动核心。",
        directivesZh: [
          "形状、材质和颜色只编码当前故事的人物或关系",
          "优先锁轮廓、步态、接触道具和关键表面",
        ],
        avoidZh: "不得默认固定色表，也不得为了实体感牺牲安全与成本。",
      },
      storyboard: {
        objectiveZh: "先建立角色、核心物与行动路线，再进入局部细节。",
        directivesZh: [
          "空间未读懂时保持可读构图",
          "动作覆盖保留方向、接触和结果",
        ],
        avoidZh: "不要把始终运动、固定低机位或固定镜长写成规则。",
      },
      keyframe: {
        objectiveZh: "冻结非人角色与环境发生关系后的静态终态。",
        directivesZh: [
          "以轮廓、姿态、眼线和接触关系建立可读构图",
          "用光影与材质区分身体、关键表面和空间尺度",
        ],
        avoidZh: "只描述静态终态，不写运镜、步态过程或镜头运动。",
      },
      clip: {
        objectiveZh: "用轮廓、步态、眼线、接触和环境反馈维持生命感。",
        directivesZh: [
          "复杂运动拆为接近、接触、后果",
          "关键帧冻结终态和关系距离，运镜只进视频段",
        ],
        avoidZh: "禁止同镜堆满表面细节、群体动作和复合运镜。",
      },
      review: {
        objectiveZh: "先看观众是否读到人物与空间，再看设计丰富度。",
        directivesZh: [
          "设计压过人物时降低编码密度",
          "优先修接触、影子、眼线和尺度破绽",
        ],
        avoidZh: "不要用更多装饰掩盖空间入口不清。",
      },
    },
  },
  {
    strategyId: "relational_action",
    labelZh: "关系驱动动作",
    sourceProfileIds: [
      "relational_action_rhythm",
      "world_space_previsualization",
      "mystery_reveal",
    ],
    sourceClaimIds: ["JWAR-001", "JWAR-002", "JWAR-003", "WSPV-001", "AB-D-01"],
    sourceRevision:
      "relational_action_rhythm@director-distillation-standard-1.1",
    moduleIds: UNIVERSAL_MODULES,
    keywords: [
      "背叛",
      "兄弟",
      "忠诚",
      "牺牲",
      "复仇",
      "救人",
      "对决",
      "围攻",
      "枪战",
      "江湖",
    ],
    craftShotPrefixes: ["emo_06", "emo_05", "tr_02"],
    projections: {
      story: {
        objectiveZh: "每段动作必须改变人物关系或道德处境。",
        directivesZh: [
          "先写角色在保护、背叛、挽回、证明或牺牲什么",
          "动作升级必须带来可见选择与代价",
        ],
        avoidZh: "禁止用符号、武器或规模替代戏核。",
      },
      assets: {
        objectiveZh: "地点和可用物共同生成身体路线。",
        directivesZh: [
          "标出目标、障碍、威胁方向、出口和相互位置",
          "只保留真正参与选择或受力的道具",
        ],
        avoidZh: "禁止把固定图标和危险真人动作包装成风格。",
      },
      storyboard: {
        objectiveZh: "动作覆盖交代起点、变化、结果与关系反应。",
        directivesZh: [
          "常速保持因果可读",
          "只在目光、身体转折、道德选择或冲击余韵处延时",
        ],
        avoidZh: "禁止整场统一慢速，也不规定固定帧率、镜头数或焦段。",
      },
      keyframe: {
        objectiveZh: "冻结选择发生后人物关系改变的静态终态。",
        directivesZh: [
          "用构图固定距离、目光、接触与承受结果",
          "用光影和材质余态突出关系代价",
        ],
        avoidZh: "关键帧不写运镜、慢速或连续动作，只呈现静态终态。",
      },
      clip: {
        objectiveZh: "按关系对拆动作，以反应显出选择后果。",
        directivesZh: [
          "同帧主要动作主体不超过两人",
          "延时效果改写为目光停留、材质余振、呼吸或光影状态变化",
        ],
        avoidZh: "禁止复杂长镜、多主体高速运动和危险动作指令。",
      },
      review: {
        objectiveZh: "检查打完之后人物关系是否已经变化。",
        directivesZh: [
          "删掉不产生选择、代价或反应的动作",
          "空间已清楚时把注意力交给情绪节点",
        ],
        avoidZh: "音乐和特效不得掩盖路线或关系信息不足。",
      },
    },
  },
] as const;

const BY_ID = new Map(
  STRATEGIES.map(entry => [entry.strategyId, entry] as const)
);

function toContract(seed: StrategySeed): ManhuaDirectorStrategyContract {
  const {
    sourceProfileIds: _sourceProfileIds,
    sourceClaimIds: _sourceClaimIds,
    sourceRevision: _sourceRevision,
    moduleIds: _moduleIds,
    keywords: _keywords,
    craftShotPrefixes: _craftShotPrefixes,
    ...contract
  } = seed;
  return {
    format: MANHUA_DIRECTOR_STRATEGY_FORMAT,
    version: MANHUA_DIRECTOR_STRATEGY_VERSION,
    revision: MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION,
    ...contract,
  };
}

/** 只供服务端测试和内部审计读取；生产合同不会携带这些字段。 */
export function getManhuaDirectorStrategyAuditTrace(
  id: string | null | undefined
): Pick<
  StrategySeed,
  "sourceProfileIds" | "sourceClaimIds" | "sourceRevision" | "moduleIds"
> | null {
  const seed = BY_ID.get(String(id || "").trim() as ManhuaDirectorStrategyId);
  if (!seed) return null;
  return {
    sourceProfileIds: seed.sourceProfileIds,
    sourceClaimIds: seed.sourceClaimIds,
    sourceRevision: seed.sourceRevision,
    moduleIds: seed.moduleIds,
  };
}

export function getManhuaDirectorStrategyContract(
  id: string | null | undefined
): ManhuaDirectorStrategyContract | null {
  const seed = BY_ID.get(String(id || "").trim() as ManhuaDirectorStrategyId);
  return seed ? toContract(seed) : null;
}

/** 草稿/接口只信任版本与白名单 id，阶段文案始终从本地注册表重建。 */
export function parseManhuaDirectorStrategyContract(
  raw: unknown
): ManhuaDirectorStrategyContract | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as {
    format?: unknown;
    version?: unknown;
    revision?: unknown;
    strategyId?: unknown;
  };
  const isLegacyV1 =
    input.format === "mv-manhua-director-strategy-v1" &&
    Number(input.version) === 1;
  const isCurrent =
    input.format === MANHUA_DIRECTOR_STRATEGY_FORMAT &&
    Number(input.version) === MANHUA_DIRECTOR_STRATEGY_VERSION &&
    input.revision === MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION;
  if (!isLegacyV1 && !isCurrent) return null;
  return getManhuaDirectorStrategyContract(String(input.strategyId || ""));
}

/**
 * 稳定、无模型调用的自动匹配。题材命中优先；现有“拍摄手法”只在题材未命中时
 * 提供第二信号，因此没有新 UI，也不会改变任何计费路径。
 */
export function resolveManhuaDirectorStrategyContract(input: {
  topic?: string | null;
  brief?: string | null;
  craftShotId?: string | null;
}): ManhuaDirectorStrategyContract {
  const text =
    `${String(input.topic || "")}\n${String(input.brief || "")}`.trim();
  for (const seed of STRATEGIES) {
    if (seed.keywords.some(keyword => text.includes(keyword)))
      return toContract(seed);
  }
  const craftShotId = String(input.craftShotId || "").trim();
  for (const seed of STRATEGIES) {
    if (seed.craftShotPrefixes.some(prefix => craftShotId.startsWith(prefix))) {
      return toContract(seed);
    }
  }
  return toContract(BY_ID.get("audience_discovery")!);
}

const STRATEGY_MARKER_RE =
  /【创作策略·v(\d+)·(?:(approved-[a-z0-9-]+)·)?([a-z_]+)】/;

/** 生产投影：只输出中性方法，不输出来源人物、作品或内部 claim。 */
export function formatManhuaDirectorStrategyStage(
  contract: ManhuaDirectorStrategyContract,
  stage: ManhuaDirectorStrategyStage
): string {
  const projection = contract.projections[stage];
  const lines = projection.directivesZh.map(line => `- ${line}`);
  return [
    `【创作策略·v${contract.version}·${contract.revision}·${contract.strategyId}】${contract.labelZh}`,
    `目标：${projection.objectiveZh}`,
    ...lines,
    `边界：${projection.avoidZh}`,
  ].join("\n");
}

/** 段成片只保留一行，避免在秒轴前再堆规则墙。 */
export function formatManhuaDirectorStrategyClipLine(
  contract: ManhuaDirectorStrategyContract
): string {
  const projection = contract.projections.clip;
  return `【创作策略·v${contract.version}·${contract.revision}·${contract.strategyId}】${contract.labelZh}｜${projection.directivesZh.join("；")}｜边界：${projection.avoidZh}`;
}

/** 从已存节点恢复同一版本策略；旧板无标记时返回 null，不猜、不静默换策略。 */
export function readManhuaDirectorStrategyContract(
  prompt: string | null | undefined
): ManhuaDirectorStrategyContract | null {
  const match = String(prompt || "").match(STRATEGY_MARKER_RE);
  if (!match) return null;
  const version = Number(match[1]);
  const revision = match[2];
  const strategyId = match[3];
  const isLegacyV1 = version === 1 && !revision;
  const isCurrent =
    version === MANHUA_DIRECTOR_STRATEGY_VERSION &&
    revision === MANHUA_DIRECTOR_STRATEGY_APPROVED_MANIFEST_VERSION;
  if (!isLegacyV1 && !isCurrent) return null;
  return getManhuaDirectorStrategyContract(strategyId);
}

/** 去掉一段旧投影，供“已铺节点同步设置”幂等重写。 */
export function stripManhuaDirectorStrategyStage(
  prompt: string | null | undefined
): string {
  const text = String(prompt || "");
  return text
    .replace(
      /(?:^|\n)【创作策略·v\d+·(?:approved-[a-z0-9-]+·)?[a-z_]+】[^\n]*(?:\n(?!【)[^\n]*)*/g,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function listManhuaDirectorStrategyContracts(): ManhuaDirectorStrategyContract[] {
  return STRATEGIES.map(toContract);
}
