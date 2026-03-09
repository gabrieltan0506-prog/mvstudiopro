import { updateWorkflow, getWorkflow } from "../store/workflowStore"

export async function runVideoStep(workflowId:string){

const wf=getWorkflow(workflowId)
if(!wf) throw new Error("workflow_not_found")

const storyboardImages=wf.outputs?.storyboardImages
if(!storyboardImages?.length) throw new Error("storyboard_images_missing")

const referenceImage=storyboardImages[0]?.images?.[0]
if(!referenceImage) throw new Error("reference_image_missing")

updateWorkflow(workflowId,{
status:"running",
currentStep:"video"
})

const res=await fetch("https://fal.run/fal-ai/veo3.1/reference-to-video",{
method:"POST",
headers:{
"Authorization":`Key ${process.env.FAL_API_KEY||process.env.FAL_KEY}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
reference_image:referenceImage,
prompt:wf.payload.prompt,
duration:8,
resolution:"720p"
})
})

if(!res.ok) throw new Error("veo_reference_video_failed")

const data=await res.json()
const videoUrl=data?.video?.url||data?.url

if(!videoUrl) throw new Error("video_url_missing")

updateWorkflow(workflowId,{
status:"done",
currentStep:"done",
outputs:{
...wf.outputs,
videoProvider:"fal",
videoModel:"veo3.1-reference",
finalVideoUrl:videoUrl
}
})

return getWorkflow(workflowId)
}
