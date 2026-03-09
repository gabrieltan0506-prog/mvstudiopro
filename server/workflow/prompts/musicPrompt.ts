export function buildMusicPrompt(input: {
  genre?: string;
  mood?: string;
  pace?: string;
  duration?: number;
  hasVocal?: boolean;
  bpm?: number;
}) {
  const genre = String(input.genre || "cinematic trailer soundtrack").trim();
  const mood = String(input.mood || "dramatic tension").trim();
  const pace = String(input.pace || "medium-fast").trim();
  const duration = Number(input.duration || 0) || 30;
  const hasVocal = Boolean(input.hasVocal);
  const bpm = Number(input.bpm || 0) || 0;

  const parts = [
    genre,
    "cinematic trailer soundtrack",
    "hybrid orchestral + dark electronic pulse",
    `mood: ${mood}`,
    `pace: ${pace}`,
    `duration: ${duration}s`,
    hasVocal ? "with vocal" : "no vocal",
  ];

  if (bpm > 0) parts.push(`bpm: ${bpm}`);
  return parts.join(", ");
}
