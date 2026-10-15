import type { MusicEmotionTurn } from "@shared/musicEmotion";
export function MusicEmotionPanel({ emotion, label }: {emotion?: MusicEmotionTurn;label?:string}) {
  if (!emotion) return null;
  return <div className="my-1 border-l-2 border-violet-300/40 pl-2 text-xs">
    {label && <strong>{label}</strong>}
    <p>情绪：{emotion.fromZh} → {emotion.toZh}</p>
    <p>转折依据：{emotion.triggerZh}</p>
    <p>音乐：{emotion.musicZh}</p>
    <p>画面：{emotion.visualZh}</p>
  </div>;
}
