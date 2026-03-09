export type TemplateWorkflow = {
  templateId: string
  name: string
  description?: string
  workflowType: "script-video" | "image-video"
  defaultPrompt?: string
  defaultModel?: string
}

export const sampleTemplates: TemplateWorkflow[] = [
  {
    templateId: "cinematic_story",
    name: "电影叙事模板",
    workflowType: "script-video",
    defaultPrompt: "cinematic storytelling scene",
    defaultModel: "veo"
  }
]
