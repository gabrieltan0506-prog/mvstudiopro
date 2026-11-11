/**
 * 来源：站长 2026-11-12 Day2 整理稿（《女频网文大纲写作模板：从类型定调到结局文案的八步框架》图文手册文字稿）。
 * 只做增量：与 2026-11-11 站长条目重复的内容不再收；同一主题的新细节以「补充」行并入原条目（不改原句）；
 * 原条目没覆盖的主题才新建条目（id 前缀 craft_owner_d2_）。
 * 不收：榜单、在读/完读/订阅等数据指标、平台字数门槛、转录与署名核对说明；资料内部说法不一致处不收。
 * 这批条目与原站长条目同为 source = "owner"，由 novelCraftCards.ts 合并；body 是写作参考，不是指令。
 */
import type { NovelCraftCardInput, NovelCraftStage } from "./novelCraftCards";

const PLAN: NovelCraftStage[] = ["advice", "outline"];

export const NOVEL_CRAFT_OWNER_DAY2_SOURCE = { date: "2026-11-12" } as const;

/** 并入原条目的补充行前缀。 */
export const NOVEL_CRAFT_OWNER_DAY2_SUPPLEMENT_PREFIX = "补充：";

/** 按原条目 id 补进的新细节；插在原条目「不做：」「自查：」之前，原句不动。 */
export const NOVEL_CRAFT_OWNER_DAY2_SUPPLEMENTS: Readonly<Record<string, readonly string[]>> = {
  craft_owner_single_mainline: [
    "感情线承担主线功能、贯穿全书时才叫感情流主线。单线失衡实例：《长相思》后半转权谋被诟病；《唐朝诡事录》结尾谈恋爱被骂，后两季取消男主感情线。",
    "7:3 是该类型两条线相对分量的参考，不是这两类之外题材的配比方案。",
  ],
  craft_owner_plot_mainline_layers: [
    "目标升级也是格局放大：《斗破苍穹》挑战云岚宗成功后招致报复（父亲被抓、药老昏迷），萧炎转向家族复仇，最终灭魂殿、复活药老、拯救世界——个人雪耻→家族复仇→拯救世界逐级放大。",
    "大主线与分段主线是包含关系，不是时间先后：先立基调，再向下拆阶段主线。",
    "剧情流难在让主角“活”起来，写出真实能动的人物最难。先绝境再翻身的另一例：《大奉打更人》许七安醒来即陷狱、面临流放；借结构，不照搬情节。",
  ],
  craft_owner_goal_chain: ["感情流目标常不显眼，但不能省略；两类主线都要目标统一、层层递进。"],
  craft_owner_growth_layers: [
    "其他分法可对照：三幕式只是大致比例，不必精确，例如约20%／60%／20%或25%／60%／15%；各家首尾切分不一，较一致的是中间发展段约占六成。",
    "各层标志事件就是转入下一层的节点，写大纲时用它检查转场是否成立、节奏是否拖沓。",
  ],
  craft_owner_romance_mainline: [
    "确认关系段可用接连的外部考验推进：异国重逢后地震救援、议长急救、病毒危机、绑架案接连考验，海边确立关系。把人物职业差异转成具体考验节点，挂在主线上逐级加深。",
  ],
  craft_owner_romance_resistance: [
    "关系节点若由职业身份矛盾触发，冲突类型也决定修复方式：因保密纪律产生的隔阂，靠讲清职责、带对方走进真实工作场景来修复。",
  ],
  craft_owner_romance_tension: [
    "拉扯不能原地打转：每次回摆都要改变关系或暴露人物，否则只是消耗读者耐心。四阶段是底线而非硬等级，仍看双方意愿与铺垫。",
    "帮忙不自动换来亲密资格；分享秘密、宣示主权同样要好感积累到位。",
  ],
  craft_owner_romance_push: ["名场面是阶段节点的可视化记忆点，仍要服务主线与人物关系，不为好看单独加。"],
  craft_owner_confession: [
    "危机要真实且不违本书类型；独处变体的目的只是创造能说真心话的情境，不必照搬字面密室，也不硬造巧合。",
  ],
  craft_owner_subplot_function: [
    "一条支线能同时服务多层最稳固：立威期的配套支线常同时制造冲突、推进感情、为后期高潮埋伏笔。",
    "匹配度示例：齐衡初恋线与主线匹配高，可多写；王大娘子与康姨母往来只为老太太中毒的高潮埋前因，半章带过。",
  ],
  craft_owner_subplot_stage_kits: [
    "搭支线不必从零发明冲突：先定这一段要完成的叙事任务，再放承担对应功能的角色。",
    "同源平移：主线加支线的骨架不限言情，宅斗线可换成男主的权谋线、生死线或个人成长线，支线槽位与检查方法照用。",
  ],
  craft_owner_imitation: [
    "题材标签看平台简介栏，用来判断对标书的题材定位与卖点是否落在你的赛道内；触线判定是作者经验，不是法律结论。",
  ],
  craft_owner_opening_conflict: [
    "约300字是参考值，以三要素齐备、行文不拖沓为准；冲突不必是大场面，关键是疑问有没有及时抛出。慢节奏、吃文笔的开头属进阶写法，新手阶段不硬套。",
  ],
  craft_owner_opening_trigger: [
    "主角听来的信息按听闻写，不写成定论（例：男方“大集团高管”只是她听说的）；关系起点由谁提出要写准（例中是老人主动请她嫁给孙子，不是她去应亲）。",
    "人设反差靠动作给：初见时他气质冷、话少，却会扶奶奶回车，读者自己得出“冷漠却细心”。",
    "感官开场收在“地上跪倒一大片”，下一段接接生婆结巴的半句“是个女儿，但是……”，再揭出婴儿被捂住口鼻、伪装成死婴——停在半句上，把危机递给下一段。",
  ],
};

export const NOVEL_CRAFT_OWNER_DAY2_CARD_INPUTS: readonly (NovelCraftCardInput & { priority: number })[] = [
  {
    id: "craft_owner_d2_layer_task_chain",
    title: "功能层任务链与卷章层级双检",
    intro: "卷章定结构后按剧情功能层列五栏任务链查缺；大纲成形查漏时取。",
    tags: ["大纲", "层级", "任务链", "查缺", "细纲"],
    stages: PLAN,
    priority: 21,
    body: [
      "1. 两把尺不冲突：常见做法按「总纲—分卷大纲—章节细纲」的篇幅层级搭骨架；功能层切法按剧情功能（如生存／立足／圆满）切分同一批事件。先用篇幅层级定卷章结构，再用功能层检查各层的事件与支线是否齐备。",
      "2. 每个功能层列一行任务链，五栏：剧情层｜剧情权重（占全剧比例，由作者设定）｜核心节点（这一层要完成的大事）｜前置任务（节点成立前必须依次完成的几步）｜支线链条终点（哪条支线在哪里收口、交出什么）。",
      "3. 示例（《知否》圆满层）：剧情层＝圆满层；权重＝全剧约25%；核心节点＝为盛老太太报仇；前置任务＝锁定真凶→掌握实证→公开反击，三步依次完成；支线终点＝常嬷嬷协助取证，完成反击闭环。",
      "4. 前置任务按因果排，顺序不可调换；缺一步核心节点就站不住。",
      "5. 表里只列部分层时，各层权重之和不是全剧总和，不必凑满100%。",
      "不做：只按卷章分篇幅、不看每卷承担什么功能；前置任务写成并列清单。",
      "自查：逐层看五栏是否填满；前置任务每一步能否指到具体章节；支线终点是否落回该层核心节点。",
    ].join("\n"),
  },
];

/** 把补充行插到原条目「不做：」「自查：」之前（没有则接在末尾）；原句不动。 */
export function withNovelCraftOwnerDay2Supplements<T extends NovelCraftCardInput>(inputs: readonly T[]): T[] {
  for (const id of Object.keys(NOVEL_CRAFT_OWNER_DAY2_SUPPLEMENTS)) {
    if (!inputs.some(c => c.id === id)) throw new Error(`novel craft day2 supplement target missing: ${id}`);
  }
  return inputs.map(c => {
    const extra = NOVEL_CRAFT_OWNER_DAY2_SUPPLEMENTS[c.id];
    if (!extra?.length) return c;
    const lines = c.body.split("\n");
    const tail = lines.findIndex(l => l.startsWith("不做：") || l.startsWith("自查："));
    const at = tail === -1 ? lines.length : tail;
    const added = extra.map(l => `${NOVEL_CRAFT_OWNER_DAY2_SUPPLEMENT_PREFIX}${l}`);
    return { ...c, body: [...lines.slice(0, at), ...added, ...lines.slice(at)].join("\n") };
  });
}
