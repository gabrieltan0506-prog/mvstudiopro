import { describe, expect, it } from "vitest";
import { buildDigitalHumanAdvisorProject } from "./digitalHumanAdvisor";
import { adoptDigitalHumanSource, loadDigitalHumanDraft, newDigitalHumanDraft, prepareDigitalHumanVideo } from "@shared/digitalHumanStudio";
import { fictionalViralBlueprint } from "@shared/viralCreation.fixture";

describe("口播生成到数字人表演消费", () => {
  it("来源镜表与后来新增的重音手势同时进入顾问和视频，纯台词不混入标注", () => {
    const bp = fictionalViralBlueprint("短视频");
    const d = adoptDigitalHumanSource(newDigitalHumanDraft("7","00000000-0000-4000-8000-000000000001"), {
      owner:"7",blueprintId:"test-blueprint",version:"test-v1",title:bp.title,platform:"xiaohongshu",aspectRatio:"9:16",
      script:bp.copywriting,detailedScript:bp.detailedScript,sceneDescription:"书房",direction:"自然讲述",shots:bp.storyboardCells,
    });
    d.direction = "反复整理、复制、改写逐项加重，词间停半拍；右手在胸前依次点落，最后收住。";
    d.portrait={source:"gs://test-bucket/person.png",name:"测试人物"};
    d.scene={source:"gs://test-bucket/room.png",name:"测试书房"};
    d.voiceId="test-voice";
    const audioId="00000000-0000-4000-8000-000000000002";
    d.approvedAudioRequestId=audioId;
    d.audios=[{request:{billingRequestId:audioId,input:d.script,voice:d.voiceId,speakerZh:"讲述者",speakerId:"test-speaker",voiceStateZh:""},status:"succeeded",source:"gs://test-bucket/voice.mp3",durationSec:24}];
    const saved=loadDigitalHumanDraft(JSON.stringify(d),"7");
    if (!saved) throw new Error("测试制作稿恢复失败");
    const context=buildDigitalHumanAdvisorProject(saved).context;
    expect(context.episodeBody).toBe(bp.copywriting);
    expect(context.shotSummary).toContain(d.direction);
    expect(context.shotSummary).toContain(bp.storyboardCells[0].actionZh);
    expect(context.shotSummary).toContain(bp.storyboardCells[0].editNoteZh);
    const video=prepareDigitalHumanVideo(saved,"00000000-0000-4000-8000-000000000003");
    expect(video.prompt).toContain(d.direction);
    expect(video.prompt).toContain(bp.storyboardCells[0].actionZh);
    expect(saved.audios[0].request.input).toBe(bp.copywriting);
    expect(saved.script).not.toContain("语气：");
  });
  it("长导演要求超过摘要容量时，来源镜表仍完整进入顾问实际消息", async () => {
    const { buildManhuaCreativeAdvisorLlmMessages } = await import("../../../server/services/platformSkillQa");
    const bp = fictionalViralBlueprint("短视频");
    const draft = adoptDigitalHumanSource(newDigitalHumanDraft("7", "00000000-0000-4000-8000-000000000001"), {
      owner: "7", blueprintId: "test-blueprint", version: "test-v1", title: bp.title,
      platform: "xiaohongshu", aspectRatio: "9:16", script: bp.copywriting,
      detailedScript: bp.detailedScript, sceneDescription: "书房", direction: "长".repeat(20000), shots: bp.storyboardCells,
    });
    const restored = loadDigitalHumanDraft(JSON.stringify(draft), "7")!;
    const context = buildDigitalHumanAdvisorProject(restored).context;
    expect(context.digitalHumanProduction?.direction).toBe(draft.direction);
    expect(context.digitalHumanProduction?.sourceShots).toEqual(bp.storyboardCells);
    expect(context.shotSummary).not.toContain(bp.storyboardCells[0].actionZh);
    const messages = buildManhuaCreativeAdvisorLlmMessages({ question: "保留原镜表编排", context });
    expect(messages[1].content).toContain(JSON.stringify(bp.storyboardCells));
    expect(messages[1].content).toContain(draft.direction);
  });

});
