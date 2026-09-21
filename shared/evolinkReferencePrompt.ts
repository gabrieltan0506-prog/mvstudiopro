/** 各模型的素材编号分别对应各类 URL 数组；只转换引用，不改写剧情与对白。 */
export function formatEvolinkReferencePrompt(prompt: string, model: "seedance" | "wan" | "h3"): string {
  const names = { image: "Image", video: "Video", audio: "Audio" } as const;
  return prompt.replace(/@(?:图片|图|image)\s*(\d+)|@(?:视频|影片|video)\s*(\d+)|@(?:音频|声音|audio)\s*(\d+)/gi,
    (_match, image, video, audio) => {
      const kind = image ? "image" : video ? "video" : "audio";
      const index = image || video || audio;
      return model === "seedance" ? `@${kind}${index}` : `${names[kind]} ${index}`;
    });
}
