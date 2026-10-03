import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import JSZip from "jszip";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("EPUB imports original spine order and named stories, persists exact selection; missing chapters fail without replacing draft", async () => {
 const temp = await mkdtemp(join(tmpdir(),'novel-epub-'));
 const zip = new JSZip();
 zip.file('META-INF/container.xml','<container><rootfile full-path="book/content.opf"/></container>');
 zip.file('book/content.opf','<package><dc:title>故事集</dc:title><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>');
 const prose='保留完整叙述、对白和因果，不做知识点摘要。'.repeat(10);
 zip.file('book/a.xhtml',`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>女娲补天</h1><p>${prose}</p><img src="https://example.invalid/no-request.png" alt="图注"/></body></html>`);
 zip.file('book/b.xhtml',`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>盘古分天地</h1><p>${prose}</p><script>window.bad=true</script></body></html>`);
 const good=join(temp,'good.epub'), bad=join(temp,'missing.epub');
 await writeFile(good, await zip.generateAsync({type:'nodebuffer'}));zip.remove('book/a.xhtml');await writeFile(bad, await zip.generateAsync({type:'nodebuffer'}));
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React,{useState} from 'react'; import{createRoot}from'react-dom/client'; import{ManhuaNovelSourcePanel}from'./client/src/components/canvas/ManhuaNovelSourcePanel'; import{prepareNovelExcerpt,parseNovelDraft}from'./shared/manhuaNovelSource'; function App(){const[v,s]=useState(null);window.fixture={draft:v,restored:parseNovelDraft(JSON.parse(JSON.stringify(v))),excerpt:v?prepareNovelExcerpt(v):null};return <ManhuaNovelSourcePanel value={v} onChange={s}/>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:'tsconfig.json',define:{'process.env.NODE_ENV':'"test"'}});
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:built.outputFiles[0].text});await page.click('summary');
  await (await page.$('input[type="file"]'))!.uploadFile(good);
  await page.waitForFunction(()=> (window as any).fixture.draft?.chapters?.length===2);
  await page.select('[aria-label="小说起始章节"]','1');await page.click('input[type="checkbox"]');
  const state=await page.evaluate(()=>(window as any).fixture);
  expect(state.draft.chapters.map((c:any)=>c.title)).toEqual(['盘古分天地','女娲补天']);expect(state.restored).toEqual(state.draft);
  expect(state.excerpt.text).toContain('女娲补天');expect(state.excerpt.text).not.toContain('盘古');expect(state.excerpt.text).toContain(prose);
  expect(await page.evaluate(()=>(window as any).bad)).toBeUndefined();expect(requests).toEqual([]);
  await (await page.$('input[type="file"]'))!.uploadFile(bad);await page.waitForSelector('[role="alert"]');expect(await page.evaluate(()=>(window as any).fixture.draft)).toEqual(state.draft);
  if(process.env.NOVEL_EPUB_ACCEPTANCE_FILE){
   await (await page.$('input[type="file"]'))!.uploadFile(process.env.NOVEL_EPUB_ACCEPTANCE_FILE);
   await page.waitForFunction(()=> (window as any).fixture.draft?.chapters?.length===79,{timeout:30000});
   const book=await page.evaluate(()=>{const d=(window as any).fixture.draft;return {name:d.name,characters:d.text.length,chapters:d.chapters,restored:(window as any).fixture.restored ? {textMatches:d.text===(window as any).fixture.restored.text, chapters:(window as any).fixture.restored.chapters} : null,notice:document.querySelector('[data-manhua-novel-source]')!.textContent!.match(/已按书内阅读顺序导入[^。]+。[^。]*。/g)}});
   expect(book.restored?.textMatches).toBe(true);expect(book.restored?.chapters).toEqual(book.chapters);expect(book.chapters.some((c:any)=>c.title.includes('女娲补天'))).toBe(true);
   await page.select('[aria-label="小说起始章节"]', '14');
   await page.click('input[type="checkbox"]');
   const excerpt=await page.evaluate(()=>(window as any).fixture.excerpt);
   expect(excerpt.text).toContain('女娲补天');expect(excerpt.text).not.toContain('共工头触不周山');
   await writeFile(process.env.NOVEL_EPUB_ACCEPTANCE_REPORT!,JSON.stringify({...book,selected:{label:excerpt.label,characters:excerpt.text.length}},null,2));
  }
 } finally {await browser.close();await rm(temp,{recursive:true,force:true});}
},60000);
