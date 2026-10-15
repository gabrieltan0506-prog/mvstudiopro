import {expect,it,vi} from "vitest";
import {readSongCraftCloudLibrary} from "./songCraftCloudLibrary";
const card={id:"method-one",title:"新方法",contributor:"公开来源",basis:"interview",highlights:["具体行动"],lyricPrompt:"自然写词",stylePrompt:"warm piano",mvPrompt:"行为推进",sources:[{title:"来源",url:"https://example.test/source"}]};
const prefix="creative-generation-library/curated/songcraft/catalogs/";
it("每次读取最新GCS目录，Fly返回正文而非GCS链接",async()=>{
 let version="20261015T172000Z-aaaaaaaaaaaa.json";
 const d={bucket:()=>"private-bucket",list:vi.fn(async()=>[{name:prefix+version,generation:"1"}]),read:vi.fn(async()=>({buffer:Buffer.from(JSON.stringify({version:1,publishedAt:"2026-10-15T17:20:00Z",cards:[{...card,id:version}]})),generation:"1"}))};
 const first=await readSongCraftCloudLibrary(d as any);version="20261015T172100Z-bbbbbbbbbbbb.json";
 const next=await readSongCraftCloudLibrary(d as any);expect(next.cards[0].id).not.toBe(first.cards[0].id);expect(d.list).toHaveBeenCalledTimes(2);expect(JSON.stringify(next)).not.toContain("gs://");expect(JSON.stringify(next)).not.toContain("storage.googleapis.com");
});
it("没有云端目录或版本不一致明确失败，不退回本机旧目录",async()=>{
 const d={bucket:()=>"private",list:vi.fn(async()=>[]),read:vi.fn()};await expect(readSongCraftCloudLibrary(d)).rejects.toThrow("尚未发布");expect(d.read).not.toHaveBeenCalled();
 d.list.mockResolvedValue([{name:prefix+"20261015T172000Z-aaaaaaaaaaaa.json",generation:"1"}] as never);d.read.mockResolvedValue({generation:"2"});await expect(readSongCraftCloudLibrary(d)).rejects.toThrow("版本读取冲突");
});
