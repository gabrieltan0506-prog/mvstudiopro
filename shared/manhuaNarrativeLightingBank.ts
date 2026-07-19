/**
 * 叙事灯光动机库：安全→危险→真相→崩塌→决断等连续光语。
 * 与 craftShotBank lighting 互补；成稿只写光法，不写来源名。
 */

export type ManhuaNarrativeLightingEntry = {
  id: string;
  no: number;
  nameZh: string;
  stageZh: string;
  effectZh: string;
  whenToUseZh: string;
  craftSummaryZh: string;
  craftLockEn: string;
};

export const MANHUA_NARRATIVE_LIGHTING_BANK: readonly ManhuaNarrativeLightingEntry[] = [
  {
    id: "nlight_01_safety_warm",
    no: 1,
    nameZh: "安全暖区",
    stageZh: "安全",
    effectZh: "暖实用光包住人物，阴影软、世界暂时可信。",
    whenToUseZh: "日常铺垫、假象安稳、亲情缓冲。",
    craftSummaryZh: "暖 key；实用光动机；面部可读；暗部保留层次但不压迫。",
    craftLockEn: "warm practical safety key, soft falloff, readable face",
  },
  {
    id: "nlight_02_danger_edge",
    no: 2,
    nameZh: "危险切边",
    stageZh: "危险",
    effectZh: "冷硬侧光切开轮廓，安全区被撕开一条缝。",
    whenToUseZh: "威胁进场、脚步逼近、警报将响。",
    craftSummaryZh: "冷侧切；对比升高；光源方向突然可怖但仍动机。",
    craftLockEn: "cold hard edge key, rising contrast, motivated threat",
  },
  {
    id: "nlight_03_truth_beam",
    no: 3,
    nameZh: "真相束光",
    stageZh: "真相",
    effectZh: "窄束光照亮证物/字迹/伤痕，其余坠入暗场。",
    whenToUseZh: "证据落地、秘密揭开、信息反转。",
    craftSummaryZh: "窄束照证据；背景压暗；人物可半入光半入暗。",
    craftLockEn: "narrow truth beam on evidence, crushed surround",
  },
  {
    id: "nlight_04_collapse_desat",
    no: 4,
    nameZh: "崩塌去饱和",
    stageZh: "崩塌",
    effectZh: "色温塌陷、饱和骤降，世界失去承诺感。",
    whenToUseZh: "信仰崩、关系裂、权力空心。",
    craftSummaryZh: "去饱和；顶侧硬光或熄灯；眼神仍要可读。",
    craftLockEn: "desaturated collapse grade, hard top-side or blackout, eyes readable",
  },
  {
    id: "nlight_05_decision_rim",
    no: 5,
    nameZh: "决断轮廓",
    stageZh: "决断",
    effectZh: "背后细轮廓勾出决意身形，前脸冷静。",
    whenToUseZh: "抉择出手、启程复仇、签字翻盘。",
    craftSummaryZh: "薄 rim 立志；前脸冷静；色温回收一点方向感。",
    craftLockEn: "thin resolve rim, calm face key, directional recovery",
  },
  {
    id: "nlight_06_power_by_light",
    no: 6,
    nameZh: "权力靠光",
    stageZh: "权力",
    effectZh: "强势者占亮区，弱势者坠入欠曝，权力不靠台词。",
    whenToUseZh: "上下位、宫斗、审讯、谈判。",
    craftSummaryZh: "亮区=权力；欠曝=服从；换位时光权同步翻转。",
    craftLockEn: "power via light: dominant in key, subordinate underexposed",
  },
  {
    id: "nlight_07_light_the_evidence",
    no: 7,
    nameZh: "照亮证据",
    stageZh: "线索",
    effectZh: "灯光叙事任务=点亮证物，人物成为光路中的反应体。",
    whenToUseZh: "悬疑、权谋、罪证。",
    craftSummaryZh: "先照物再照人；光斑形状可读；禁全场平光。",
    craftLockEn: "light the evidence first, reactive figure in spill",
  },
  {
    id: "nlight_08_progression_chain",
    no: 8,
    nameZh: "五段光链",
    stageZh: "连续",
    effectZh: "安全→危险→真相→崩塌→决断在一集内递进变光。",
    whenToUseZh: "单集完整情绪弧、竖屏高潮集。",
    craftSummaryZh: "同场景可换色温/明暗比递进；每段只改一档光语。",
    craftLockEn: "five-stage light progression, one shift per beat",
  },
];

export function getNarrativeLightingById(id?: string | null): ManhuaNarrativeLightingEntry | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return MANHUA_NARRATIVE_LIGHTING_BANK.find((e) => e.id === key) || null;
}

export function listNarrativeLighting(): readonly ManhuaNarrativeLightingEntry[] {
  return MANHUA_NARRATIVE_LIGHTING_BANK;
}

export function buildNarrativeLightingInjectBlock(ids: string[]): string {
  const picked = ids.map(getNarrativeLightingById).filter(Boolean) as ManhuaNarrativeLightingEntry[];
  if (!picked.length) return "";
  const lines = picked.map(
    (e, i) =>
      `${i + 1}. 【叙事灯光·${e.stageZh}】${e.nameZh}：${e.craftSummaryZh}（效果：${e.effectZh}）\n   EN: ${e.craftLockEn}`,
  );
  return [
    "【叙事灯光动机库】",
    "硬规则：成稿只写光法与动机；禁止导演名、片名、外仓品牌。",
    "本集主用下列光语（可按节拍递进，勿一次混炖）：",
    ...lines,
  ].join("\n");
}

export function recommendNarrativeLightingFromTopic(topic?: string): {
  lightingId: string | null;
  entry: ManhuaNarrativeLightingEntry | null;
  reasonZh: string;
} {
  const t = String(topic || "").trim();
  const hints: Array<{ keys: string[]; id: string }> = [
    { keys: ["证据", "罪证", "线索", "揭穿"], id: "nlight_07_light_the_evidence" },
    { keys: ["权谋", "宫斗", "审讯", "上下位"], id: "nlight_06_power_by_light" },
    { keys: ["崩塌", "崩溃", "绝望", "背叛"], id: "nlight_04_collapse_desat" },
    { keys: ["决断", "翻盘", "启程", "复仇"], id: "nlight_05_decision_rim" },
    { keys: ["真相", "揭秘", "反转"], id: "nlight_03_truth_beam" },
    { keys: ["危险", "追杀", "威胁"], id: "nlight_02_danger_edge" },
    { keys: ["日常", "安稳", "亲情"], id: "nlight_01_safety_warm" },
  ];
  for (const h of hints) {
    if (h.keys.some((k) => t.includes(k))) {
      const entry = getNarrativeLightingById(h.id);
      return {
        lightingId: entry?.id || null,
        entry,
        reasonZh: `题材偏「${h.keys.find((k) => t.includes(k))}」→ 推荐「${entry?.nameZh}」`,
      };
    }
  }
  const fallback = getNarrativeLightingById("nlight_08_progression_chain");
  return {
    lightingId: fallback?.id || null,
    entry: fallback,
    reasonZh: t ? "未强命中，推荐五段光链（可更换）" : "未填题材时默认五段光链（可更换）",
  };
}
