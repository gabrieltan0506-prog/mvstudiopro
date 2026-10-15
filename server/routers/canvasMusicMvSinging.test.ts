import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mocks=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),download:vi.fn(),audio:vi.fn()}));
vi.mock("../jobs/repository",()=>({getJobByIdStrict:mocks.get,createJob:mocks.create}));
vi.mock("../services/gcs",()=>({getGcsBucketName:()=>"test-bucket",downloadGcsObjectVersioned:mocks.download,uploadBufferToGcsIfAbsent:vi.fn(),signGsUriV4ReadUrl:vi.fn()}));
vi.mock("../services/canvasMusicMvMedia",()=>({resolveCanvasMusicMvAudio:mocks.audio,resolveCanvasMusicMvVideo:vi.fn()}));
import { canvasMusicMvRouter } from "./canvasMusicMv";
const planRequestId="11111111-1111-4111-8111-111111111111";
const requestId="22222222-2222-4222-8222-222222222222";
const audio={id:"song",url:"https://example.test/song.mp3",durationSec:6};
const plan={version:1,audioId:"song",audioDurationSec:6,analysisBasis:"native_audio",shots:[{id:"s",kind:"singing",startSec:0,endSec:6,visualPrompt:"主唱",cameraPrompt:"推进",lyricQuote:"",referenceIndices:[0]}]};
const saved={plan,input:{requestId:planRequestId,audio,lyrics:"",creativePrompt:"演唱",referenceSummaries:["肖像"],advisorEvidenceId:requestId}};
const caller=()=>canvasMusicMvRouter.createCaller({user:{id:7,role:"user"}} as TrpcContext);
beforeEach(()=>{
  vi.resetAllMocks();mocks.audio.mockResolvedValue("gs://test-bucket/song.mp3");mocks.get.mockResolvedValue(null);
  mocks.download.mockImplementation(async({gcsUri})=>({buffer:Buffer.from(JSON.stringify(gcsUri.endsWith("settled.json")?{settled:true}:saved))}));
});
describe("演唱裁段准备（离线队列替身）",()=>{
  it("采用计划决定真实裁段，重复恢复沿用同一任务",async()=>{
    mocks.create.mockImplementation(async(job)=>{mocks.get.mockResolvedValue(job);});
    const first=await caller().prepareSinging({requestId,planRequestId,shotId:"s"});
    const again=await caller().prepareSinging({requestId,planRequestId,shotId:"s"});
    expect(again).toEqual(first);expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({userId:"7",type:"post_prod",provider:"ffmpeg-post-prod",input:{action:"audio_trim",params:{audioUri:"gs://test-bucket/song.mp3",sourceStartSec:0,sourceEndSec:6,volume:1}}});
  });
  it("已有编号对应另一输入时拒绝，不另建任务",async()=>{
    mocks.get.mockResolvedValue({userId:"7",type:"post_prod",provider:"ffmpeg-post-prod",input:{action:"audio_trim",params:{sourceStartSec:2}}});
    await expect(caller().prepareSinging({requestId,planRequestId,shotId:"s"})).rejects.toMatchObject({code:"CONFLICT"});
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("未采用分镜或歌曲权限失败均不入队",async()=>{
    mocks.audio.mockRejectedValueOnce(new Error("音频无权限"));
    await expect(caller().prepareSinging({requestId,planRequestId,shotId:"s"})).rejects.toThrow("无权限");
    mocks.download.mockImplementation(async({gcsUri})=>({buffer:Buffer.from(JSON.stringify(gcsUri.endsWith("settled.json")?{settled:false}:saved))}));
    await expect(caller().prepareSinging({requestId,planRequestId,shotId:"s"})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
