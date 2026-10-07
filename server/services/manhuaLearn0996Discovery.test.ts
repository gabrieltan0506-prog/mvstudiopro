import { afterEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({checks:vi.fn(async(url:string)=>url)}));
vi.mock("node:dns/promises",()=>({lookup:vi.fn(async()=>[{address:"8.8.8.8",family:4}])}));
vi.mock("./manhuaSourceMediaDiscovery.js",async(importOriginal)=>{
 const actual=await importOriginal<typeof import("./manhuaSourceMediaDiscovery")>();
 return {...actual,discoverSourceMedia:(payload:unknown,input:Parameters<typeof actual.discoverSourceMedia>[1])=>actual.discoverSourceMedia(payload,{...input,verify:state.checks})};
});
import {fetchManhua0996EpisodePlayback,MANHUA_MIRROR_SOURCE_COOKIE_ENV,MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV} from "./manhuaLearn0996Source";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
const source="https://0996zp.com/vod/play/119048/1/961125";
it("native API auto-discovers media only with both source credentials",async()=>{
 vi.stubEnv(MANHUA_MIRROR_SOURCE_COOKIE_ENV,"session=offline-cookie");vi.stubEnv(MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV,"Bearer offline-token");
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  expect(new Headers(init?.headers).get("cookie")).toBe("session=offline-cookie");expect(new Headers(init?.headers).get("authorization")).toBe("Bearer offline-token");
  return new Response(JSON.stringify({code:200,data:{list:[{resolution:720,needLogin:true,flag:false,url:"https://future-cdn.example/movie.m3u8"}]}}),{headers:{"content-type":"application/json"}});
 }) as typeof fetch;
 await expect(fetchManhua0996EpisodePlayback(source,undefined,fetcher)).resolves.toMatchObject({playbackUrl:"https://future-cdn.example/movie.m3u8",referer:"https://0996zp.com/"});
 expect(state.checks).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
});
it("a single credential never authorizes automatic new domains",async()=>{
 vi.stubEnv(MANHUA_MIRROR_SOURCE_COOKIE_ENV,"session=offline-cookie");vi.stubEnv(MANHUA_MIRROR_SOURCE_AUTHORIZATION_ENV,"");
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:200,data:{list:[{resolution:720,needLogin:true,flag:false,url:"https://future-cdn.example/movie.m3u8"}]}}),{headers:{"content-type":"application/json"}})) as typeof fetch;
 await expect(fetchManhua0996EpisodePlayback(source,undefined,fetcher)).rejects.toThrow("没有可信媒体档");expect(state.checks).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
});
