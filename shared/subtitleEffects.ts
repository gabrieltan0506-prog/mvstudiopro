/** Stable IDs shared by the subtitle form, queue schema and renderer. */
export const SUBTITLE_EFFECT_IDS = ["none", "fade", "pop"] as const;
export type SubtitleEffect = (typeof SUBTITLE_EFFECT_IDS)[number];

export const SUBTITLE_EFFECT_OPTIONS: ReadonlyArray<{ id: SubtitleEffect; label: string; description: string }> = [
  { id: "none", label: "无特效", description: "保持清晰、稳定的对白字幕。" },
  { id: "fade", label: "柔和淡入淡出", description: "整句轻柔出现与消失，适合剧情对白。" },
  { id: "pop", label: "轻弹入", description: "整句由小到大轻弹出现，收尾淡出。" },
];
