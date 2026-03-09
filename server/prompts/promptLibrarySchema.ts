export type PromptItem = {
  promptId: string
  title: string
  prompt: string
  tags?: string[]
  recommendedModel?: string
}

export const samplePrompts: PromptItem[] = [
  {
    promptId: "cyber_city",
    title: "赛博朋克城市",
    prompt: "cyberpunk neon city skyline rain reflections",
    tags: ["sci-fi","city"],
    recommendedModel: "kling"
  }
]
