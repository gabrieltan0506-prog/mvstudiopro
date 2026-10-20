import {beforeEach,expect,it,vi} from "vitest";
import {buildSongCoverPrompt} from "../../shared/songCover";
import {canvasMusicMvStateSchema} from "../../shared/canvasMusicMv";
const f=vi.hoisted(()=>({music:vi.fn(), rows:new Map<string,any>(), insert:vi.fn()}));
vi.mock("../jobs/repository",()=>({getJobByIdStrict:f.music}));
vi.mock("../db",()=>({getDb:async()=>({
 insert:()=>({values:(row:any)=>({onConflictDoNothing:async()=>{f.insert(row);if(!f.rows.has(row.id))f.rows.set(row.id,row);}})}),
 select:()=>({from:()=>({where:async()=>Array.from(f.rows.values())})}),
})}));
import {queueSongCover,songCoverJob} from "./songCover";
const brief={model:"suno-v6" as const,custom_mode:true as const,instrumental:false,title:"灯下归人",style:"温暖钢琴",prompt:"[Verse]\n留一盏灯",negative_tags:"",duration:90,style_weight:0.7,weirdness_constraint:0.2};
beforeEach(()=>{f.rows.clear();vi.clearAllMocks();f.music.mockResolvedValue({id:"bgm_one",userId:"7",status:"succeeded",input:{action:"manhua_bgm_v55",params:{brief}}});});
it("封面从原歌曲快照编译，固定Flare和双通道契约，保留全部歌词",()=>{
 const prompt=buildSongCoverPrompt(brief),a=songCoverJob(7,"bgm_one",brief,prompt);
 expect(a.input.params).toMatchObject({prompt,openaiImageVariant:"flare",requireImageVariant:true,providerOverride:"openai",aspectRatio:"9:16",generalImageEdit:true});
 expect(prompt).toContain(brief.prompt);expect(prompt).toContain(brief.style);
 expect(()=>songCoverJob(7,"bgm_one",brief,prompt+"改稿")).toThrow("不一致");
 expect(songCoverJob(8,"bgm_one",brief,prompt).id).not.toBe(a.id);
});
it("刷新或并发恢复保持一个任务，已失败也不重建；云草稿保留确认快照",async()=>{
 const prompt=buildSongCoverPrompt(brief);const a=await queueSongCover(7,"bgm_one",prompt);
 const stored=f.rows.get(a.jobId);stored.status="failed";
 const b=await queueSongCover(7,"bgm_one",prompt);expect(b).toEqual({jobId:a.jobId,status:"failed"});expect(f.rows.size).toBe(1);
 const state=canvasMusicMvStateSchema.parse({status:"music_ready",candidates:[],songCovers:[{musicJobId:"bgm_one",jobId:a.jobId,prompt,status:"failed",error:"上游失败"}]});expect(state.songCovers?.[0].prompt).toBe(prompt);
});
it("禁止替他人歌曲或未完成歌曲产生图片费用",async()=>{
 const prompt=buildSongCoverPrompt(brief);
 await expect(queueSongCover(8,"bgm_one",prompt)).rejects.toThrow("无权");
 f.music.mockResolvedValue({userId:"7",status:"running",input:{action:"manhua_bgm_v55",params:{brief}}});
 await expect(queueSongCover(7,"bgm_one",prompt)).rejects.toThrow("尚未成功");expect(f.insert).not.toHaveBeenCalled();
});

it("新专辑封面固定1:1并拥有独立身份，旧9:16任务保持原ID",async()=>{
 const oldPrompt=buildSongCoverPrompt(brief),prompt=buildSongCoverPrompt(brief,"1:1");
 const old=songCoverJob(7,"bgm_one",brief,oldPrompt),album=songCoverJob(7,"bgm_one",brief,prompt,"1:1");
 expect(album.input.params.aspectRatio).toBe("1:1");expect(prompt).toContain("正方形1:1");expect(album.id).not.toBe(old.id);
 expect(songCoverJob(7,"bgm_one",brief,oldPrompt,"9:16").id).toBe(old.id);
 expect(()=>songCoverJob(7,"bgm_one",brief,prompt,"9:16")).toThrow("不一致");
 const a=await queueSongCover(7,"bgm_one",prompt,"1:1"),b=await queueSongCover(7,"bgm_one",prompt,"1:1");expect(a.jobId).toBe(b.jobId);expect(f.rows.size).toBe(1);
});
