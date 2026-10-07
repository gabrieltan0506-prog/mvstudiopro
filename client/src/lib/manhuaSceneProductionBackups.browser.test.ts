import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
it("scene backups retain full bytes across reload, immutable writes and account/project filtering", async () => {
 const built = await build({stdin:{contents:'import * as x from "./client/src/lib/manhuaSceneProductionBackups";window.backupStore=x;',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"iife",platform:"browser"});
 const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
 try {
  const page=await browser.newPage();await page.setRequestInterception(true);
  page.on("request",r=>void r.respond({status:200,contentType:"text/html",body:"<html></html>"}));
  await page.goto("http://scene-backup.test");await page.addScriptTag({content:built.outputFiles[0].text});
  const result=await page.evaluate(async()=>{
   const api=(window as any).backupStore;
   const key="manhua-advisor-rewrite-backup:1:scene-test";
   const json=JSON.stringify({createdAt:"2026-10-07T12:00:00.000Z",episodeIndex:2,changes:["scene"],writerPack:{seriesTitle:"剧A",episodes:[{index:2,body:"script"}]},projectBible:{confirmedAt:"v1"},restorableDraft:{full:"x".repeat(6*1024*1024)}});
   await api.saveSceneProductionBackup("1",key,json);
   let overwriteRejected=false;try{await api.saveSceneProductionBackup("1",key,"changed")}catch{overwriteRejected=true}
   const scope={userId:"1",confirmedProjectVersion:"v1",seriesTitle:"剧A",episodeIndex:2,body:"script"};
   const rows=await api.listSceneProductionBackups(scope);
   return {overwriteRejected,exact:rows[0]?.json===json,downloadOnly:rows[0]?.downloadOnly,wrongUser:(await api.listSceneProductionBackups({...scope,userId:"2"})).length,wrongProject:(await api.listSceneProductionBackups({...scope,confirmedProjectVersion:"v2"})).length};
  });
  expect(result).toEqual({overwriteRejected:true,exact:true,downloadOnly:true,wrongUser:0,wrongProject:0});
  await page.reload();await page.addScriptTag({content:built.outputFiles[0].text});
  expect(await page.evaluate(async()=>((window as any).backupStore.listSceneProductionBackups({userId:"1",confirmedProjectVersion:"v1",seriesTitle:"剧A",episodeIndex:2,body:"script"})).then((x:any[])=>x.length))).toBe(1);
  const projectA="11111111-1111-4111-8111-111111111111",projectB="22222222-2222-4222-8222-222222222222";
  await page.goto(`http://scene-backup.test/canvas?owner=1&project=${projectA}`);await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(async()=>{await (window as any).backupStore.saveSceneProductionBackup("1","manhua-advisor-rewrite-backup:1:project",JSON.stringify({createdAt:"2026-10-07T12:00:00.000Z",episodeIndex:2,changes:[],writerPack:{seriesTitle:"剧A",episodes:[{index:2,body:"script"}]},projectBible:{confirmedAt:"v1"}}));});
  await page.goto(`http://scene-backup.test/canvas?owner=1&project=${projectB}`);await page.addScriptTag({content:built.outputFiles[0].text});
  expect(await page.evaluate(async()=>((window as any).backupStore.listSceneProductionBackups({userId:"1",confirmedProjectVersion:"v1",seriesTitle:"剧A",episodeIndex:2,body:"script"})).then((x:any[])=>x.length))).toBe(0);
 }finally{await browser.close()}
},30000);
