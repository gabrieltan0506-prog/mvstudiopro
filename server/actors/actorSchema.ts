export type Actor = {
  actorId: string
  name: string
  description?: string
  styleTags?: string[]
  basePrompt?: string
  previewImage?: string
}

export const sampleActors: Actor[] = [
  {
    actorId: "female_agent",
    name: "女特工",
    description: "电影风格女性特工角色",
    styleTags: ["cinematic","action"],
    basePrompt: "female secret agent cinematic lighting",
    previewImage: "/actors/female_agent.jpg"
  }
]
