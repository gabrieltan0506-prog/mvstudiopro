import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { canWavespeedUpscale } from "@shared/wavespeedVideoUpscaleModels";
import { canvasVideoUpscaleCredits } from "@shared/canvasGenerationPricing";
import { canUpscaleNow } from "./manhuaDeliveryOrder";

function production(file:string){
 const source=readFileSync(new URL(`../components/canvas/${file}.tsx`,import.meta.url),"utf8");
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const expressions=new Map<string,string>();let targets="";
 function walk(n:ts.Node){
  if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer){const initial=n.initializer;expressions.set(n.name.text,ts.isCallExpression(initial)&&initial.expression.getText(tree)==="useCallback"?initial.arguments[0].getText(tree):initial.getText(tree));}
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==="map"&&n.expression.expression.getText(tree).includes("canWavespeedUpscale"))targets=n.getText(tree);
  ts.forEachChild(n,walk);
 }walk(tree);
 const evaluate=(source:string,context:Record<string,unknown>)=>runInNewContext(ts.transpileModule(`(${source})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{React,canWavespeedUpscale,canvasVideoUpscaleCredits,canUpscaleNow,...context});
 return {run:(name:string,context:Record<string,unknown>)=>evaluate(expressions.get(name)!,context),buttons:(context:Record<string,unknown>)=>renderToStaticMarkup(React.createElement(React.Fragment,null,evaluate(targets,context)))};
}
const free=production("FreeformCanvas"),post=production("PostProdWorkshopCard");
const url="https://video.test/original.mp4";
function fixture(resolution="480p"){
 const measured={sourceUrl:url,width:resolution==="480p"?854:1280,height:resolution==="480p"?480:720,durationSec:12,sourceResolution:resolution};
 const block={id:"clip-e01-g01",outputUrl:url,episodeIndex:1,videoResolution:"720p"};
 const start=vi.fn(async()=>({taskId:"test-task",status:"queued",creditsUsed:10}));
 return {measured,block,start,context:{blocks:[block],block,upscaleBusyId:null,upscaleSubmitBusy:false,upscaleProbedSources:{[url]:measured},upscaleSource:measured,upscaleProbedSource:measured,upscaleVideoUrl:url,upscaleProbedSec:12,jobs:[],clipOptions:[],startVideoUpscale:start,toast:{error:vi.fn(),success:vi.fn()},patchOne:vi.fn(),setUpscaleBusyId:vi.fn(),setUpscalePanelBlockId:vi.fn(),setUpscaleSubmitBusy:vi.fn(),setUpscaleJobs:vi.fn(),window:{confirm:vi.fn(()=>true)},measured,sec:12,freeform:false,startUpscaleForBlock:vi.fn(),submitUpscale:vi.fn()}};
}
it.each(["480p","720p"])("两真实UI按钮表达式按实测%s开放目标，不读默认720p",resolution=>{
 const f=fixture(resolution);
 for(const source of [free,post]){const html=source.buttons(f.context);expect(html).toContain("2K");expect(html.includes("4K")).toBe(resolution==="720p");}
});
it.each(["480p","720p"])("两真实提交回调实测%s门禁，保留原片并传真实分档",async resolution=>{
 for(const source of [free,post]){
  const f=fixture(resolution);const fn=source.run(source===free?"startUpscaleForBlock":"submitUpscale",f.context);
  if(source===free)await fn(f.block.id,"4k");else await fn("4k");
  expect(f.start).toHaveBeenCalledTimes(resolution==="720p"?1:0);
  if(resolution==="480p"){if(source===free)await fn(f.block.id,"2k");else await fn("2k");}
  expect(f.start).toHaveBeenLastCalledWith(expect.objectContaining({videoUrl:url,sourceResolution:resolution,durationSec:12,target:resolution==="480p"?"2k":"4k"}));
  expect(f.block.outputUrl).toBe(url);if(source===free)expect(f.context.patchOne.mock.calls[0][1]).not.toHaveProperty("outputUrl");
 }
});
it("换原片后拒用旧尺寸和旧报价，后期迟到探测也不能解锁新片",async()=>{
 const f=fixture();const next="https://video.test/new.mp4";f.block.outputUrl=next;
 await free.run("startUpscaleForBlock",f.context)(f.block.id,"2k");expect(f.start).not.toHaveBeenCalled();
 const context={...f.context,upscaleVideoUrl:next};const source=post.run("upscaleSource",context);expect(source).toBeNull();
 const sec=post.run("upscaleProbedSec",{...context,upscaleSource:source});expect(sec).toBeNull();
 await post.run("submitUpscale",{...context,upscaleSource:source,upscaleProbedSec:sec})("2k");expect(f.start).not.toHaveBeenCalled();
});
