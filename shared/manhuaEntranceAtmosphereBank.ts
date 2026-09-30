/** 同源出场氛围与灯光库。目录是候选；只将选用且符合原场条件的手法落实到现有镜头。 */
export type ManhuaEntranceAtmosphereEntry = {
  id: string;
  no: number;
  nameZh: string;
  sourceKind: "image" | "skill" | "direction";
  prerequisiteZh: string;
  lightingZh: string;
  atmosphereZh: string;
  cameraZh: string;
  storyPurposeZh: string;
};

export const MANHUA_ENTRANCE_ATMOSPHERE_BANK: readonly ManhuaEntranceAtmosphereEntry[] = [
  {
    "id": "entrance_back_suspense",
    "no": 1,
    "nameZh": "背影悬念",
    "prerequisiteZh": "身份暂不揭示，已有背身人物与可辨环境",
    "lightingZh": "侧后方既有光勾肩线与衣摆，正面压暗但保留环境层次",
    "atmosphereZh": "暗场、风吹衣摆与地面反光服务未知感；仅使用原场已有风和湿面",
    "cameraZh": "从肩背缓推，最后停在可读背影，不越过人物提前露正脸",
    "storyPurposeZh": "先见存在，再追问身份",
    "sourceKind": "image"
  },
  {
    "id": "entrance_silhouette",
    "no": 2,
    "nameZh": "剪影逆光",
    "prerequisiteZh": "出入口、窗或火光等既有背光源，暂不需要读嘴眼",
    "lightingZh": "背光照亮轮廓与原场浮尘，正面保持剪影；有对白时补足嘴眼可读光",
    "atmosphereZh": "明亮背景与暗轮廓对照，隐藏身份而不丢失人物数量",
    "cameraZh": "从可辨空间缓推到轮廓，身份揭示前不切正脸",
    "storyPurposeZh": "延迟揭示，放大人物进入的分量",
    "sourceKind": "image"
  },
  {
    "id": "entrance_low_power",
    "no": 3,
    "nameZh": "低机位压迫",
    "prerequisiteZh": "已有强势人物进场，空间允许低机位与后退",
    "lightingZh": "顶侧光勾出身形，背景明暗层次衬托体量，不新增灯具",
    "atmosphereZh": "沉重脚步与背景被身形遮挡形成压力",
    "cameraZh": "低机位仰拍，人物前行时相机沿安全路线退让，不穿人越轴",
    "storyPurposeZh": "用空间占有表现威胁与权力",
    "sourceKind": "image"
  },
  {
    "id": "entrance_space_open",
    "no": 4,
    "nameZh": "空间开启",
    "prerequisiteZh": "场内已有门、帘或其他可开启边界",
    "lightingZh": "边界开启时原有外光先进入，人物停在明暗交界，随后脸部入光",
    "atmosphereZh": "开口先出现光与空间，再出现人，内外明暗差形成期待",
    "cameraZh": "固定建立开口方向，按边界开启→人物轮廓→全貌顺序揭示",
    "storyPurposeZh": "让出场成为事件，而不是突然添人",
    "sourceKind": "image"
  },
  {
    "id": "entrance_corridor_depth",
    "no": 5,
    "nameZh": "走廊纵深",
    "prerequisiteZh": "已有长走廊或纵深通道，不改建筑",
    "lightingZh": "两侧既有光源沿透视线形成明暗层；亮灭变化须有剧情或设施依据",
    "atmosphereZh": "远近距离、空旷感与脚步回声服务逼近感",
    "cameraZh": "从远端固定观察来人，保持消失点与通道出口可读",
    "storyPurposeZh": "让等待与逼近逐步增加压力",
    "sourceKind": "image"
  },
  {
    "id": "entrance_stair_hierarchy",
    "no": 6,
    "nameZh": "楼梯层级",
    "prerequisiteZh": "已有楼梯与上下层人物位置",
    "lightingZh": "上层人物在原有亮区，下层保留阴影；移动跨层时受光随实际光源变化",
    "atmosphereZh": "台阶斜线和高差表现身份层级，不凭空增加楼层或人",
    "cameraZh": "从下方仰拍或沿楼梯平移，交代上下位置和真实落脚点",
    "storyPurposeZh": "通过高差与受光说明关系",
    "sourceKind": "image"
  },
  {
    "id": "entrance_rain_night",
    "no": 7,
    "nameZh": "雨夜氛围",
    "prerequisiteZh": "已明确雨夜、湿面与可用街灯等光源；未设雨夜不选",
    "lightingZh": "既有灯光照亮雨丝和湿发衣，湿地反射原场实际光源，古风不新增霓虹或车灯",
    "atmosphereZh": "冷湿雨幕、远处层次与背景虚化表现克制孤独",
    "cameraZh": "沿人物路线轻跟，雨幕不遮没目标、表情或接触动作",
    "storyPurposeZh": "用冷湿环境承接情绪，不改已锁天气",
    "sourceKind": "image"
  },
  {
    "id": "entrance_dust_reveal",
    "no": 8,
    "nameZh": "烟尘显影",
    "prerequisiteZh": "原场已有烟、雾或事件产生的尘埃",
    "lightingZh": "原有背光穿过烟尘形成光束，轮廓由隐到显",
    "atmosphereZh": "遮挡逐步减少，未知与危险感随真实步出动作变化",
    "cameraZh": "缓推观察人物从已有烟尘中走出，最后看清身份与落点",
    "storyPurposeZh": "让信息显露和人物出现同步",
    "sourceKind": "image"
  },
  {
    "id": "entrance_crowd_focus",
    "no": 9,
    "nameZh": "人群锁定",
    "prerequisiteZh": "原场已有多人，身份和数量必须全部保留",
    "lightingZh": "保留人群受光层次，将主体脸部可读光与背景分开",
    "atmosphereZh": "前景遮挡、背景虚化与注意力集中服务目标发现；声音只建议原合同允许的变化",
    "cameraZh": "在人群间平移，焦点最终落在既有静止主体，不生成陌生群演",
    "storyPurposeZh": "从众人中发现关键人物",
    "sourceKind": "image"
  },
  {
    "id": "entrance_detail_reveal",
    "no": 10,
    "nameZh": "局部特写",
    "prerequisiteZh": "已有可叙事的手、鞋、眼神或道具细节",
    "lightingZh": "局部光照清真实细节与材质，背景压暗，光源须来自原场",
    "atmosphereZh": "细节和原有声音放大线索，不新增戒指、烟或道具",
    "cameraZh": "先局部特写，再上移或切向同一人物脸部，保持手眼与身份关联",
    "storyPurposeZh": "由特征推出人物身份或状态",
    "sourceKind": "image"
  },
  {
    "id": "entrance_turn_reveal",
    "no": 11,
    "nameZh": "转身揭示",
    "prerequisiteZh": "已有背身人物与明确转身触发",
    "lightingZh": "转身时侧脸先进入原有侧光，随后正脸可读，不让光源无故换侧",
    "atmosphereZh": "从隐到显的情绪过渡保持环境连续",
    "cameraZh": "固定或克制跟随，背身→侧脸→正脸，转身方向不越轴",
    "storyPurposeZh": "把听见事件后的反应作为身份揭示",
    "sourceKind": "image"
  },
  {
    "id": "entrance_reflection",
    "no": 12,
    "nameZh": "镜面倒影",
    "prerequisiteZh": "已有镜、玻璃或水面等真实反射材质",
    "lightingZh": "按原有光源保留反射亮暗和真实人物暗部，反射畸变须有材质依据",
    "atmosphereZh": "先见倒影，再见实体，雨雾只在原场已存在时使用",
    "cameraZh": "侧移由反射对焦到实体，同一actor的倒影不计作第二个人",
    "storyPurposeZh": "让间接观察承载身份或心理距离",
    "sourceKind": "image"
  },
  {
    "id": "entrance_window_solitude",
    "no": 13,
    "nameZh": "窗边孤独",
    "prerequisiteZh": "已有窗与窗外环境，人物确在窗边",
    "lightingZh": "窗光照亮半脸，另一侧保留阴影与眼神层次，窗外反光符合现有建筑时代",
    "atmosphereZh": "室内安静和窗外远景形成距离感，不自动添加现代城市",
    "cameraZh": "从室内缓靠窗边人物，保留窗框与环境关系",
    "storyPurposeZh": "用半明半暗与空间距离表现孤独",
    "sourceKind": "image"
  },
  {
    "id": "entrance_desk_power",
    "no": 14,
    "nameZh": "桌前权力",
    "prerequisiteZh": "已有桌、人物与桌上物，不自动添桌灯文件",
    "lightingZh": "利用既有局部光照亮手、现有物件和半脸，背景压暗但座次可辨",
    "atmosphereZh": "沉默、姿态与暗背景形成控制感，不新增烟具或文件",
    "cameraZh": "缓推桌前人物，先保留座次和手部信息再收紧脸",
    "storyPurposeZh": "让控制权通过姿态与受光显现",
    "sourceKind": "image"
  },
  {
    "id": "entrance_contact_light",
    "no": 15,
    "nameZh": "接触闪光与受光",
    "sourceKind": "skill",
    "prerequisiteZh": "原场已有武器接触、爆点或法术闪光事件",
    "lightingZh": "闪光与接触同刻，从真实事件位置照亮手、武器、对手和附近材质，随后恢复原场光",
    "atmosphereZh": "短促亮暗变化强调命中与受力，不用全屏白光遮盖因果",
    "cameraZh": "稳定中景或接触近景读清出招→接触→受力→回收",
    "storyPurposeZh": "以局部受光证明冲击发生，而不是另添爆炸"
  },
  {
    "id": "entrance_color_relationship",
    "no": 16,
    "nameZh": "关系双色对照",
    "sourceKind": "direction",
    "prerequisiteZh": "本故事已确定两种颜色的关系含义，并存在相应光源",
    "lightingZh": "两侧不同色温或色相区分关系，受光随位置变化；红蓝只是可选，不作默认",
    "atmosphereZh": "色调、服装和材质共同服务本剧关系，角色立场变化时才有依据地转变",
    "cameraZh": "同框交代两人位置与色区，移动时不无故互换光向",
    "storyPurposeZh": "让颜色承担当前故事的信息，而不是套作者色表"
  },
  {
    "id": "entrance_single_flare",
    "no": 17,
    "nameZh": "单点强光显威",
    "sourceKind": "skill",
    "prerequisiteZh": "已有强光源与需要短时强调的高光事件",
    "lightingZh": "控制局部高亮与轮廓，面部和行动目标留可读层次，不能整场过曝",
    "atmosphereZh": "局部光晕与暗环境对照形成异常感，不扩大成未知能源",
    "cameraZh": "先建立光源方向，再按信息目的推近或切反应",
    "storyPurposeZh": "用强光事件引出人物可见反应"
  },
  {
    "id": "entrance_soft_emotion",
    "no": 18,
    "nameZh": "柔光情绪缓冲",
    "sourceKind": "skill",
    "prerequisiteZh": "情绪特写或关系缓和，原场存在可扩散的光源",
    "lightingZh": "柔主光、低对比与细轮廓保留眼神和脸部层次，不无故改变光源方向",
    "atmosphereZh": "暖冷与柔硬按本场情绪选择，不把暖色等同于固定安全",
    "cameraZh": "克制近景读目光和呼吸，保留对方位置与反应",
    "storyPurposeZh": "在冲突间隙让情绪变化可被感受"
  },
  {
    "id": "entrance_moving_light",
    "no": 19,
    "nameZh": "移动光源跟随",
    "sourceKind": "skill",
    "prerequisiteZh": "原场有真实移动的灯、火或发光物，身份与持有者已锁",
    "lightingZh": "光源位移时受光、阴影与反射同向同步，写明被照对象和变化范围",
    "atmosphereZh": "移动明暗形成空间探索与未知感，不让光束自己漂移",
    "cameraZh": "跟随实际光源或被照目标，先交代起终位置再移动",
    "storyPurposeZh": "用照亮与离开暗区揭示可见信息"
  },
  {
    "id": "entrance_power_reversal",
    "no": 20,
    "nameZh": "亮暗权力翻转",
    "sourceKind": "direction",
    "prerequisiteZh": "已有上下位关系发生可见变化，光源或人物位置允许受光转移",
    "lightingZh": "人物换位或既有光源有依据变化时，亮区与暗区关系随事件翻转，嘴眼始终可读",
    "atmosphereZh": "对比变化反映关系结果，不换天气或建筑制造权力感",
    "cameraZh": "先同框建立双方受光和位置，再接住选择与换位后的结果",
    "storyPurposeZh": "让关系转折同时表现为空间和受光变化"
  }
];

export const MANHUA_ENTRANCE_ATMOSPHERE_GUARD_ZH = "只采用符合本场条件的条目，不混用全部目录，不照搬固定镜长。保留已锁人物及画外状态、场景、天气、道具、轴线、对白与音轨；不因模板添人、换场、改时代或擅自重生成。把光源方向、受光变化、氛围层次与动作/台词/运镜写在同一镜头秒窗，秒窗沿用本次段长；对白嘴眼、接触动作和目标始终可读。光学数字优先沿用用户已定规格，不把建议当成渲染实参。";

export function getManhuaEntranceAtmosphereById(id?: string | null): ManhuaEntranceAtmosphereEntry | null {
  return MANHUA_ENTRANCE_ATMOSPHERE_BANK.find(e => e.id === String(id || "").trim()) || null;
}

/** 编剧产出可拍表，编排产出逐镜正文，顾问按能力给建议；最终引擎不接收整份目录。 */
export function formatManhuaEntranceAtmosphereCatalog(stage: "writer" | "trial" | "storyboard" | "advisor" | "world"): string {
  const world = stage === "world";
  return [
    "【出场氛围与灯光候选库】",
    MANHUA_ENTRANCE_ATMOSPHERE_GUARD_ZH,
    world ? "静态场景只写可实现的光源、材质与环境层次；运镜、人物动作和逐秒变光仅列为正式影片建议，不能写进静态场景生成正文。" : stage === "trial" ? "当前只写试写大纲，手法仅用于现有节拍的具体行动与气氛；不增加可拍表、镜头字段、正文分段或已锁剧情。" : stage === "writer" ? "按人物出场的剧情目的选用，落实到可拍表的灯光/运镜/画面与表演栏，不新增剧情，不输出整份目录。" : "按当前剧情和真实场景挑选，在逐镜秒窗正文说明光源、氛围起终与触发事件，保留未选手法为空，不输出目录占用影片正文。",
    ...MANHUA_ENTRANCE_ATMOSPHERE_BANK.map(e => `${e.nameZh}｜前提：${e.prerequisiteZh}｜灯光：${e.lightingZh}｜氛围：${e.atmosphereZh}${world ? "" : `｜运镜：${e.cameraZh}｜叙事：${e.storyPurposeZh}`}`),
    "【/出场氛围与灯光候选库】",
  ].join("\n");
}
