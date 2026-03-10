import { getWorkflow, updateWorkflow } from "./store/workflowStore"
import { routeModel } from "../router/modelRouter"
import { bananaGenerate } from "../models/banana"

async function generateStoryboardImages(storyboard:any[]) {
  const results:any[] = []

  for (const scene of storyboard) {
    try {
      const r = await bananaGenerate({
        prompt: scene.scenePrompt,
        width:1536,
        height:864,
        num_images:2
      })

      const imgs = r?.imageUrls || []

      results.push({
        sceneIndex:scene.sceneIndex,
        images:imgs
      })

    } catch(e:any) {

      results.push({
        sceneIndex:scene.sceneIndex,
        images:[],
        error:e?.message || "banana_error"
      })
    }
  }

  return results
}

export async function continueWorkflow(workflowId:string){

  const wf = getWorkflow(workflowId)

  if(!wf) throw new Error("workflow_not_found")

  const storyboard = wf.outputs?.storyboard || []

  updateWorkflow(workflowId,{
    currentStep:"storyboardImages"
  })

  const storyboardImages = await generateStoryboardImages(storyboard)

  updateWorkflow(workflowId,{
    outputs:{
      ...wf.outputs,
      storyboardImages
    }
  })

  const referenceImage =
    storyboardImages?.[0]?.images?.[0] || wf.payload?.imageUrl || null

  updateWorkflow(workflowId,{
    currentStep:"video"
  })

  const videoRoute = routeModel("video")

  let videoUrl = null
  let videoError = null

  try{

    if(referenceImage){

      const res = await fetch("/api/workflow-model",{
        method:"POST",
        headers:{ "Content-Type":"application/json"},
        body:JSON.stringify({
          op:"veoReferenceVideo",
          referenceImage,
          prompt:wf.payload?.prompt || "",
          duration:8,
          resolution:"720p"
        })
      })

      const j = await res.json()

      videoUrl = j?.videoUrl || null
    }

  }catch(e:any){
    videoError = e?.message
  }

  updateWorkflow(workflowId,{
    outputs:{
      ...getWorkflow(workflowId)?.outputs,
      videoUrl,
      finalVideoUrl:videoUrl,
      videoProvider:videoRoute.provider,
      videoModel:videoRoute.model,
      videoErrorMessage:videoError
    },
    currentStep:"done",
    status:"done"
  })

  return getWorkflow(workflowId)
}
