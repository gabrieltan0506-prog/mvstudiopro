export type ModelType =
  | "script"
  | "image"
  | "video"
  | "music";

export interface ModelRoute {
  provider: string
  model: string
}

export function routeModel(type: ModelType): ModelRoute {

  switch(type){

    case "script":
      return {
        provider:"google",
        model:"gemini-3.1"
      }

    case "image":
      return {
        provider:"fal",
        model:"fal-ai/nano-banana-2"
      }

    case "video":
      return {
        provider:"kling",
        model:"kling-video"
      }

    case "music":
      return {
        provider:"suno",
        model:"suno"
      }

    default:
      throw new Error("unknown model type")
  }

}
