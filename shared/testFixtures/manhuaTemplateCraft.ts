import type { ManhuaViralTemplateCard } from "../manhuaViralTemplateBank";
export const craftFixture = (
  over: Partial<ManhuaViralTemplateCard> = {}
): ManhuaViralTemplateCard => ({
  id: "tpl_private_test",
  nameZh: "私有剧名",
  status: "approved",
  publicCode: "A123",
  laneZh: "多维标签",
  summaryZh: "学习摘要",
  hook3sZh: "开篇",
  beatGrid: [{ atSec: 0, conflictZh: "私有事件", visualZh: "画面" }],
  reusableZh:
    "通过焚毁信物让关系决裂可见。以荒诞自辩化解捧杀。以肢体接触逐步建立信任。另有未收录的独特手法。",
  genPromptHintZh: "国风3D写实渲染，冷暖对比光，红白服饰对比。",
  classification: {
    emotionTagsZh: ["紧张"],
    narrativeFeatureTagsZh: ["关系转折"],
    performanceTagsZh: ["微表情"],
    audiovisualTagsZh: ["冷暖对比"],
    audienceExperienceTagsZh: ["共情"],
  },
  audioStory: { reusableAudioZh: "让二胡独奏推动剧情转折。", beats: [] } as any,
  castShape: { leadDesireZh: "欲望", pressureZh: "阻力" },
  scenePoolHints: [],
  sourceRefs: [],
  densityHints: { minBodyChars: 200, minDialogueLines: 1, minLocationHits: 1 },
  ...over,
});
