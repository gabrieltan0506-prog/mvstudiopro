/** 用户new目录七核心教学图的结构化镜头词库；保留定义，修正原图混乱的英中景别名。 */
export type ManhuaShotCoreCategory = "scale" | "angle" | "composition" | "lighting" | "palette" | "dynamics" | "transition";
export type ManhuaShotCoreEntry = { id: string; category: ManhuaShotCoreCategory; categoryZh: string; no: number; nameZh: string; instructionZh: string };
export const MANHUA_SHOT_CORE_BANK: readonly ManhuaShotCoreEntry[] = [
  {
    "id": "core_scale_establish",
    "category": "scale",
    "categoryZh": "景别",
    "no": 1,
    "nameZh": "远景",
    "instructionZh": "环境、路线与多人空间关系，人物占画面小部分"
  },
  {
    "id": "core_scale_full",
    "category": "scale",
    "categoryZh": "景别",
    "no": 2,
    "nameZh": "全景",
    "instructionZh": "全身与周围环境，读清站位、落脚和动作结果"
  },
  {
    "id": "core_scale_medium",
    "category": "scale",
    "categoryZh": "景别",
    "no": 3,
    "nameZh": "中景",
    "instructionZh": "腰膝以上，兼顾手部动作与表情"
  },
  {
    "id": "core_scale_near",
    "category": "scale",
    "categoryZh": "景别",
    "no": 4,
    "nameZh": "近景",
    "instructionZh": "胸肩以上，重点对话与情绪变化"
  },
  {
    "id": "core_scale_close",
    "category": "scale",
    "categoryZh": "景别",
    "no": 5,
    "nameZh": "特写",
    "instructionZh": "面部为主，读关键反应但保留对手关系"
  },
  {
    "id": "core_scale_detail",
    "category": "scale",
    "categoryZh": "景别",
    "no": 6,
    "nameZh": "大特写",
    "instructionZh": "眼、嘴、手或原有道具局部，突出真实线索"
  },
  {
    "id": "core_scale_macro",
    "category": "scale",
    "categoryZh": "景别",
    "no": 7,
    "nameZh": "极细节特写",
    "instructionZh": "极小既有细节承载象征或节奏落点，不能凭空造证物"
  },
  {
    "id": "core_angle_eye",
    "category": "angle",
    "categoryZh": "角度",
    "no": 1,
    "nameZh": "平视",
    "instructionZh": "接近人物眼高，自然观察对话与行动"
  },
  {
    "id": "core_angle_low",
    "category": "angle",
    "categoryZh": "角度",
    "no": 2,
    "nameZh": "仰拍",
    "instructionZh": "从低处看主体，按剧情表现体量或压力，交代机位高度"
  },
  {
    "id": "core_angle_high",
    "category": "angle",
    "categoryZh": "角度",
    "no": 3,
    "nameZh": "俯拍",
    "instructionZh": "从高处看主体与环境，表现空间/受制关系，不自动判角色弱小"
  },
  {
    "id": "core_angle_side",
    "category": "angle",
    "categoryZh": "角度",
    "no": 4,
    "nameZh": "侧面",
    "instructionZh": "读侧脸、侧身与观察方向，视线不越轴"
  },
  {
    "id": "core_angle_oblique",
    "category": "angle",
    "categoryZh": "角度",
    "no": 5,
    "nameZh": "斜侧",
    "instructionZh": "斜前或斜后观察，保留冲突双方与空间，不等同倾斜地平线"
  },
  {
    "id": "core_angle_shoulder",
    "category": "angle",
    "categoryZh": "角度",
    "no": 6,
    "nameZh": "过肩",
    "instructionZh": "从已有对话者肩后看另一人，维持左右位置与反打视线"
  },
  {
    "id": "core_angle_special",
    "category": "angle",
    "categoryZh": "角度",
    "no": 7,
    "nameZh": "特殊角度",
    "instructionZh": "倾斜、旋转或贴地机位须有信息目的，重新交代空间且不代替人物动作"
  },
  {
    "id": "core_composition_thirds",
    "category": "composition",
    "categoryZh": "构图",
    "no": 1,
    "nameZh": "三分法",
    "instructionZh": "主体落三分线或交点，给视线与行动方向留空间"
  },
  {
    "id": "core_composition_center",
    "category": "composition",
    "categoryZh": "构图",
    "no": 2,
    "nameZh": "居中",
    "instructionZh": "主体在中心形成存在感，重要互动对象仍可辨"
  },
  {
    "id": "core_composition_leading",
    "category": "composition",
    "categoryZh": "构图",
    "no": 3,
    "nameZh": "引导线",
    "instructionZh": "利用已有道路、建筑或光影把注意力指向目标"
  },
  {
    "id": "core_composition_frame",
    "category": "composition",
    "categoryZh": "构图",
    "no": 4,
    "nameZh": "框架式",
    "instructionZh": "已有门窗/树枝作前景框，揭示观察距离，不新增障碍"
  },
  {
    "id": "core_composition_diagonal",
    "category": "composition",
    "categoryZh": "构图",
    "no": 5,
    "nameZh": "对角线",
    "instructionZh": "主体与攻防方向沿对角组织，接触与目标不出画"
  },
  {
    "id": "core_composition_symmetry",
    "category": "composition",
    "categoryZh": "构图",
    "no": 6,
    "nameZh": "对称",
    "instructionZh": "已有建筑或座次形成秩序，不能为对称改布局"
  },
  {
    "id": "core_composition_negative",
    "category": "composition",
    "categoryZh": "构图",
    "no": 7,
    "nameZh": "留白",
    "instructionZh": "主体与空区形成距离或余韵，画外角色去向仍交代"
  },
  {
    "id": "core_lighting_front",
    "category": "lighting",
    "categoryZh": "光影",
    "no": 1,
    "nameZh": "顺光",
    "instructionZh": "前方动机光让嘴眼和信息清晰，暗部保留层次"
  },
  {
    "id": "core_lighting_side",
    "category": "lighting",
    "categoryZh": "光影",
    "no": 2,
    "nameZh": "侧光",
    "instructionZh": "侧方动机光塑形与明暗对照，同场光向保持"
  },
  {
    "id": "core_lighting_back",
    "category": "lighting",
    "categoryZh": "光影",
    "no": 3,
    "nameZh": "逆光",
    "instructionZh": "后方动机光勾轮廓，有对白时不能把嘴眼完全黑掉"
  },
  {
    "id": "core_lighting_top",
    "category": "lighting",
    "categoryZh": "光影",
    "no": 4,
    "nameZh": "顶光",
    "instructionZh": "上方光产生脸部阴影，保留眼神和动作可读"
  },
  {
    "id": "core_lighting_under",
    "category": "lighting",
    "categoryZh": "光影",
    "no": 5,
    "nameZh": "底光",
    "instructionZh": "下方已有光源产生反常阴影，只适用剧情有依据的场面"
  },
  {
    "id": "core_lighting_rembrandt",
    "category": "lighting",
    "categoryZh": "光影",
    "no": 6,
    "nameZh": "伦勃朗式侧光",
    "instructionZh": "斜上侧光在暗侧眼下留小三角光，服务复杂表情，不强制所有脸一致"
  },
  {
    "id": "core_palette_warm",
    "category": "palette",
    "categoryZh": "色调",
    "no": 1,
    "nameZh": "暖色调",
    "instructionZh": "红橙黄倾向表达温度；沿既有材质与色义，不自动等于安全"
  },
  {
    "id": "core_palette_cool",
    "category": "palette",
    "categoryZh": "色调",
    "no": 2,
    "nameZh": "冷色调",
    "instructionZh": "蓝青倾向表达距离或冷静；不因此增加雨雪或夜景"
  },
  {
    "id": "core_palette_neutral",
    "category": "palette",
    "categoryZh": "色调",
    "no": 3,
    "nameZh": "中性色调",
    "instructionZh": "黑白灰棕与克制饱和度呈现真实与平衡"
  },
  {
    "id": "core_palette_saturated",
    "category": "palette",
    "categoryZh": "色调",
    "no": 4,
    "nameZh": "高饱和",
    "instructionZh": "少量主色增强张力，身份服装与肤色不漂移"
  },
  {
    "id": "core_palette_muted",
    "category": "palette",
    "categoryZh": "色调",
    "no": 5,
    "nameZh": "低饱和",
    "instructionZh": "柔和灰度表达内敛与余韵，不牺牲信息清晰"
  },
  {
    "id": "core_palette_contrast",
    "category": "palette",
    "categoryZh": "色调",
    "no": 6,
    "nameZh": "对比色调",
    "instructionZh": "现有冷暖或明暗差承担关系信息，色义由本剧确定"
  },
  {
    "id": "core_palette_mono",
    "category": "palette",
    "categoryZh": "色调",
    "no": 7,
    "nameZh": "单色调",
    "instructionZh": "单一色相中的明度层次，需用户风格依据，禁止擅改已锁彩色片"
  },
  {
    "id": "core_dynamics_horizontal",
    "category": "dynamics",
    "categoryZh": "动势",
    "no": 1,
    "nameZh": "水平动势",
    "instructionZh": "沿水平方向行动或延伸，分清演员移动与相机横移/摇转"
  },
  {
    "id": "core_dynamics_vertical",
    "category": "dynamics",
    "categoryZh": "动势",
    "no": 2,
    "nameZh": "垂直动势",
    "instructionZh": "上下移动或高差，说明主体落点，相机升降不能代替演员运动"
  },
  {
    "id": "core_dynamics_diagonal",
    "category": "dynamics",
    "categoryZh": "动势",
    "no": 3,
    "nameZh": "对角线动势",
    "instructionZh": "按冲突方向移动，交代目标、路径与受力"
  },
  {
    "id": "core_dynamics_curve",
    "category": "dynamics",
    "categoryZh": "动势",
    "no": 4,
    "nameZh": "曲线动势",
    "instructionZh": "原动作或环境有弧线时沿弧运动，写起终与速度"
  },
  {
    "id": "core_dynamics_radial",
    "category": "dynamics",
    "categoryZh": "动势",
    "no": 5,
    "nameZh": "放射动势",
    "instructionZh": "已存在爆发/聚拢事件由中心扩散或收束，不另添爆炸"
  },
  {
    "id": "core_dynamics_spiral",
    "category": "dynamics",
    "categoryZh": "动势",
    "no": 6,
    "nameZh": "螺旋动势",
    "instructionZh": "原剧情明确旋转或扭曲时使用，区分主体、相机与特效方向"
  },
  {
    "id": "core_dynamics_s_curve",
    "category": "dynamics",
    "categoryZh": "动势",
    "no": 7,
    "nameZh": "S形动势",
    "instructionZh": "沿已有曲折路线跟随，先后两段转向和出入口可读"
  },
  {
    "id": "core_transition_fade",
    "category": "transition",
    "categoryZh": "转场",
    "no": 1,
    "nameZh": "淡入淡出",
    "instructionZh": "开结尾或明确时间跳转时使用，不占用已锁对白动作时间"
  },
  {
    "id": "core_transition_dissolve",
    "category": "transition",
    "categoryZh": "转场",
    "no": 2,
    "nameZh": "叠化",
    "instructionZh": "明确时空或回忆过渡，人物身份与前后状态不融合成陌生人"
  },
  {
    "id": "core_transition_flash",
    "category": "transition",
    "categoryZh": "转场",
    "no": 3,
    "nameZh": "闪白闪黑",
    "instructionZh": "有依据的记忆/冲击转折，不能遮掉命中与受力，次数按戏"
  },
  {
    "id": "core_transition_wipe",
    "category": "transition",
    "categoryZh": "转场",
    "no": 4,
    "nameZh": "划像",
    "instructionZh": "有方向依据的空间或风格变化，不机械花哨切镜"
  },
  {
    "id": "core_transition_push_pull",
    "category": "transition",
    "categoryZh": "转场",
    "no": 5,
    "nameZh": "推拉衔接",
    "instructionZh": "推近/拉远引导注意力，机位运动不自动证明时空连续"
  },
  {
    "id": "core_transition_match",
    "category": "transition",
    "categoryZh": "转场",
    "no": 6,
    "nameZh": "匹配剪辑",
    "instructionZh": "沿前后真实动作、方向、形状或明暗衔接，不新增匹配道具"
  },
  {
    "id": "core_transition_montage",
    "category": "transition",
    "categoryZh": "转场",
    "no": 7,
    "nameZh": "蒙太奇",
    "instructionZh": "已确认过程的时间压缩，拆真实镜头，不能跳过关键因果或丢对白"
  }
];

export const MANHUA_SHOT_CORE_LIGHT_CONTROL_ZH = "明暗比按画面意图选择低、中、高或极高对比；素材的1:2、1:4、1:8是设计参考，未测光不当作实际执行数值。色温可冷、中性、暖或混合，同场由原有光源、材质与肤色约束；主色少量明确，不机械每镜换色。";
export const MANHUA_SHOT_CORE_OUTPUT_CONTRACT_ZH = "逐镜沿用原镜号、起止秒与人物ID：景别/角度/构图/焦段FOV/摄影机起終与运动写入现有cameraZh或运镜栏；实际光源方向、明暗/色温、氛围起終与事件触发、色调及转场写入现有actionZh/画面栏。段级不变光色写入可拍表lightingCameraZh/paletteZh；有变化必须落实对应镜窗，不能只列段头。对白、表演与动作和这些摄影信息在同一秒窗内融合，不输出素材目录，不写新schema字段，不改已锁对白、原音轨或段长。缺依据不补造，未执行不称已采用。";

export function listManhuaShotCore(category?: ManhuaShotCoreCategory): readonly ManhuaShotCoreEntry[] {
  return category ? MANHUA_SHOT_CORE_BANK.filter(e => e.category === category) : MANHUA_SHOT_CORE_BANK;
}

export function formatManhuaShotCoreCatalog(stage: "writer" | "trial" | "storyboard" | "advisor" | "world" | "keyframe"): string {
  const staticOnly = stage === "world" || stage === "keyframe";
  const groups = Array.from(new Set(MANHUA_SHOT_CORE_BANK.map(e => e.category))).filter(c => !staticOnly || c !== "dynamics" && c !== "transition");
  return [
    "【七核心镜头候选库】",
    "按本镜剧情目的选择，每类不叠互斥选项；景别是画面裁切范围，角度是机位视向，构图是空间安排，动势不等于运镜。用户已锁条件优先，不能按素材示例改人物、时代、天气、道具或音轨。",
    MANHUA_SHOT_CORE_LIGHT_CONTROL_ZH,
    staticOnly ? "仅选静态观察角度、构图、光源、色调与主体姿态；不在静态生成正文里写移动、逐秒变光或转场。" : stage === "trial" ? "当前只写300–600字试写大纲，手法作为现有节拍的画面意图；不输出可拍表、cameraZh/actionZh字段或逐镜秒窗，不把目录抄成稿。用户已锁剧情和试写三段结构优先。" : MANHUA_SHOT_CORE_OUTPUT_CONTRACT_ZH,
    ...groups.map(c => `${listManhuaShotCore(c)[0]!.categoryZh}：` + listManhuaShotCore(c).map(e => `${e.nameZh}（${e.instructionZh}）`).join("；")),
    "【/七核心镜头候选库】",
  ].join("\n");
}
