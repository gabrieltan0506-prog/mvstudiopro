import { expect, it } from "vitest";
import { emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";
import { sanitizeManhuaCloudDraftBlock } from "@shared/manhuaCloudDraft";
import { hasManhuaAudioWork, stripManhuaFactoryCanvasArtifacts } from "./canvasDramaStudio";
import { defaultCanvasBlock } from "./canvasTypes";

it("只有配乐编辑稿仍是用户作品：云存储恢复后改稿清链归档，真正空节点可清理",()=>{
 const musicDraft={prompt:"追逐后渐弱",durationSec:45,model:"suno-v6" as const,brief:null};
 const original={...defaultCanvasBlock("video",0,0),id:"clip-e01-g01",episodeIndex:1,audioStudio:{...emptyCanvasAudioStudio(),musicDraft}};
 const cloud=sanitizeManhuaCloudDraftBlock(JSON.parse(JSON.stringify(original)))!;
 const restored={...original,audioStudio:cloud.audioStudio};
 expect(restored.audioStudio?.musicDraft).toEqual(musicDraft);expect(hasManhuaAudioWork(restored)).toBe(true);
 const empty={...defaultCanvasBlock("video",0,0),id:"clip-e01-g02",episodeIndex:1,audioStudio:emptyCanvasAudioStudio()};
 expect(hasManhuaAudioWork(empty)).toBe(false);
 const next=stripManhuaFactoryCanvasArtifacts([restored,empty],[]);
 expect(next.archivedCount).toBe(1);expect(next.removedCount).toBe(1);
 expect(next.blocks).toHaveLength(1);expect(next.blocks[0]).toMatchObject({archivedFromPreviousScript:true,audioStudio:{musicDraft}});
 expect(original.audioStudio.musicDraft).toEqual(musicDraft);
});
