import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { readFileSync } from "node:fs";
import { compile } from "tailwindcss";

let browser: Browser;
let bundle: string;
let stylesheet: string;
beforeAll(async () => {
 const result = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
   import React,{useState} from 'react';
   import {createRoot} from 'react-dom/client';
   import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
   import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
   import {emptyCanvasAudioStudio,createCanvasAudioCue,canvasAudioCueInputKey,canvasAudioMixSource,compileCanvasAudioBindings,assertCanvasAudioMasterCurrent} from './shared/canvasAudioStudio';
   const f=globalThis.fixture={calls:[],state:null};
   const dialogue={...createCanvasAudioCue('dialogue','line-ajing'),speakerZh:'阿菁',textZh:'门外是谁？',voice:'longanlufeng',shotZh:'门外反应',startSec:0,endSec:3,approved:true,selectedTakeId:'take-a'};
   dialogue.takes=[{id:'take-a',previewUrl:'https://audio.test/line.mp3',gcsUri:'gs://test/line.mp3',durationSec:2,createdAt:'2026-09-20',inputKey:canvasAudioCueInputKey(dialogue)}];
   const bgm={...createCanvasAudioCue('bgm','music-a'),shotZh:'进入门厅'};
   const sfx={...createCanvasAudioCue('sfx','door-a'),shotZh:'推门声'};
   for(const cue of [bgm,sfx]){cue.source={gcsUri:'gs://test/'+cue.id+'-source.mp3',previewUrl:'https://audio.test/'+cue.id+'-source.mp3',durationSec:10,labelZh:'已上传原音'};cue.sourceStartSec=0;cue.sourceEndSec=2;cue.approved=true;cue.selectedTakeId=cue.id+'-take-1';cue.takes=[1,2].map(index=>({id:cue.id+'-take-'+index,gcsUri:'gs://test/'+cue.id+'-'+index+'.mp3',previewUrl:'https://audio.test/'+cue.id+'-'+index+'.mp3',durationSec:2,createdAt:'2026-09-20',inputKey:canvasAudioCueInputKey(cue)}));}
   const oldMaster={gcsUri:'gs://test/master.wav',audioStudioSource:canvasAudioMixSource([bgm,dialogue,sfx],15)};
   f.compile=()=>{let masterError='';try{assertCanvasAudioMasterCurrent(oldMaster,f.state,15);}catch(e){masterError=e.message;}return {bindings:compileCanvasAudioBindings({studio:f.state,existingAudioUrls:[],durationSec:15}),masterError};};
   const services={generateDialogue:async input=>{f.calls.push(input);return {};},getDialogue:async()=>null,draftMusic:async input=>{f.calls.push(input);return {};},generateMusic:async input=>{f.calls.push(input);return {};},getMusic:async()=>null,listMusic:async()=>[],queuePost:async input=>{f.calls.push(input);return {};},getPost:async()=>null};
   function App(){const [timeline,setTimeline]=useState(undefined);const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'clip-e01-s01-layout',episodeIndex:1,videoModel:'seedance-2.5',prompt:'目标时长：15秒。阿菁推开门，门外传来脚步。',outputUrl:'https://video.test/current.mp4',manhuaSegmentRefs:{master:oldMaster},audioStudio:{...emptyCanvasAudioStudio(),cues:[bgm,dialogue,sfx]}});f.state=block.audioStudio;f.startSavedOnly=()=>setBlock(b=>({...b,audioStudio:undefined}));f.useSavedDialogue=(keepTakes)=>{const text="【第4段·24s】\\n同一电影级3D CG古代医馆外露天诊台。延续母女到达方向，以坐稳后的诊台状态开场；先生在工作侧、娘坐病人侧、阿菁守娘身旁、墨屠在通道侧，只出现四者。马的左眼眼罩、右肩新伤和左前腿卸重全程保持，不取血、不揭眼罩。\\n\\n[字幕：关闭，不烧台词、标记或旁白文字。]\\n\\n### 0—6.3秒\\n\\n清晨医馆外露天诊台，天空开放、同侧日光被树荫打散，木台反光轻补面部，氛围暂时安稳却有病情的担忧。先生在工作侧，娘坐病人侧长凳、手腕放诊桌，阿菁守在她身旁，墨屠在桌外通道；只出现这四者，曹三不在场。0—1.5秒以35.0mm f/4.0、水平FOV54.4°从先生工作侧肩后沿台侧横移，前景先生肩缘与桌缘构成薄框，中景娘与阿菁在同一侧，后景墨屠留桌外通道；桌面斜线引向娘的诊脉手，落到四者关系中景，不以门框把露天诊台改成室内；1.5—6.3秒切50.0mm f/2.8、水平FOV39.6°的同轴交流景别，在先生说出必须取灵兽精血的代价时短促真实推进，让诊桌前景扩大、先生的谨慎与娘的疲惫同时逼近，终点不把诊娘剪成诊马。视觉冲击由开放关系景收成贴近的代价说明，清晨柔光仍有来源，不靠变夜或闪灯。先生脸采用同侧树荫散射的侧光，阴影侧由木台反射轻补，形成细小面颊亮区而双眼可读；色调保木色与肤色，冷暖来自天光和反射，不因“代价”强行染青整场。先生诊脉后目光转向伤马，眉眼从诊断专注转为谨慎，完整告知：{对白/坐堂先生：0.0秒开口，“药只能压三天。要根治，得灵兽一点精血。”。使用本段已确认第1句原声，保持原词、原音色、原速，完整播放后闭口；只有坐堂先生对口型。}娘疲惫却清醒，望着先生；阿菁听到“只能压三天”眉间收紧、由期待转为焦虑；墨屠耳向先生转，左前腿卸重，右肩伤和左眼布眼罩保持。<极轻现场空气与衣料底声，诊脉手指只有实际接触轻响，低于人声。>(BGM：本段只用3-2已采用BGM候选1同一原曲，保持原采用版本、取段和25.0%音量，人声在前景；不换曲、不重新作曲，不另写音乐起止秒锁。)窗末病情和代价已说明，先生仍在给娘诊断，不能剪成给马诊脉。\\n\\n### 6.3—9.4秒\\n\\n娘目光先从先生转到墨屠右肩，再回先生，眉心轻皱、下唇短暂收紧，担忧针对马将付的代价，完整询问：{对白/娘：6.3秒开口，“要取多少墨屠的血？”。使用本段已确认第2句原声，保持原词、原音色、原速，完整播放后闭口；只有娘对口型。}声源和口型都属于娘；阿菁只闭口看娘与马，不能抢句。摄影机在诊台同侧以85.0mm f/2.8、水平FOV23.9°切娘近景，轻压近后停在她从马伤肩回到先生的眼神与开口，前景留先生肩缘或桌边作方位锚；焦点稳在娘眼睛与嘴，背景只降对比而不把阿菁与马删成空场。长焦压缩将“不忍取血”的忧虑压到脸上。娘留在右三分，左侧负空间指向马的伤肩视线；前景先生肩缘保持柔虚、娘双眼与嘴清楚，微弱木色反射不把忧虑照成喜悦。她从伤肩回先生的眼线匹配下窗先生回应，不加煽情转场。柔和天光、树荫和木台反射不变，氛围由看见治病希望转为不忍牺牲伤马的忧虑。先生听完保持稳定眼线，没有提前取血；娘仍坐着，马与阿菁位置连续。<娘轻微衣料与现场空气底声，不另加喘息或哭声。>音乐沿用本段同一原曲。窗末问题已问完，先生准备回应，陶碗尚只是诊台原道具。\\n\\n### 9.4—13.3秒\\n\\n先生眉间略松，指示粗陶碗表示用量，完整回应：{对白/坐堂先生：9.4秒开口，“取一碗就夠，放心，不會傷他性命的。”。使用本段已确认第3句原声，保持原词、原音色、原速，完整播放后闭口；只有坐堂先生对口型。}9.4—9.5秒以50.0mm f/4.0、水平FOV39.6°读先生回应；9.5—11.5秒一次短促真实推近到85.0mm f/4.0、水平FOV23.9°的手与粗陶碗细节，焦点从先生眼线落到碗沿，粗陶碗在下方三分交点，先生指示手从画缘指向碗沿；侧向天光只让碗沿一侧显细窄高光，碗内保持自然深色，粗糙陶纹与空碗深度突显“一碗”的代价；11.5—13.3秒明确切回35.0mm f/4.0、水平FOV54.4°的先生与娘关系，手势、碗和娘的眼线清楚，不连续乱切或移到马腹。原清晨天光与木台反射保持，碗不发光、不展示取血，氛围由血量的压力转为有限安心。娘听到“不伤性命”眼周略松、轻吐气，出现克制的希望；阿菁仍未完全放心，目光落在马的新伤，墨屠耳尖略前转关注说明。<只有先生指碗时实际衣袖摩擦，没有滴血、取血或碗落台声。>同一BGM延续。窗末量已说明，碗仍在原位置、没有血，阿菁的担忧接到下一窗。以阿菁从碗移向右肩新伤的视线接下一窗看伤，不把此空碗剪成已有血。\\n\\n### 13.3—17.3秒\\n\\n阿菁先看墨屠右肩伤，眉心收紧、眼周带心疼，完整说：{对白/阿菁：13.3秒开口，“可是……你肩上的傷還沒有好……”。使用本段已确认第4句原声，保持原词、原音色、原速，完整播放后闭口；只有阿菁对口型。}13.3—15.8秒她转身面向马，15.8—16.9秒抬手想拦，随后收手退半步，把担忧变为犹豫的退让；只演已确认的抬手、收手和退让，不新增顶手接触或强拉马头。墨屠沿桌外通道以左前腿卸重步态靠近，伤态不消失。13.3—15.8秒摄影机以65.0mm f/2.8、水平FOV31.0°拍阿菁看伤肩的心疼眼神；15.8—17.3秒明确切到24.0mm f/5.6、水平FOV73.7°，沿诊台同侧真实后撤展开四者关系，给马留实际靠近通道，手的犹豫退让与马接近同时可读。由压缩的脸到广角空间展开形成情绪推拉，娘长凳、先生和桌缘持续可追，不把放宽写成无目的飘镜。阿菁的手与马右肩留在画面中段，退让后空出的通道形成引导线，墨屠从后层进入中层；天光侧向照出伤肩和手的距离，收手前后位置可核，不用高反差影子隐藏未接触。柔和天光不变夜色，氛围收紧在“伤未好却要取血”的心疼；娘望向马，先生停手留出回应空间。<跛行蹄声跟实际落脚，阿菁抬手和收手只带细小衣料声，没有顶手撞击声。>同一BGM保持在对白之后。窗末原句完整结束，阿菁已经收手退让，马仍完成最后靠近步，不用切镜把它直接瞬移到桌边。\\n\\n### 17.3—24秒\\n\\n墨屠承接最后靠近步，17.5秒在台边站定，把右肩靠近诊台但不压桌，右眼先看病母再看先生，耳略前转，以同一匹马的口鼻、耳颈与呼吸配合原声，完整说：{对白/墨屠：17.3秒开口，“草藥只能撐三天，太短了，取點血沒事的，我撐得住。”。使用本段已确认第5句原声，保持原词、原音色、原速，完整播放后闭口；只有墨屠对口型。}原声在23.6秒前完整结束，不能换成人嘴、截尾或重说。17.3—21.5秒摄影机用50.0mm f/4.0、水平FOV39.6°在马前侧真实短推，右眼、口鼻与右肩伤同时清楚，伤马在前景承担画面重量，后侧母女和先生仍有空间层次；右眼、口鼻与伤肩沿斜线排开，清晨柔侧光在右眼留一个稳定反光，眼罩所在左眼保持不露；墨屠看娘再看先生的视线带着观众读它作出的决定，嘴部仍清楚可对原声。21.5—23.6秒真实拉回到35.0mm f/5.6、水平FOV54.4°的四者关系，让“我撑得住”落在所有听者反应里，不删人、不穿马身；23.6—24秒同轴切85.0mm f/4.0、水平FOV23.9°的伤肩与空碗关系细节，先在细節景的旁侧保留娘衣袖或桌缘方位锚，结尾收住在尚未取血的代价，不能把0.4秒挤成大环绕。马因疼痛鼻孔略张、颈肩短绷后稳住，态度从忍痛转为救娘的决意；阿菁听到“我撑得住”目光柔下来、紧唇后轻吐气，娘眼周稍松、嘴角只有微小回暖，先生谨慎看伤肩。清晨柔光与木台反射不变，氛围从担忧转为主动承担和母女心疼。<站定后只留极低现场底声，原声里的呼吸原样保留，不添马叫或旁白。>原声完整结束后闭口，摄影机按本窗末尾的85.0mm同轴细节安排把焦点落向伤肩与粗陶碗的关系，碗轻触木台一次后静住，动作在本窗余下尾部结束。<粗陶碗接触木台时只有一声轻“咯”，之后不追加撞击、抽血或滴血声。>音乐仍只用本段同一原曲，不另加音乐秒锁。末尾细节镜未入画的娘仍坐长凳、阿菁仍在旁侧、先生仍在工作侧，四者位置不变且可由桌缘方位锚追溯，最后碗沿侧光和伤肩毛发的同向高光并置，空碗仍为空；直接切到此细节承接先生落碗动作，不跳到抽血或黑场。马耳与呼吸保持低强度活态，情绪留在愿意付出但尚未取血，不黑场截断、不揭眼罩、不添台词。\\n\\n【资产·Image对照】\\n@角色1|id=cust_mtn5ko0y_01qwd|label=OIP-1059850588·编辑·编辑|kind=角色|duty=identity\\n@角色2|id=cust_mu3cdav2_xshp2|label=坐堂先生|kind=角色|duty=look\\n@角色3|id=cust_mu3cnj74_qpe4b|label=阿菁-A脸底为主·编辑|kind=角色|duty=identity\\n@角色5|id=cust_mu3cyr8i_6y12m|label=娘·编辑|kind=角色|duty=identity\\n@场景4|id=cust_mu3i293d_v9dhb|label=临水坊市|kind=场景\\n@道具2|id=cust_mu3cbi0l_25xx3|label=眼罩|kind=道具\\n【出片Image硬绑】\\nOIP-1059850588·编辑·编辑@图片1 id=cust_mtn5ko0y_01qwd；坐堂先生@图片2 id=cust_mu3cdav2_xshp2；阿菁-A脸底为主·编辑@图片3 id=cust_mu3cnj74_qpe4b；娘·编辑@图片4 id=cust_mu3cyr8i_6y12m；临水坊市@图片5 id=cust_mu3i293d_v9dhb；眼罩@图片6 id=cust_mu3cbi0l_25xx3；@图片7锁定0–6.3s的画面构图、机位与光色；@图片8锁定6.3–17.3s的画面构图、机位与光色；@图片9锁定17.3–24s的画面构图、机位与光色。全程保持各主体脸、服、场与上表一致，只按秒轴改动作/口型/运镜。\\n【连续】承上段末帧脸服场，勿跳棚。";setBlock(b=>({...b,prompt:text,manhuaPromptEdit:{text,sourceRevision:"test"},audioStudio:{...b.audioStudio,cues:b.audioStudio.cues.map(c=>c.kind!=="dialogue"||keepTakes?c:{...c,takes:[],approved:false,selectedTakeId:undefined})}}));};f.useSavedDuration=()=>{setTimeline(23);setBlock(b=>({...b,prompt:'【第4段·24s】原声完整保留。'}));};return <CanvasAudioStudioView block={block} timelineDurationSec={timeline} services={services} onChange={audioStudio=>setBlock(b=>({...b,audioStudio}))}/>;}
   createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
  alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},
  plugins:[{name:"离线请求边界",setup(builder){builder.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"offline-trpc",namespace:"offline"}));builder.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:"export const trpc = {};",loader:"js"}));}}],
  define:{"process.env.NODE_ENV":'"test"',"import.meta.env":"{}"},
 });
 bundle=result.outputFiles[0]!.text;
 const layoutSources = ["client/src/components/canvas/CanvasAudioStudio.tsx", "client/src/components/canvas/CanvasAudioMixControls.tsx"].map(file => readFileSync(file, "utf8")).join("\n");
 const candidates = Array.from(layoutSources.matchAll(/"([^"\n]*)"/g)).flatMap(match => match[1].split(/\s+/));
 const compiler = await compile(readFileSync("node_modules/tailwindcss/theme.css", "utf8") + "\n" + readFileSync("node_modules/tailwindcss/preflight.css", "utf8") + "\n@tailwind utilities;");
 stylesheet = compiler.build(candidates);

 browser=await puppeteer.launch({headless:true, ...(process.getuid?.() === 0 ? { args: ["--no-sandbox"] } : {})});
},180_000);
afterAll(async()=>{await browser?.close();});

it("配音与背景音乐界面不展示模型名称且查看设置不会生成", async () => {
 const context = await browser.createBrowserContext();
 const page = await context.newPage();
 try {
  await page.setRequestInterception(true);
  page.on("request", request => request.isNavigationRequest() ? void request.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}) : void request.abort());
  await page.goto("http://localhost:41812/");
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[data-manhua-audio-editor]');
  expect(await page.$eval('body', el => el.textContent)).toContain("配音与背景音乐");
  expect(await page.$eval('body', el => el.textContent)).not.toMatch(/TTS|Suno|Qwen|TTAPI|Seedance|Mureka|WaveSpeed|EvoLink/i);
  expect(await page.$('[aria-label="配乐来源"]')).toBeNull();
  expect(await page.$$eval('[aria-label="配乐方式"] option', options => options.map(option => [(option as HTMLOptionElement).value, option.textContent]))).toEqual([
    ["suno-v6", "标准配乐"], ["suno-v6-wild", "探索配乐（实验）"], ["suno-v6-mini", "快速配乐"],
  ]);
  await page.click('[aria-label="声音制作快捷入口"] button:nth-child(2)');
  expect(await page.$eval('[data-audio-group="bgm"]', el => el.getBoundingClientRect().top)).toBeLessThan(100);
  expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
  await page.click('[aria-label="生成第2句配音"]');
  await page.waitForSelector('[aria-label="确认音频费用"]');
  expect(await page.$eval('[aria-label="确认音频费用"]', el => el.textContent)).toContain("阿菁：门外是谁？");
  expect(await page.$eval('[aria-label="确认音频费用"]', el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(601);
  expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
 } finally { await context.close(); }
}, 20_000);

it("真实声音面板按种类分组、采用状态随原handler变化，不更换cue身份或额外付费",async()=>{
 const context=await browser.createBrowserContext();const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(String(e)));
 try {
  await page.setRequestInterception(true);
  page.on("request",request=>{if(request.isNavigationRequest())void request.respond({status:200,contentType:"text/html",body:'<html><link rel="icon" href="data:,"><div id="root"></div></html>'});else void request.abort();});
  await page.goto("http://localhost:41812");await page.addStyleTag({content:stylesheet});await page.addScriptTag({content:bundle});await page.waitForSelector('[data-audio-group="dialogue"] [data-cue-id="line-ajing"]');
  expect(await page.$eval('video[aria-label="当前片段画面"]',el=>el.getAttribute("src"))).toBe("https://video.test/current.mp4");
  expect(await page.$$eval('[data-audio-group]',els=>els.map(el=>[el.getAttribute("data-audio-group"),Array.from(el.querySelectorAll('[data-cue-id]')).map(row=>row.getAttribute("data-cue-id"))]))).toEqual([["dialogue",["line-ajing"]],["bgm",["music-a"]],["sfx",["door-a"]]]);
  expect(await page.$eval('[aria-label="角色配音摘要"]',el=>el.textContent)).toContain("已采用 1 句");
  expect(await page.$eval('[data-cue-id="line-ajing"]',el=>el.textContent)).toContain("已采用");
  expect(await page.$eval('[data-audio-group="bgm"]',el=>el.textContent)).toContain("生成配乐原曲");
  await page.$eval('[aria-label="2 对白试听音量"]', el => { const input = el as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0.42'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => (window as any).fixture.state.cues[1].volume === 0.42);
  expect(await page.$eval('[aria-label="2 候选 1"]', el => (el as HTMLAudioElement).volume)).toBeCloseTo(0.42);
  expect(await page.evaluate(() => (window as any).fixture.state.cues[1].approved)).toBe(true);
  await page.$eval('[aria-label="1 配乐试听音量"]', el => { const input = el as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0.18'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => (window as any).fixture.state.cues[0].volume === 0.18);
  expect(await page.$eval('[aria-label="1 候选 1"]', el => (el as HTMLAudioElement).volume)).toBeCloseTo(0.18);
  expect((await page.evaluate(() => (window as any).fixture.compile())).masterError).toContain('旧版');
  const originalDialogue = await page.evaluate(() => (window as any).fixture.state.cues[1]);
  await page.click('[aria-label="1 镜头与动作"]', { clickCount: 3 });
  await page.type('[aria-label="1 镜头与动作"]', "门厅停步后配乐进入");
  await page.$$eval('[data-cue-id="music-a"] button', elements => { const buttons = elements.filter(element => element.textContent?.includes("试听后确认本段")); (buttons[1] as HTMLButtonElement).click(); });
  await page.click('[aria-label="3 片内开始秒"]', { clickCount: 3 });
  await page.type('[aria-label="3 片内开始秒"]', "3");
  await page.$$eval('[data-cue-id="door-a"] button', elements => { const button = elements.find(element => element.textContent?.includes("试听后确认本段")); (button as HTMLButtonElement).click(); });
  await page.waitForFunction(() => (window as any).fixture.state.cues[2].approved);
  expect(await page.evaluate(() => (window as any).fixture.state.cues[1])).toEqual(originalDialogue);
  const consumed = await page.evaluate(() => (window as any).fixture.compile());
  expect(consumed.bindings.audioUrls).toContain("gs://test/music-a-2.mp3");
  expect(consumed.bindings.audioUrls).toContain("gs://test/door-a-1.mp3");
  expect(consumed.bindings.promptAppendix).toContain("门厅停步后配乐进入");
  expect(consumed.bindings.promptAppendix).toContain("3.000秒触发");
  expect(consumed.bindings.promptAppendix).toContain("阿菁");
  expect(consumed.masterError).toContain("预混母轨仍为旧版");
  expect(await page.$eval('[aria-label="逐句配音、配乐与事件音效"]', el => el.textContent)).toContain("当前母轨与声音配置不一致");
  for (const width of [1280, 390]) {
   await page.setViewport({ width, height: 900 });
   const geometry = await page.$eval('[data-manhua-sound-summary]', el => ({ columns: getComputedStyle(el).gridTemplateColumns.split(" ").length, viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
   expect(geometry.columns).toBe(width >= 1024 ? 3 : 1);
   expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
   await page.screenshot({ path: `/tmp/0920-audio-layout-${width}.png`, fullPage: true });
  }
  await page.click('[aria-label="2 说话角色"]',{clickCount:3});await page.type('[aria-label="2 说话角色"]',"墨屠");
  await page.waitForFunction(()=>document.querySelector('[aria-label="角色配音摘要"]')?.textContent?.includes("已采用 0 句"));
  expect(await page.evaluate(()=>(window as any).fixture.state.cues.map((cue:any)=>[cue.id,cue.speakerZh]))).toContainEqual(["line-ajing","墨屠"]);
  await page.$eval('[data-audio-group="sfx"] header button',el=>(el as HTMLButtonElement).click());
  await page.waitForFunction(()=>(window as any).fixture.state.cues.length===4);
  expect(await page.evaluate(()=>(window as any).fixture.state.cues[3].kind)).toBe("sfx");
  expect(await page.$$('[data-audio-group="sfx"] [data-cue-id]')).toHaveLength(2);
  expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);
  expect(errors).toEqual([]);
 }finally{await context.close();}
},60_000);


it("保存全文24秒优先于旧23秒规划，保留既有音轨且不发生成请求", async () => {
 const context = await browser.createBrowserContext();
 const page = await context.newPage();
 try {
  await page.setRequestInterception(true);
  page.on("request", request => request.isNavigationRequest() ? void request.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}) : void request.abort());
  await page.goto("http://localhost:41812/");
  await page.addScriptTag({content:bundle});
  await page.waitForSelector('[data-audio-duration-audit]');
  const before = await page.evaluate(() => JSON.stringify((window as any).fixture.state));
  await page.evaluate(() => (window as any).fixture.useSavedDuration());
  await page.waitForFunction(() => document.querySelector('[data-audio-duration-audit]')?.textContent?.includes('本段 24.00 秒'));
  expect(await page.evaluate(() => JSON.stringify((window as any).fixture.state))).toBe(before);
  expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
  expect(await page.$eval('body', el => el.textContent)).toContain('母轨与声音配置不一致');
 } finally { await context.close(); }
},60_000);


it("保存全文同步实际修正娘身份及原词，但拒绝覆盖已有原声，音乐与任务不变", async () => {
 const context=await browser.createBrowserContext();const page=await context.newPage();
 try {
  await page.setRequestInterception(true);
  page.on("request",request=>request.isNavigationRequest()?void request.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}):void request.abort());
  await page.goto("http://localhost:41812/");await page.addScriptTag({content:bundle});
  await page.waitForSelector('[data-audio-duration-audit]');
  await page.evaluate(()=>(window as any).fixture.useSavedDialogue(true));
  await page.waitForSelector('[aria-label="保存全文与音轨对白核对"]');
  const original=await page.evaluate(()=>JSON.stringify((window as any).fixture.state));
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='按保存全文更新未生成对白草稿')!.click());
  await page.waitForFunction(()=>document.body.textContent?.includes('不能覆盖'));
  expect(await page.evaluate(()=>JSON.stringify((window as any).fixture.state))).toBe(original);
  await page.evaluate(()=>(window as any).fixture.useSavedDialogue(false));
  await page.waitForFunction(()=>!(window as any).fixture.state.cues.find((c:any)=>c.kind==='dialogue').takes.length);
  const musicBefore=await page.evaluate(()=>JSON.stringify((window as any).fixture.state.cues.filter((c:any)=>c.kind!=='dialogue')));
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='按保存全文更新未生成对白草稿')!.click());
  await page.waitForFunction(()=>(window as any).fixture.state.cues.filter((c:any)=>c.kind==='dialogue').length===5);
  expect(await page.evaluate(()=>(window as any).fixture.state.cues.filter((c:any)=>c.kind==='dialogue').map((c:any)=>[c.speakerZh,c.textZh]))).toContainEqual(['娘','要取多少墨屠的血？']);
  expect(await page.evaluate(()=>JSON.stringify((window as any).fixture.state.cues.filter((c:any)=>c.kind!=='dialogue')))).toBe(musicBefore);
  expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);
  await page.evaluate(()=>(window as any).fixture.startSavedOnly());
  await page.waitForFunction(()=>(window as any).fixture.state?.cues.filter((c:any)=>c.kind==='dialogue').length===5);
  expect(await page.evaluate(()=>(window as any).fixture.state.cues[1].speakerZh)).toBe('娘');
  expect(await page.evaluate(()=>(window as any).fixture.state.cues[1].textZh)).toBe('要取多少墨屠的血？');
  expect(await page.evaluate(()=>(window as any).fixture.state.cues.every((c:any)=>!c.approved&&!c.takes.length))).toBe(true);
  expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);
 }finally{await context.close();}
},60_000);
