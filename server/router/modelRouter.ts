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
        provider:"vertex",
        model:"imagen-4.0-generate"
      }

    case "video":
      return {
        provider:"vertex",
        model:"veo-3.1-generate-001"
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
