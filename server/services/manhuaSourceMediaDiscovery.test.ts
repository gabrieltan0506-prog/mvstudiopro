import { EventEmitter } from "node:events";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverSourceMedia, parseDiscoveredMediaUrl, verifyDiscoveredMediaUrl } from "./manhuaSourceMediaDiscovery";
import { isTrustedManhua0996MediaUrl, parseManhua0996PlaybackResponse } from "../../shared/manhuaLearn0996Source";
vi.mock("node:dns/promises",()=>({lookup:vi.fn()}));
beforeEach(()=>vi.mocked(lookup).mockResolvedValue([{address:"8.8.8.8",family:4}] as never));
afterEach(()=>vi.restoreAllMocks());
const referer="https://0996zp.com/";
const payload=()=>({code:200,data:{list:[1080,720,480].map(resolution=>({resolution,flag:resolution===480,needLogin:resolution!==480,url:`https://new-cdn.example/${resolution}.m3u8`}))}});
describe("authenticated response-scoped CDN discovery",()=>{
 it("discovers future media hosts without changing anonymous/global trust or 720 preference",async()=>{
  const raw=payload(), before=JSON.stringify(raw),verify=vi.fn(async(url:string)=>url);
  const found=await discoverSourceMedia(raw,{authenticated:true,referer,verify});
  expect(verify).toHaveBeenCalledTimes(3);
  expect(parseManhua0996PlaybackResponse(found.payload,referer,true,found.verifiedHosts).playbackUrls).toEqual([720,1080,480].map(n=>`https://new-cdn.example/${n}.m3u8`));
  expect(isTrustedManhua0996MediaUrl(raw.data.list[0].url)).toBe(false);
  expect(JSON.stringify(raw)).toBe(before);
  const anon=await discoverSourceMedia(raw,{authenticated:false,referer,verify});
  expect(anon.verifiedHosts).toEqual([]);expect(verify).toHaveBeenCalledTimes(3);
  await expect(discoverSourceMedia({...raw,code:403},{authenticated:true,referer,verify})).resolves.toMatchObject({verifiedHosts:[]});
 });
 it.each(["http://cdn.example/a","https://127.0.0.1/a","https://[::1]/a","https://cdn.example:443/a","https://u:p@cdn.example/a","file:///tmp/a"])("rejects unsafe media syntax %s",url=>expect(()=>parseDiscoveredMediaUrl(url)).toThrow());
 it("follows a checked final URL without mutating source evidence",async()=>{
  const raw=payload();const found=await discoverSourceMedia(raw,{authenticated:true,referer,verify:async(url)=>url.replace("new-cdn.example","final-cdn.example")});
  expect(found.verifiedHosts).toEqual(["final-cdn.example"]);
  expect(parseManhua0996PlaybackResponse(found.payload,referer,true,found.verifiedHosts).playbackUrl).toBe("https://final-cdn.example/720.m3u8");
  expect(raw.data.list[0].url).toContain("new-cdn.example");
 });
 it("known media avoids a new preflight; failed discovery never silently drops evidence",async()=>{
  const verify=vi.fn(async()=>{throw new Error("blocked")});const raw=payload();
  raw.data.list=raw.data.list.map(r=>({...r,url:r.url.replace("new-cdn.example","ppvod01.kqgfbs.com")}));
  await expect(discoverSourceMedia(raw,{authenticated:true,referer,verify})).resolves.toMatchObject({verifiedHosts:[]});expect(verify).not.toHaveBeenCalled();
  await expect(discoverSourceMedia(payload(),{authenticated:true,referer,verify})).rejects.toThrow("blocked");
 });
 it("pins verified DNS and sends no source cookies, authorization or signature",async()=>{
  const request=vi.spyOn(https,"request").mockImplementation(((url:URL,options:any,callback:any)=>{
   expect(url.hostname).toBe("new-cdn.example");expect(options.method).toBe("HEAD");
   expect(Object.keys(options.headers).sort()).toEqual(["referer","user-agent"]);
   const done=vi.fn();options.lookup(url.hostname,{},done);expect(done).toHaveBeenCalledWith(null,"8.8.8.8",4);
   const req=new EventEmitter() as EventEmitter&{end():void};req.end=()=>callback({statusCode:200,headers:{},destroy:vi.fn()});return req;
  }) as never);
  await expect(verifyDiscoveredMediaUrl("https://new-cdn.example/a",referer)).resolves.toBe("https://new-cdn.example/a");expect(request).toHaveBeenCalledTimes(1);
 });
 it("rejects private redirect before contacting it",async()=>{
  vi.mocked(lookup).mockResolvedValueOnce([{address:"8.8.8.8",family:4}] as never).mockResolvedValueOnce([{address:"::ffff:7f00:1",family:6}] as never);
  const request=vi.spyOn(https,"request").mockImplementation(((_url:any,_options:any,callback:any)=>{
   const req=new EventEmitter() as EventEmitter&{end():void};req.end=()=>callback({statusCode:307,headers:{location:"https://private.example/a"},destroy:vi.fn()});return req;
  }) as never);
  await expect(verifyDiscoveredMediaUrl("https://new-cdn.example/a",referer)).rejects.toThrow("非公网");expect(request).toHaveBeenCalledTimes(1);
 });
 it("honors cancellation before DNS or request",async()=>{
  const controller=new AbortController();controller.abort(new Error("cancelled"));
  const count=vi.mocked(lookup).mock.calls.length;
  await expect(verifyDiscoveredMediaUrl("https://new-cdn.example/a",referer,controller.signal)).rejects.toThrow("cancelled");expect(lookup).toHaveBeenCalledTimes(count);
 });
 it.each([403,405])("HEAD %i leaves playback checks to the native candidate loop",async(status)=>{
  vi.spyOn(https,"request").mockImplementation(((_url:any,_options:any,callback:any)=>{
   const req=new EventEmitter() as EventEmitter&{end():void};req.end=()=>callback({statusCode:status,headers:{},destroy:vi.fn()});return req;
  }) as never);
  await expect(verifyDiscoveredMediaUrl("https://new-cdn.example/a",referer)).resolves.toBe("https://new-cdn.example/a");
 });
});
