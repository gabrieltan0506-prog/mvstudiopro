export interface TemplateWorkflow {
  templateId:string
  name:string
  workflowType:string
  promptTemplate:string
  defaultModels:{
    script?:string
    image?:string
    video?:string
    music?:string
  }
}
