/**
 * HB V5 · 电影抢镜 / 真人融入名场面（视频特效）
 * Canvas-only 消费；可与 Seedance I2V / 穿越漫剧场景叠加。
 */

export type SceneStealEntry = {
  id: string;
  no: number;
  nameZh: string;
  effectZh: string;
  whenToUseZh: string;
  /** 注入视频提示的手法摘要（含 @人物照片 占位说明） */
  craftSummaryZh: string;
  aspectHint: "9:16" | "16:9" | "either";
};

export const SCENE_STEAL_PROMPT_BANK: readonly SceneStealEntry[] = [
  {
    id: "steal_01_titanic_bow",
    no: 1,
    nameZh: "泰坦尼克船头抢镜",
    effectZh: "浪漫张臂名场面被真人突然闯入搅局，再霸气占位重摆姿势。",
    whenToUseZh: "穿越漫剧、黑色幽默短视频、真人融入经典场面。",
    craftSummaryZh:
      "广角船头、金色黄昏海面；原情侣做泰坦尼克张臂姿势。@人物照片 从右侧突兀冲入，夸张黑色幽默把女主推出画外（不写血腥/溺水细节），再若无其事转向镜头微笑，自信重摆同一姿势；原男主背景僵住惊慌。闯入时镜头微晃，落姿后稳定。电影感+荒诞对比。",
    aspectHint: "either",
  },
  {
    id: "steal_02_rain_kiss_interrupt",
    no: 2,
    nameZh: "雨中倒挂亲吻抢镜",
    effectZh: "雨夜名场面即将亲吻时，真人推开女主并自己上前完成夸张电影吻。",
    whenToUseZh: "超级英雄梗、雨夜情绪片、穿越抢戏。",
    craftSummaryZh:
      "首帧锁定雨夜倒挂超级英雄名场面（暖黄街灯、湿润皮肤、雨水下落）。@人物照片 锁脸真人从右侧快速入画（荒诞喜剧、勿暴力），轻推女主至画外，站到原位，扶住倒挂英雄面罩边缘完成夸张但电影感的雨中亲吻；英雄保持倒挂。保留参考人真实五官，勿过度美颜。",
    aspectHint: "either",
  },
  {
    id: "steal_03_portal_cross",
    no: 3,
    nameZh: "时空门丝滑穿越",
    effectZh: "真人从裂隙/门框一侧丝滑踏入异世界场景，前后光影连续。",
    whenToUseZh: "穿越漫剧开场、异世界落地、特效转场。",
    craftSummaryZh:
      "@人物照片 真人从画面一侧时空裂隙踏出，步伐连贯、衣角与粒子跟随；落地后镜头轻微推近锁脸。原场景可从现代切到古风/仙侠，但人物身份连续。禁止脸崩、肢体畸变；动作丝滑非瞬移闪现。",
    aspectHint: "9:16",
  },
];

export function getSceneStealById(id: string): SceneStealEntry | null {
  return SCENE_STEAL_PROMPT_BANK.find((e) => e.id === id) || null;
}

export function buildSceneStealInjectBlock(ids: string[]): string {
  const picked = ids.map(getSceneStealById).filter(Boolean) as SceneStealEntry[];
  if (!picked.length) return "";
  const lines = picked.map((e, i) => {
    return `${i + 1}. ${e.nameZh}\n效果：${e.effectZh}\n用法：${e.whenToUseZh}\n手法：${e.craftSummaryZh}\n须把用户参考人像作为真实多模态输入，不能只在文案里写“参考人脸”。禁止血腥重伤细节。`;
  });
  return `【电影抢镜·真人融入】\n${lines.join("\n")}`;
}
