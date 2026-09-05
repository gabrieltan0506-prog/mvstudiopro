/**
 * PR #1381 合并点（8ef1555）的 v1 去名生产合同快照。
 *
 * 这里只保留当时真正写入 Bible／节点的公共字段；没有来源、审计、关键词或
 * 自动匹配数据。旧草稿恢复必须从这里取值，禁止按相同 strategyId 查询新注册表。
 */

export const MANHUA_DIRECTOR_STRATEGY_V1_FORMAT =
  "mv-manhua-director-strategy-v1" as const;
export const MANHUA_DIRECTOR_STRATEGY_V1_VERSION = 1 as const;

export type ManhuaDirectorStrategyV1Id =
  | "information_causality"
  | "emotion_space"
  | "character_action"
  | "audience_discovery"
  | "embodied_world"
  | "relational_action";

export type ManhuaDirectorStrategyV1Stage =
  | "story"
  | "assets"
  | "storyboard"
  | "clip"
  | "review";

export type ManhuaDirectorStrategyV1Projection = {
  readonly objectiveZh: string;
  readonly directivesZh: readonly string[];
  readonly avoidZh: string;
};

export type ManhuaDirectorStrategyLegacyContract = {
  readonly format: typeof MANHUA_DIRECTOR_STRATEGY_V1_FORMAT;
  readonly version: typeof MANHUA_DIRECTOR_STRATEGY_V1_VERSION;
  readonly strategyId: ManhuaDirectorStrategyV1Id;
  readonly labelZh: string;
  readonly projections: Readonly<
    Record<ManhuaDirectorStrategyV1Stage, ManhuaDirectorStrategyV1Projection>
  >;
};

const V1_CONTRACTS = [
  {
    format: MANHUA_DIRECTOR_STRATEGY_V1_FORMAT,
    version: MANHUA_DIRECTOR_STRATEGY_V1_VERSION,
    strategyId: "information_causality",
    labelZh: "信息因果推进",
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
        avoidZh: "不要拍齐每条线的机械全覆盖，也不要用固定焦段或固定快切冒充策略。",
      },
      clip: {
        objectiveZh: "用起点、决定性行动和结果维持跨镜因果。",
        directivesZh: ["每镜只推进一个信息变化", "复杂动作拆为起手、关键接触与结果"],
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
    format: MANHUA_DIRECTOR_STRATEGY_V1_FORMAT,
    version: MANHUA_DIRECTOR_STRATEGY_V1_VERSION,
    strategyId: "emotion_space",
    labelZh: "情绪空间因果",
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
      clip: {
        objectiveZh: "让重量、接触与反应证明事件发生。",
        directivesZh: ["同帧主要动作主体不超过两人", "接触后必须给承受者可见反应或环境反馈"],
        avoidZh: "禁止用大面积模糊和无落点破坏身份与接触点。",
      },
      review: {
        objectiveZh: "先验人物因果，再验奇观强度。",
        directivesZh: ["逐段核对目标、路线、接触、结果", "资源优先补观众真正感知的破绽"],
        avoidZh: "不可用更多特效掩盖情绪或空间不清。",
      },
    },
  },
  {
    format: MANHUA_DIRECTOR_STRATEGY_V1_FORMAT,
    version: MANHUA_DIRECTOR_STRATEGY_V1_VERSION,
    strategyId: "character_action",
    labelZh: "角色视点动作",
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
        directivesZh: ["标出目标点、障碍、出口和可交互物", "保留能显示重量、惯性和碰撞后果的表面"],
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
      clip: {
        objectiveZh: "每镜保留一个主动作和一个可见结果。",
        directivesZh: ["每镜只用一个主运镜", "复杂群体按关系对拆镜，其余角色只保留短反应"],
        avoidZh: "禁止复合甩镜、多人高速动作和背景同时变化。",
      },
      review: {
        objectiveZh: "检查动作是否可复述为完整因果链。",
        directivesZh: ["核对方向轴、目标点、接触点和承受者", "删掉没有改变目标或结果的动作镜"],
        avoidZh: "不要期待后期重新发明拍摄时缺失的动作逻辑。",
      },
    },
  },
  {
    format: MANHUA_DIRECTOR_STRATEGY_V1_FORMAT,
    version: MANHUA_DIRECTOR_STRATEGY_V1_VERSION,
    strategyId: "audience_discovery",
    labelZh: "观众感知揭示",
    projections: {
      story: {
        objectiveZh: "先确定观众跟谁知道，再安排未知与发现。",
        directivesZh: ["写清当前感知主体、已知与暂不可见信息", "揭示必须改变人物理解或关系"],
        avoidZh: "禁止把藏信息本身当悬念，也不规定固定揭示镜序。",
      },
      assets: {
        objectiveZh: "资产围绕人物能够看见和触及的信息布置。",
        directivesZh: ["让关键线索处在所选感知位置可读范围内", "高耦合动作资产提前锁路径和接口"],
        avoidZh: "表演核心不要被装饰或过度预演挤掉。",
      },
      storyboard: {
        objectiveZh: "切镜只为更换有效感知位置或补动作接口。",
        directivesZh: ["同画面仍能读懂线索与关系时保留镜头", "信息改变后给新对象或人物状态一个清楚落点"],
        avoidZh: "不要机械规定先反应后揭示、固定低机位或固定镜长。",
      },
      clip: {
        objectiveZh: "用视线、遮挡和清楚落点完成认知变化。",
        directivesZh: ["先锁人物目标与知识差", "高耦合动作保必要覆盖，普通表演保可调整空间"],
        avoidZh: "不能用声音补造画面中不存在的因果。",
      },
      review: {
        objectiveZh: "从观众视角检查每次发现是否既清楚又有意义。",
        directivesZh: ["确认每镜交出的新信息", "按镜头耦合风险决定补拍或保留现场反应"],
        avoidZh: "避免全知信息误闯单一人物视点。",
      },
    },
  },
  {
    format: MANHUA_DIRECTOR_STRATEGY_V1_FORMAT,
    version: MANHUA_DIRECTOR_STRATEGY_V1_VERSION,
    strategyId: "embodied_world",
    labelZh: "具身世界叙事",
    projections: {
      story: {
        objectiveZh: "非人角色先成为人物，复杂空间先说清一件事。",
        directivesZh: ["先写角色任务、伦理位置、身体运动与关系", "为复杂场景定义一句空间命题和主视点"],
        avoidZh: "禁止用器官、纹理和固定外观配方代替人物与空间因果。",
      },
      assets: {
        objectiveZh: "建立项目自己的视觉语义和最小身体互动核心。",
        directivesZh: ["形状、材质和颜色只编码当前故事的人物或关系", "优先锁轮廓、步态、接触道具和关键表面"],
        avoidZh: "不得默认固定色表，也不得为了实体感牺牲安全与成本。",
      },
      storyboard: {
        objectiveZh: "先建立角色、核心物与行动路线，再进入局部细节。",
        directivesZh: ["空间未读懂时保持可读构图", "动作覆盖保留方向、接触和结果"],
        avoidZh: "不要把始终运动、固定低机位或固定镜长写成规则。",
      },
      clip: {
        objectiveZh: "用轮廓、步态、眼线、接触和环境反馈维持生命感。",
        directivesZh: ["复杂运动拆为接近、接触、后果", "关键帧冻结终态和关系距离，运镜只进视频段"],
        avoidZh: "禁止同镜堆满表面细节、群体动作和复合运镜。",
      },
      review: {
        objectiveZh: "先看观众是否读到人物与空间，再看设计丰富度。",
        directivesZh: ["设计压过人物时降低编码密度", "优先修接触、影子、眼线和尺度破绽"],
        avoidZh: "不要用更多装饰掩盖空间入口不清。",
      },
    },
  },
  {
    format: MANHUA_DIRECTOR_STRATEGY_V1_FORMAT,
    version: MANHUA_DIRECTOR_STRATEGY_V1_VERSION,
    strategyId: "relational_action",
    labelZh: "关系驱动动作",
    projections: {
      story: {
        objectiveZh: "每段动作必须改变人物关系或道德处境。",
        directivesZh: ["先写角色在保护、背叛、挽回、证明或牺牲什么", "动作升级必须带来可见选择与代价"],
        avoidZh: "禁止用符号、武器或规模替代戏核。",
      },
      assets: {
        objectiveZh: "地点和可用物共同生成身体路线。",
        directivesZh: ["标出目标、障碍、威胁方向、出口和相互位置", "只保留真正参与选择或受力的道具"],
        avoidZh: "禁止把固定图标和危险真人动作包装成风格。",
      },
      storyboard: {
        objectiveZh: "动作覆盖交代起点、变化、结果与关系反应。",
        directivesZh: ["常速保持因果可读", "只在目光、身体转折、道德选择或冲击余韵处延时"],
        avoidZh: "禁止整场统一慢速，也不规定固定帧率、镜头数或焦段。",
      },
      clip: {
        objectiveZh: "按关系对拆动作，以反应显出选择后果。",
        directivesZh: ["同帧主要动作主体不超过两人", "延时效果改写为目光停留、材质余振、呼吸或光影状态变化"],
        avoidZh: "禁止复杂长镜、多主体高速运动和危险动作指令。",
      },
      review: {
        objectiveZh: "检查打完之后人物关系是否已经变化。",
        directivesZh: ["删掉不产生选择、代价或反应的动作", "空间已清楚时把注意力交给情绪节点"],
        avoidZh: "音乐和特效不得掩盖路线或关系信息不足。",
      },
    },
  },
] as const satisfies readonly ManhuaDirectorStrategyLegacyContract[];

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  Object.freeze(value);
}

deepFreeze(V1_CONTRACTS);

const V1_BY_ID = new Map(V1_CONTRACTS.map((contract) => [contract.strategyId, contract]));

export function getManhuaDirectorStrategyV1Snapshot(
  id: string | null | undefined,
): ManhuaDirectorStrategyLegacyContract | null {
  return V1_BY_ID.get(String(id || "").trim() as ManhuaDirectorStrategyV1Id) || null;
}

export function listManhuaDirectorStrategyV1Snapshots(): readonly ManhuaDirectorStrategyLegacyContract[] {
  return V1_CONTRACTS;
}
