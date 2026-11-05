import { Marked } from "marked";
import { renderLayoutBody } from "./editableLayout";

export type KnowledgeBookletPage = { id: string; headline: string; body: string; imageUrl: string };
export type KnowledgeBookletTheme = "fusion_chinese_garden" | "fusion_ink_mountains" | "fusion_coastal_lighthouse" | "fusion_glasshouse_garden" | "fusion_maple_bridge" | "fusion_snow_monastery";
export const KNOWLEDGE_BOOKLET_VERSION = "knowledge-booklet-1105-v2-interleaved";
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export const KNOWLEDGE_BOOKLET_THEMES: Record<KnowledgeBookletTheme, { name: string; paper: string; ink: string; accent: string; line: string; mark: string }> = {
  fusion_chinese_garden: { name:"中式园林融合",paper:"#fff2df",ink:"#713e2b",accent:"#b64632",line:"#d8ac83",mark:"园" },
  fusion_ink_mountains: { name:"水墨山峦融合",paper:"#f2f1ef",ink:"#303038",accent:"#aa3038",line:"#b5b2b7",mark:"山" },
  fusion_coastal_lighthouse: { name:"海岸灯塔融合",paper:"#edf6ff",ink:"#174a82",accent:"#d07432",line:"#8fbbdf",mark:"海" },
  fusion_glasshouse_garden: { name:"温室花园融合",paper:"#faf0f6",ink:"#6c3b63",accent:"#b64f80",line:"#cda5c5",mark:"林" },
  fusion_maple_bridge: { name:"枫桥秋意融合",paper:"#f6ece2",ink:"#63483c",accent:"#a55f40",line:"#d0b19a",mark:"秋" },
  fusion_snow_monastery: { name:"雪峰秘境融合",paper:"#f0f1f5",ink:"#495372",accent:"#947d57",line:"#b8bfce",mark:"雪" },
};

/** 无顾问选版回执时按正文主题匹配；手选始终优先。只改变版式，不改正文。 */
export function chooseKnowledgeBookletTheme(text: string, manual?: string, suggested?: string): KnowledgeBookletTheme {
  if (manual && manual in KNOWLEDGE_BOOKLET_THEMES) return manual as KnowledgeBookletTheme;
  if (suggested && suggested in KNOWLEDGE_BOOKLET_THEMES) return suggested as KnowledgeBookletTheme;
  if (/海洋|航海|港口|灯塔|航运|海岸/.test(text)) return "fusion_coastal_lighthouse";
  if (/医学|医药|草药|植物|生态|园艺|健康/.test(text)) return "fusion_glasshouse_garden";
  if (/雪|寒地|极地|冰川/.test(text)) return "fusion_snow_monastery";
  if (/山水|地理|道家|哲学|老庄/.test(text)) return "fusion_ink_mountains";
  if (/秋|回忆|诗词|乡愁/.test(text)) return "fusion_maple_bridge";
  return "fusion_chinese_garden";
}

type Unit = { html: string; source: string };
/** 按自然句界拆长段，保留全部字符；长段不以裁切换页数。 */
const splitLongText = (text: string, limit: number): string[] => {
  const pieces: string[]=[];let rest=text;
  while(rest.length>limit){
    const cut=Math.max(rest.lastIndexOf("。",limit),rest.lastIndexOf("；",limit),rest.lastIndexOf("\n",limit));
    const at=cut>limit/2?cut+1:limit;
    pieces.push(rest.slice(0,at));rest=rest.slice(at);
  }
  if(rest)pieces.push(rest);return pieces;
};

/** 按原 Markdown 块排版，表格按原行顺序拆段；不总结、不校改、不增加知识。 */
function readingUnits(pages: KnowledgeBookletPage[]): Unit[] {
  const lexer = new Marked();
  const result: Unit[] = [];
  for (const [index, page] of Array.from(pages.entries())) {
    let heading = page.headline, ordinal = 0, lastHeading = "";
    for (const token of lexer.lexer(page.body)) {
      if (token.type === "space" || token.type === "hr") continue;
      if (token.type === "heading") { heading = token.text; continue; }
      const title = heading === lastHeading ? "" : `<div class="unit-heading"><span>${String(index + 1).padStart(2,"0")}</span><h3>${escape(heading)}</h3></div>`;
      const wrap = (html: string, kind: string) => { lastHeading = heading; result.push({ source: page.id, html: `<section class="reading-unit ${kind}" data-source-id="${escape(page.id)}" data-unit="${index}-${ordinal++}">${title}${html}</section>` }); };
      if (token.type === "table") {
        const table = token as typeof token & {header:{text:string}[]; rows:{text:string}[][]};
        // 拆长表时重复表头，保留行序号便于验收。
        const rows=table.rows.flatMap(row=>{
          const cells=row.map(c=>splitLongText(c.text,400));
          return Array.from({length:Math.max(1,...cells.map(c=>c.length))},(_,i)=>cells.map(c=>({text:c[i]||""})));
        });
        for (let start=0; start<rows.length;) {
          let end=start, budget=0;
          while(end<rows.length && end<start+9){
            const cost=Math.max(...rows[end].map(c=>c.text.length),1);
            if(end>start && budget+cost>850)break;
            budget+=cost;end++;
          }
          const html = `<table><thead><tr>${table.header.map(c=>`<th>${renderLayoutBody(c.text)}</th>`).join("")}</tr></thead><tbody>${rows.slice(start,end).map((row,n)=>`<tr data-source-row="${start+n}">${row.map(c=>`<td>${renderLayoutBody(c.text)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
          wrap(html,"table-unit");start=end;
        }
      } else {
        for(const part of splitLongText(token.raw,1400))
          wrap(renderLayoutBody(part),token.type === "list" ? "list-unit" : "prose-unit");
      }
    }
  }
  return result;
}

function ornament(theme: KnowledgeBookletTheme) {
  const path = theme === "fusion_coastal_lighthouse"
    ? '<path d="M0 104 Q50 60 100 104 T200 104 T300 104 T400 104 T500 104 T600 104 M0 120 Q50 76 100 120 T200 120 T300 120 T400 120 T500 120 T600 120 M470 100L485 30L500 100 M477 60H493 M478 34L485 23L492 34"/>'
    : theme === "fusion_ink_mountains" || theme === "fusion_snow_monastery"
      ? '<path d="M0 134L60 96L83 112L150 30L190 86L240 62L330 140 M170 140L270 22L350 116L390 70L465 142 M315 140L410 38L450 90L480 62L570 142 M120 67L150 30L174 65L155 59L143 72 M240 60L270 22L300 61L276 53"/>'
      : '<path d="M42 140Q118 62 202 18M85 102Q50 49 89 38Q113 54 109 79M115 74Q172 80 173 45Q142 31 127 62M151 48Q123 12 151 1Q174 13 174 32 M365 140Q431 82 530 30M411 104Q376 56 406 43Q436 55 431 83M442 81Q490 89 499 59Q470 48 453 66 M255 141V80L215 80L260 55L305 80H265V141M229 80V141M291 80V141M214 141H306"/>';
  return `<svg class="botanical" viewBox="0 0 600 160" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true">${path}</svg>`;
}

export function buildKnowledgeBookletHtml(input: { title: string; pages: KnowledgeBookletPage[]; theme?: KnowledgeBookletTheme; readingPages?: number; fragment?: boolean }) {
  if (!input.pages.length || input.pages.some(p=>!p.body.trim())) throw new Error("请保留每张卡片的图片和完整正文");
  if (new Set(input.pages.map(p=>p.id)).size !== input.pages.length) throw new Error("知识卡页编号重复");
  if (input.pages.some(p=>p.imageUrl && !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$|^https:\/\//.test(p.imageUrl))) throw new Error("配图地址无效");
  const theme = input.theme || chooseKnowledgeBookletTheme(input.title+input.pages.map(p=>p.body).join("\n"));
  const style = KNOWLEDGE_BOOKLET_THEMES[theme];
  if (!style) throw new Error("请选择已有融合模板");
  const units = readingUnits(input.pages);
  const desired = input.readingPages || Math.max(1,Math.ceil(input.pages.reduce((n,p)=>n+p.body.length,0)/1600));
  const ornamentHtml = ornament(theme);
  const run = (label: string, n: string) => `<div class="running"><span>${escape(input.title)}</span><span>${label}</span><b>${n}</b></div>`;
  const foot = (label: string) => `<footer><span>${escape(input.title)} <i>·</i> ${label}</span><span class="page-number"></span></footer>`;
  const images = input.pages.map((p,i)=>p.imageUrl ? `<article class="folio image-folio" data-card-id="${escape(p.id)}">${run("图文原卡",String(i+1).padStart(2,"0"))}<header class="image-title"><div><p class="eyebrow">图文知识图册</p><h1>${escape(p.headline)}</h1></div></header><figure class="main-card"><img style="width:100%!important;height:100%!important;max-height:796px!important;max-width:100%!important;object-fit:contain!important" src="${escape(p.imageUrl)}" alt="${escape(p.headline)}"></figure><div class="image-caption"><span class="caption-index">${String(i+1).padStart(2,"0")}</span><p>图解与文字相互参照<span>对应说明穿插于图卡之间</span></p>${ornamentHtml}</div>${foot("图文原卡")}</article>` : "").join("");
  const readingHeader = `<header class="reading-title"><div><p class="eyebrow">图文对照 <span>／</span> 知识阅读</p><h2>${escape(input.title)}</h2><p class="reading-subtitle">${input.pages.map((p,i)=>`${String(i+1).padStart(2,"0")} ${escape(p.headline)}`).join("　·　")}</p></div><div class="art-window" aria-hidden="true"><img alt="" style="width:1200px!important;max-width:none!important;height:675px!important;max-height:none!important;object-fit:fill!important">${ornamentHtml}</div></header>`;
  // 同一脚本在预览和PDF环境中测量实际字体与块高，不以overflow:hidden强塞固定页数。
  const pagination = String.raw`
  (()=>{
    const root=document.currentScript.closest('[data-booklet-root]') || document.body;
    const staging=root.querySelector('#reading-source'), units=[...staging.children];
    const template=root.querySelector('#reading-template'),host=root.querySelector('#reading-pages');
    const cards=[...root.querySelectorAll('.image-folio')];
    let busy=Promise.resolve();
    const layout=async()=>{
      root.dataset.ready='loading';
      await document.fonts.ready;
      for(const card of cards)root.insertBefore(card,host);
      for(const unit of units)staging.append(unit);
      host.replaceChildren();
      await Promise.all([...root.querySelectorAll('.main-card img')].map(i=>i.decode()));
      const desired=Number(staging.dataset.pages);let pages=[];
      const add=()=>{const page=template.content.firstElementChild.cloneNode(true);host.append(page);pages.push(page);return page;};
      const first=add(),measure=first.querySelector('.reading-column'),capacity=measure.clientHeight;
      const heights=units.map(unit=>{measure.append(unit);const height=unit.offsetHeight+16;staging.append(unit);return height;});
      const total=heights.reduce((a,b)=>a+b,0);
      const countColumns=limit=>{let count=1,used=0;for(const h of heights){if(used&&used+h>limit){count++;used=0;}used+=h;}return count;};
      let low=Math.max(...heights),high=total;
      for(let step=0;step<30;step++){const mid=(low+high)/2;if(countColumns(mid)>desired*2)low=mid;else high=mid;}
      const target=Math.min(capacity,high+1);let page=first,col=0,used=0;
      for(let i=0;i<units.length;i++){
        const unit=units[i],height=heights[i];
        if(height>capacity+1)throw new Error('单个内容块超过一页，请拆分长表或长段落后再导出');
        if(used>0&&(used+height>capacity||used+height>target)){
          if(col===0)col=1;else{page=add();col=0;}used=0;
        }
        page.querySelectorAll('.reading-column')[col].append(unit);used+=height;
      }
      const remaining=new Map(cards.map(el=>[el.dataset.cardId,el]));
      for(const reading of pages){
        const ids=[...new Set([...reading.querySelectorAll('[data-source-id]')].map(el=>el.dataset.sourceId))];
        for(const id of ids){const card=remaining.get(id);if(card){host.insertBefore(card,reading);remaining.delete(id);}}
        const matching=cards.find(c=>ids.includes(c.dataset.cardId));
        const art=reading.querySelector('.art-window img');
        if(matching)art.src=matching.querySelector('.main-card img').src;else art.parentElement.remove();
        reading.querySelector('.reading-subtitle').textContent=cards.filter(c=>ids.includes(c.dataset.cardId)).map(c=>c.querySelector('h1').textContent).join(' · ');
      }
      const folios=[...root.querySelectorAll('.folio')];
      const allFolios=[...document.querySelectorAll('[data-booklet-root] .folio')];
      const offset=Number(document.body.dataset.bookletPageOffset||0),totalPages=Number(document.body.dataset.bookletTotalPages||allFolios.length);
      allFolios.forEach((el,i)=>el.querySelector('.page-number').textContent=String(offset+i+1).padStart(2,'0')+' / '+String(totalPages).padStart(2,'0'));
      if([...root.querySelectorAll('.reading-column')].some(el=>el.scrollHeight>el.clientHeight+2))throw new Error('正文超出页面，未裁切内容，请调整版式');
      await Promise.all([...root.querySelectorAll('.art-window img')].map(i=>i.decode()));
      root.dataset.ready='true';
      root.__knowledgeBooklet={ready:true,imagePages:cards.length,readingPages:pages.length,pages:folios.length,units:units.length,totalHeight:total,columnCapacity:capacity,targetHeight:target,overflow:false};
      window.__knowledgeBooklet=root.__knowledgeBooklet;
    };
    root.__layoutBooklet=()=>busy=busy.catch(()=>{}).then(layout).catch(e=>{
      root.dataset.ready='error';root.__knowledgeBooklet={ready:false,error:e.message};window.__knowledgeBooklet=root.__knowledgeBooklet;
      let alert=root.querySelector('.layout-error');if(!alert){alert=document.createElement('p');alert.className='layout-error';root.prepend(alert);}alert.textContent=e.message;throw e;
    });
    root.__layoutBooklet().catch(()=>{});
  })();`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.title)}</title><style>
.theme-${theme}{--paper:${style.paper};--ink:${style.ink};--accent:${style.accent};--line:${style.line};--white:#fffdf8;color:var(--ink);font-family:"PingFang SC","Noto Sans CJK SC",sans-serif}*{box-sizing:border-box}body{margin:0;background:#dcded4;color:var(--ink);font-family:"PingFang SC","Noto Sans CJK SC",sans-serif} .folio{position:relative;width:1600px;height:1200px;margin:28px auto;padding:38px 62px 30px;background:var(--paper);border:1px solid var(--line);outline:1px solid var(--line);outline-offset:-13px;box-shadow:0 12px 48px #29372b15;display:flex;flex-direction:column}.folio:before{content:"";position:absolute;inset:5px;border:5px solid transparent;border-image:repeating-linear-gradient(45deg,var(--line) 0 1px,transparent 1px 8px) 5;pointer-events:none}.running{height:35px;flex:none;display:flex;gap:24px;align-items:center;justify-content:space-between;border-bottom:3px double var(--line);font-size:12px;letter-spacing:2px;color:var(--accent)}.running span:first-child{margin-right:auto}.running b{font-family:Georgia,serif;font-size:21px;font-weight:400}.eyebrow{font-size:12px;letter-spacing:3px;color:var(--accent);margin:0 0 10px}.eyebrow span{opacity:.4;margin:0 8px}.image-title{display:flex;align-items:center;justify-content:space-between;gap:30px;margin:24px 0 20px;min-height:92px}.image-title h1{font:700 40px/1.3 "Kaiti SC","STKaiti","Songti SC",serif;letter-spacing:3px;margin:0;text-shadow:1px 1px var(--white)}.seal{display:grid;place-items:center;width:58px;height:58px;flex:none;border:3px double var(--accent);color:var(--accent);font:28px "Songti SC",serif;border-radius:4px;transform:rotate(-3deg)}.main-card{height:822px;flex:none;margin:0;padding:10px;border:3px double var(--line);background:color-mix(in srgb,var(--paper) 45%,var(--white));box-shadow:5px 5px 0 color-mix(in srgb,var(--line) 18%,transparent);display:flex;align-items:center;justify-content:center}.main-card img{display:block;width:100%!important;height:100%!important;max-height:796px!important;object-fit:contain!important}.image-caption{display:flex;align-items:center;gap:18px;flex:1;min-height:68px;position:relative}.caption-index{font:40px/1 Georgia,serif;color:var(--accent);opacity:.65}.image-caption p{font:18px "Songti SC",serif;margin:0;line-height:1.7}.image-caption p span{font:12px sans-serif;display:block;color:var(--ink);opacity:.65}.botanical{width:310px;height:88px;opacity:.27;color:var(--accent);flex:none;pointer-events:none}.image-caption .botanical{margin-left:auto}footer{height:28px;flex:none;display:flex;align-items:end;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px;font-size:11px;letter-spacing:1px;color:var(--accent)}footer i{margin:0 8px;opacity:.5}.page-number{font-family:Georgia,serif;letter-spacing:2px}.reading-folio{height:2240px}.reading-title{height:350px;flex:none;display:flex;justify-content:space-between;align-items:center;gap:30px;margin:12px 0 18px}.reading-title>div:first-child{max-width:840px;flex:1;min-width:0}.reading-title h2{font:700 54px "Songti SC",serif;letter-spacing:3px;margin:0 0 12px}.reading-subtitle{font-size:15px;line-height:1.8;margin:0;opacity:.7}.art-window{width:540px;height:340px;position:relative;flex:none;overflow:hidden;mix-blend-mode:multiply;mask-image:radial-gradient(ellipse 48% 58% at 50% 48%,#000 38%,transparent 90%)}.art-window>img{position:absolute;left:50%;top:-85px;width:1200px!important;max-width:none!important;height:675px!important;max-height:none!important;transform:translateX(-50%);object-fit:fill!important;opacity:.85}.art-window .botanical{position:absolute;bottom:0;right:0;width:420px;height:140px;opacity:.5}.theme-fusion_ink_mountains .reading-title .art-window{width:650px;filter:saturate(.25)}.theme-fusion_coastal_lighthouse .reading-title{flex-direction:row-reverse}.theme-fusion_coastal_lighthouse .reading-title>div:first-child{padding-left:35px;border-left:3px double var(--line)}.theme-fusion_glasshouse_garden .art-window{width:500px;mask-image:radial-gradient(ellipse 45% 62% at 50% 48%,#000 40%,transparent 90%)}.theme-fusion_glasshouse_garden .reading-title h2{letter-spacing:8px}.reading-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:34px;flex:none;height:1676px;margin-bottom:19px}.reading-column{height:1676px;min-width:0}.reading-unit{padding:14px 18px 15px;background:color-mix(in srgb,var(--white) 78%,var(--paper));border:3px double color-mix(in srgb,var(--line) 80%,transparent);margin-bottom:16px;border-radius:4px;break-inside:avoid}.unit-heading{display:flex;gap:10px;align-items:center;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid var(--line)}.unit-heading>span{display:grid;place-items:center;flex:none;width:26px;height:26px;border:1px solid var(--line);border-radius:50%;font:13px Georgia,serif;color:var(--accent)}.unit-heading h3{font:700 19px/1.4 "Songti SC",serif;letter-spacing:1px;margin:0}.reading-unit p{font-size:16px;line-height:1.75;margin:0}.reading-unit p+p{margin-top:8px}.reading-unit ul,.reading-unit ol{padding-left:21px;margin:0;font-size:16px;line-height:1.7}.list-unit ul{columns:2;column-gap:26px}.reading-unit li{break-inside:avoid;padding:2px 0}.reading-unit strong{color:var(--accent)}.reading-unit table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.6}.reading-unit th{background:var(--ink);color:var(--white);font-weight:500;text-align:left;padding:7px 10px}.reading-unit td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}.reading-unit td p,.reading-unit th p{font-size:15px;line-height:1.6;margin:0}.reading-unit tr:nth-child(even) td{background:color-mix(in srgb,var(--paper) 65%,var(--white))}.reading-unit tbody tr:last-child td{border-bottom:0}.reading-unit blockquote{margin:0;padding:8px 14px;border-left:2px solid var(--accent)}.reading-unit img{max-width:100%}.prose-unit{background:color-mix(in srgb,var(--paper) 45%,var(--white))}.layout-error{background:#fff;color:#a32424;padding:20px;text-align:center}.staging{position:absolute;left:-10000px;top:0;width:720px;visibility:hidden}
.theme-fusion_ink_mountains .folio{background:linear-gradient(155deg,#fff7 0%,transparent 35%),var(--paper)}.theme-fusion_ink_mountains .seal{border-radius:50%;color:#925f45}.theme-fusion_ink_mountains .main-card{border-width:1px;padding:13px;box-shadow:0 0 0 5px var(--paper),0 0 0 6px var(--line)}.theme-fusion_coastal_lighthouse .image-title{flex-direction:row-reverse;text-align:right}.theme-fusion_coastal_lighthouse .main-card{border-radius:26px 3px 26px 3px;padding:12px}.theme-fusion_coastal_lighthouse .reading-unit{border:1px solid var(--line);border-top:3px solid var(--line);border-radius:10px 2px}.theme-fusion_glasshouse_garden .main-card{border-radius:48px 48px 5px 5px;padding:15px}.theme-fusion_glasshouse_garden .reading-unit{border-radius:16px 3px;border-width:1px;border-left:3px solid var(--line)}.theme-fusion_glasshouse_garden .seal{border-radius:50% 50% 4px 4px}.theme-fusion_maple_bridge .image-title{border-left:4px solid var(--accent);padding-left:22px}.theme-fusion_snow_monastery .main-card{box-shadow:none;border:1px solid var(--line);background:#fff9}.theme-fusion_snow_monastery .seal{transform:none}
@media screen and (max-width:1656px){[data-ready="true"] .folio{zoom:calc((100vw - 32px) / 1600px)}}
@page{size:1600px 1200px;margin:0}@page reading{size:1600px 2240px;margin:0}.reading-folio{page:reading}@media print{[data-booklet-root]+[data-booklet-root]{break-before:page}html,body{margin:0;background:var(--paper);print-color-adjust:exact;-webkit-print-color-adjust:exact}.folio{margin:0;zoom:1!important;box-shadow:none;break-after:page;break-inside:avoid}.folio:last-child{break-after:auto}.layout-error{display:block}.staging{display:none}}
</style></head><body data-booklet-root class="theme-${theme}" data-booklet-version="${KNOWLEDGE_BOOKLET_VERSION}">${images}<div id="reading-pages"></div><template id="reading-template"><article class="folio reading-folio">${run("正文阅读","文")}${readingHeader}<div class="reading-columns"><div class="reading-column"></div><div class="reading-column"></div></div>${foot("图文对照 · 正文阅读")}</article></template><div id="reading-source" class="staging" data-pages="${desired}">${units.map(u=>u.html).join("")}</div><script>${pagination}</script></body></html>`;
  if (!input.fragment) return html;
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1];
  const content = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  return `<section data-booklet-root class="theme-${theme}" data-booklet-version="${KNOWLEDGE_BOOKLET_VERSION}"><style>${css}</style>${content}</section>`;
}
