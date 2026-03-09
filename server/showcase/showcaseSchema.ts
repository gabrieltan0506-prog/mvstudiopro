export type ShowcaseItem = {
  id: string
  title: string
  model: string
  prompt: string
  coverImage: string
  tags?: string[]
  templateWorkflowId?: string
}

export const sampleShowcase: ShowcaseItem[] = [
  {
    id: "disney_castle",
    title: "上海迪士尼乐园",
    model: "Nano Banana Pro",
    prompt: "Disney style castle, happy tourists",
    coverImage: "/showcase/disney.jpg",
    tags: ["travel","people"]
  }
]
