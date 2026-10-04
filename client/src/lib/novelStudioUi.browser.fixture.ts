import { build } from "esbuild";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { novelMockTransport } from "./novelWorkspace.browser.fixture";

export async function buildNovelStudioUiPreview() {
  const artifactDir = "../backend-work/novel-ui-1004";
  mkdirSync(artifactDir, { recursive: true });
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{NovelAdaptationWorkspace}from'./client/src/pages/NovelAdaptation';import{emptyNovelWorkspace}from'./client/src/lib/novelWorkspace';import{batchNovel}from'./client/src/lib/novelSeries';
      if(!localStorage.getItem('seeded')){
        const d=emptyNovelWorkspace();d.mode='original';d.topic='长安密卷';d.direction='文书库小吏卷入权谋，借历史知识求生。';d.targetEpisodeCount=80;d.season=1;
        d.templates=[{publicId:'mt_0000',role:'空间与信息揭露',weight:50},{publicId:'mt_0001',role:'危险感与光线',weight:30},{publicId:'mt_0002',role:'表演与情绪缓冲',weight:20}];
        d.outline='前三集：密件出现、交易筹码、政变求生。';d.outlineApproved=d.outline;
        const text='暮色压下长安，雨意未停，青石路面泛着冷光。狭窄的巷子里，屋檐滴水，将两人的影子切成不完整的碎块。\\n\\n沈昀先到。他站在一扇半掩的木门前，背对着巷口，听见脚步声才微微侧身。烛光从门缝里泄出，暖黄的光线落在他肩侧，一半温暖，一半仍是冷巷的青灰。\\n\\n裴昭停在三步外，衣摆还沾着夜雨。\\n\\n“你来得比我想的快。”沈昀低声道，语气平静，却带着试探。\\n\\n裴昭没有立刻回答，只扫了他一眼，又看向紧闭的巷口，确认四下无人。她压低声音：“你递来的东西，值得我冒这个险吗？”\\n\\n';
        d.chapters=['文书库里的先知','拿命换的筹码','从龙'].map(t=>t+'\\n\\n'+text.repeat(2));d.novelApproved=batchNovel(d);
        const input=(stage,templates)=>({requestId:crypto.randomUUID(),roundId:d.roundId,stage,topic:d.topic,direction:d.direction,templates,episodeCount:3,episodeStart:1,outline:d.outline,novel:d.novelApproved,chapterIndex:1,selectedTemplateIds:[]});
        const result=(i,v)=>({requestId:i.requestId,stage:i.stage,text:JSON.stringify(v),templateIds:i.templates.map(t=>t.publicId),inputSha256:'a'.repeat(64),resultSha256:'b'.repeat(64)});
        const a=input('advice',[]);d.runs.push({input:a,result:result(a,{assessment:'第一集先兑现小吏的生存收益。让密件改变人物行动，用门框遮挡、脚步停顿和局部灯光呈现试探，而不是用对白直接解释全部秘密。',recommendations:[{publicId:'mt_0003',reason:'补足声音与节奏的反差',tradeoff:'避免每场重复同一种处理'}]})});
        for(let n=0;n<2;n++){const i=input('script',d.templates.map((t,j)=>({...t,weight:[n?30:50,n?50:30,20][j]})));d.runs.push({input:i,result:result(i,{title:d.topic,applications:[{publicId:'mt_0000',method:'遮挡与停顿',adaptation:'让卷宗交接暴露人物之间的信息差。',sceneKeys:['E1-S1','E2-S1']}],episodes:[1,2,3].map(index=>({index,title:['文书库里的先知','拿命换的筹码','从龙'][index-1],opening:'归档时发现密件',payoff:'识破试探并保住副本',hook:'失踪的文书出现在对手案头',scenes:[{key:'E'+index+'-S1',场景:'雨水沿屋檐滴落。裴昭站在巷口，挡住去路。',人物:n?'刀尖压住卷宗，沈昀没有退，反而抬眼看她。':'沈昀把卷宗推近半寸，等她先开口。',妆容:'衣摆沾着夜雨，袖口卷起。',灯光:n?'冷蓝月光与巷外火把交替划过两人的脸。':'暖灯只照亮卷宗，脸藏在暗处。',氛围:'两人的目光在刀锋与文书之间移动。',对白:'沈昀：“你今晚拦住我，到底是怕我查到真相，还是有话要亲口说？”\\n裴昭：“有些事，知道得太早，对你未必是好事。”'}]}))})});}
        localStorage.setItem('mv-novel-lab-v2:1',JSON.stringify(d));localStorage.setItem('seeded','1');
        localStorage.setItem('mv-manhua-writer-session-v1','墨菁传保护样本');
      }
      createRoot(document.getElementById('root')).render(<NovelAdaptationWorkspace userId="1"/>);`,
    },
    bundle: true,
    write: false,
    outdir: "ui-browser",
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    external: ["pdfjs-dist", "tesseract.js"],
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "offline-mock",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "mock",
          }));
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({
            contents:
              a.path === "trpc"
                ? novelMockTransport
                : 'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false})',
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  let baseCss = "";
  try {
    baseCss = readdirSync("client/dist/assets")
      .filter(f => f.endsWith(".css"))
      .map(f => readFileSync(`client/dist/assets/${f}`, "utf8"))
      .join("\n");
  } catch {}
  const css =
    baseCss +
    "\n" +
    built.outputFiles
      .filter(f => f.path.endsWith(".css"))
      .map(f => f.text)
      .join("\n");
  const js = built.outputFiles.find(f => f.path.endsWith(".js"))!.text;
  const html =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    css +
    '</style><div id="root"></div><script>' +
    js.replace(/<\/script/g, "<\\/script") +
    "</script>";
  writeFileSync(`${artifactDir}/preview.html`, html);

  return { html, artifactDir };
}
