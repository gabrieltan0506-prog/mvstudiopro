
import { v4 as uuidv4 } from "uuid"
import { generateScript } from "./steps/scriptStep"
import { generateStoryboard } from "./steps/storyboardStep"
import { generateStoryboardImages } from "./steps/storyboardImagesStep"
import { generateVideo } from "./steps/videoStep"
import { renderVideo } from "./steps/renderStep"
import { generateMusic } from "../models/music"
import { generateVoice } from "../models/tts"

export async function runWorkflow(payload:any){

const workflowId = uuidv4()

const workflow:any = {
workflowId,
status:"running",
currentStep:"script",
payload,
outputs:{}
}

try{

/* SCRIPT */

workflow.currentStep="script"

const script = await generateScript({
prompt:payload.prompt,
targetWords:payload.targetWords,
targetScenes:payload.targetScenes
})

workflow.outputs.script = script.text
workflow.outputs.scriptProvider="google"
workflow.outputs.scriptModel="gemini-2.5-pro"


/* STORYBOARD */

workflow.currentStep="storyboard"

const storyboard = await generateStoryboard({
script:script.text,
targetScenes:payload.targetScenes,
sceneDuration:payload.sceneDuration
})

workflow.outputs.storyboard = storyboard


/* STORYBOARD IMAGES */

workflow.currentStep="storyboardImages"

const storyboardImages = await generateStoryboardImages({
scenes:storyboard,
referenceImages:payload.referenceImages || []
})

workflow.outputs.storyboardImages = storyboardImages


/* CHARACTER LOCK */

const referenceImages =
payload.referenceImages ||
(storyboardImages[0]?.images?.slice(0,2) || [])

workflow.outputs.lockedCharacters = referenceImages


/* VIDEO */

workflow.currentStep="video"

const video = await generateVideo({
scenes:storyboard,
referenceImages
})

workflow.outputs.videoProvider="fal"
workflow.outputs.videoModel="veo3.1-reference"
workflow.outputs.videoUrl=video.url


/* MUSIC */

workflow.currentStep="music"

const music = await generateMusic({
prompt:payload.prompt,
duration:payload.targetScenes * payload.sceneDuration
})

workflow.outputs.musicUrl = music.url


/* VOICE */

if(payload.dialogue){

workflow.currentStep="voice"

const voice = await generateVoice({
text:payload.dialogue
})

workflow.outputs.voiceUrl = voice.url

}


/* RENDER */

workflow.currentStep="render"

const finalVideo = await renderVideo({
videoUrl:workflow.outputs.videoUrl,
musicUrl:workflow.outputs.musicUrl,
voiceUrl:workflow.outputs.voiceUrl
})

workflow.outputs.finalVideoUrl = finalVideo.url


workflow.status="done"
workflow.currentStep="done"

return { ok:true, workflow }

}catch(e:any){

workflow.status="failed"
workflow.error=e.message

return { ok:false, workflow }

}

}

