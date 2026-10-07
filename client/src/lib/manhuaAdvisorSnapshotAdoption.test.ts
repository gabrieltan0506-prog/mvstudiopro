import { describe, expect, it, vi } from "vitest";
import { prepareManualEpisodeEditAdoption, persistAdvisorRewriteAdoptionWithSnapshot } from "./manhuaAdvisorAdoption";
import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import { MANHUA_WRITER_SESSION_LS_KEY, buildManhuaWriterSession, serializeManhuaWriterSession } from "@shared/manhuaWriterSession";
import { defaultCanvasBlock } from "./canvasTypes";
import { makeLocalMediaPointer, rememberLocalMediaDisplay } from "./manhuaLocalMediaStore";

function fixture(failWrite = 0) {
  const pack: ManhuaWriterPack = { seriesTitle: "墨菁传", logline: "取血", charactersMd: "先生", propsMd: "碗", locationsMd: "医馆", rawMarkdown: "旧稿", episodeCount: 2, episodes: [1,2].map(index => ({ index, title: `第${index}集`, body: `原稿${index}`, endHook: "悬念" })) };
  const original = { writerPack: pack, projectBible: null, blocks: [], edges: [], overlays: {} };
  const plan = prepareManualEpisodeEditAdoption({ ...original, busy: false, edit: { episodeIndex: 2, originalBody: "原稿2", originalEndHook: "悬念", body: "新剧情：先生取血救娘。", endHook: "红光" } });
  const values = new Map<string,string>([[MANHUA_WRITER_SESSION_LS_KEY, serializeManhuaWriterSession(buildManhuaWriterSession({writerPack:pack}))], ["mv-freeform-canvas-v1", "old-canvas"], ["mv-manhua-director-board-overlay-v1", "{}"]]);
  const before = new Map(values), writes: string[] = [];
  let n = 0;
  const storage = { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => { if(key.startsWith("manhua-advisor-rewrite-backup:")) throw Error("localStorage full"); writes.push(key); if(++n===failWrite) throw Error("quota"); values.set(key,value); }, removeItem:(key:string)=>{values.delete(key);} };
  const input = { plan, original, userId: "1", backupId: "snapshot-test", createdAt: "2026-10-07T14:00:00.000Z" };
  return {input,storage,values,before,writes};
}
describe("immutable snapshot before real draft adoption (offline)",()=>{
  it("近配额采用沿用已缓存图片的短引用，完整旧快照与其他集成片引用仍保留",async()=>{
    const h=fixture();
    const source="https://test.invalid/retained-reference.png?padding="+"x".repeat(300000);
    const pointer=makeLocalMediaPointer("adoption-retained-image");
    rememberLocalMediaDisplay({displayUrl:source,sourceUrl:source,pointer});
    const block={...defaultCanvasBlock("image",0,0),id:"retained-character",outputUrl:source,outputUrls:[source],editFusionUrls:[source],outputText:"原文字".repeat(12000)};
    const clip={...defaultCanvasBlock("video",0,0),id:"clip-e01-g01",episodeIndex:1,outputUrl:"https://test.invalid/ep1.mp4",outputUrls:["https://test.invalid/ep1.mp4"],refVideoUrl:"https://test.invalid/original.mp4"};
    const original={...h.input.original,blocks:[block,clip]};
    const plan=prepareManualEpisodeEditAdoption({...original,busy:false,edit:{episodeIndex:2,originalBody:"原稿2",originalEndHook:"悬念",body:"新剧情：先生取血救娘。",endHook:"红光"}});
    let snapshot="";
    const storage={...h.storage,setItem:(key:string,value:string)=>{if(key==="mv-freeform-canvas-v1"&&value.length>100000)throw new DOMException("quota","QuotaExceededError");h.storage.setItem(key,value);}};
    await persistAdvisorRewriteAdoptionWithSnapshot({...h.input,original,plan},storage,async(_user,_key,value)=>{snapshot=value;});
    const saved=JSON.parse(h.values.get("mv-freeform-canvas-v1")!);
    expect(saved.blocks[0].editFusionUrls).toEqual([pointer]);
    expect(saved.blocks[0].outputText).toBe(block.outputText);
    expect(saved.blocks[1].outputUrls).toEqual(clip.outputUrls);
    expect(saved.blocks[1].refVideoUrl).toBe(clip.refVideoUrl);
    expect(JSON.parse(snapshot).canvas.blocks[0].editFusionUrls).toEqual([source]);
    expect(original.blocks[0].editFusionUrls).toEqual([source]);
    expect(JSON.parse(h.values.get(MANHUA_WRITER_SESSION_LS_KEY)!).writerPack.episodes[1].body).toContain("先生取血救娘");
  });
  it("waits for the full snapshot outside localStorage, then adopts the new draft",async()=>{
    const h=fixture(); let release!:()=>void; let saved="";
    const save=vi.fn(async(_user:string,_key:string,json:string)=>{saved=json;expect(h.values).toEqual(h.before);await new Promise<void>(resolve=>{release=resolve;});});
    const pending=persistAdvisorRewriteAdoptionWithSnapshot(h.input,h.storage,save);
    expect(h.writes).toEqual([]);expect(JSON.parse(saved).writerPack.episodes[1].body).toBe("原稿2");
    release();await pending;
    expect(save).toHaveBeenCalledOnce();expect(h.writes).toHaveLength(3);
    expect(JSON.parse(h.values.get(MANHUA_WRITER_SESSION_LS_KEY)!).writerPack.episodes[1].body).toBe("新剧情：先生取血救娘。");
  });
  it("snapshot failure leaves every draft key untouched",async()=>{
    const h=fixture();await expect(persistAdvisorRewriteAdoptionWithSnapshot(h.input,h.storage,async()=>{throw Error("IDB full");})).rejects.toThrow("IDB full");
    expect(h.values).toEqual(h.before);expect(h.writes).toEqual([]);
  });
  it("does not overwrite an asset change made while awaiting the snapshot",async()=>{
    const h=fixture();await expect(persistAdvisorRewriteAdoptionWithSnapshot(h.input,h.storage,async()=>{h.values.set("mv-manhua-factory-character-prefs-v1","new-asset-version");})).rejects.toThrow("已改变");
    expect(h.writes).toEqual([]);expect(h.values.get("mv-manhua-factory-character-prefs-v1")).toBe("new-asset-version");
  });
  it("checks new in-flight work before committing, after preserving the original snapshot",async()=>{
    const h=fixture(),save=vi.fn(async()=>{});
    await expect(persistAdvisorRewriteAdoptionWithSnapshot({...h.input,beforeCommit:()=>{throw Error("new job pending");}},h.storage,save)).rejects.toThrow("new job pending");
    expect(save).toHaveBeenCalledOnce();expect(h.values).toEqual(h.before);expect(h.writes).toEqual([]);
  });
  it("rolls back a partially written draft and preserves the snapshot",async()=>{
    const h=fixture(2),save=vi.fn(async()=>{});
    await expect(persistAdvisorRewriteAdoptionWithSnapshot(h.input,h.storage,save)).rejects.toThrow("已保留原工程");
    expect(h.values).toEqual(h.before);expect(save).toHaveBeenCalledOnce();
  });
});
