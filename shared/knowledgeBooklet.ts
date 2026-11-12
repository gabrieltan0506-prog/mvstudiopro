import {hasKnowledgeBody} from './knowledgeEditionIssues';
import {knowledgeMotifSvg,knowledgeContentDesignCss,knowledgeContentDesignKey} from "./knowledgeContentDesign";
import { resolveKnowledgeDecoration, type KnowledgeDecoration } from "./knowledgeDecorations";
import { KNOWLEDGE_DECORATION_ART } from "./knowledgeDecorationAssets";
import { knowledgeDecorationClass, knowledgeDecorationCss, knowledgeDividerSvg } from "./knowledgeDecorationRenderer";
import { Marked } from "marked";
import { renderLayoutBody } from "./editableLayout";

export type KnowledgeBookletPage = { id: string; headline: string; body: string; imageUrl: string };
export type KnowledgeBookletTheme = "fusion_chinese_garden" | "fusion_ink_mountains" | "fusion_coastal_lighthouse" | "fusion_glasshouse_garden" | "fusion_maple_bridge" | "fusion_snow_monastery";
/** 手册每页的半透明平铺水印（用户 2026-11-11 定：图文手册生成时打上，单张图片不打）。 */
export const KNOWLEDGE_BOOKLET_WATERMARK = "mvstudiopro.com";
export const KNOWLEDGE_BOOKLET_VERSION = "knowledge-booklet-1113-v19-fit-image";
/**
 * 信息图入版上限（排版服务按 data-pdf-max-dim 执行；与审校缩图派生件 2048 一致，未超上限的 JPEG 原样入版）。
 * 站长 2026-11-12：整图清晰度是硬要求——版面上等比例缩小只改显示尺寸，入版像素一律按这一档（2048 / 0.85），不另设低档。
 */
export const KNOWLEDGE_BOOKLET_IMAGE_MAX_DIM = 2048;
export const KNOWLEDGE_BOOKLET_IMAGE_QUALITY = 0.85;
/** 用户 2026-11-11：每页留白不得超过版心 1/3（硬上限）；超过 FILL 阈值就开始补位（预告/纹样），不等到贴线。 */
export const KNOWLEDGE_BOOKLET_MAX_WHITESPACE = 1 / 3;
export const KNOWLEDGE_BOOKLET_FILL_THRESHOLD = 0.15;
/**
 * 整图版式等比例缩小的下限（站长 2026-11-12「圖片可以做尺寸的等比例稍微的壓縮」）：
 * 某章有续页时先试把该章信息图等比例缩小来收回续页（完整、居中、不变形、不裁切；缩到够用为止——站长 2026-11-13「每页的图按正文多少等比例缩放，用来吃掉留白」），
 * 显示宽度不得小于版心宽 × 本值，保证图上文字仍清楚；缩到下限仍放不下就正常接续页，不再继续缩。
 */
export const KNOWLEDGE_BOOKLET_IMAGE_MIN_WIDTH_RATIO = 0.85;
/**
 * 站长 2026-11-12：不再切图——每章信息图整张置于章标题下、正文上（图文同页，满版心宽、等比例），正文放不下接续页。
 * "spread"（跨页切半）与 "auto" 只为兼容旧调用方保留在类型里，一律按 "inline" 排版。
 */
export type KnowledgeBookletImageMode = "inline" | "auto" | "spread";
/** imageUrl 仅为兼容旧调用方保留：下篇预告只印标题与纹样框，不再放下一章图片的局部裁切条。 */
export type KnowledgeBookletNext = { headline: string; imageUrl?: string; chapterNo: number } | null;
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

const IMAGE_POINTER = /^(?:如|见|参见)?(?:上|本)?图(?:中|上|下|左|右|里|内|片)|^读图(?:提示|要点|说明)?[:：]/;
const SELF_REFERENCE = /此处(?:补|说明|解释|只|再|另|展开|讲)/;
/** 只说明“图中已列什么、此处补什么”的编辑提示（版式块 note），不是读者正文。 */
export function isImagePointerNote(text: string): boolean {
  const t = text.replace(/^[>\s]+/gm, "").replace(/\s+/g, "").trim();
  // 以“如下/：”引出后文的是导语，不算编辑提示。
  if (/(?:如下|[:：])$/.test(t)) return false;
  return t.length > 0 && t.length <= 120 && (IMAGE_POINTER.test(t) || SELF_REFERENCE.test(t));
}

/** 按原 Markdown 块排版，表格按原行顺序拆段；不总结、不校改、不增加知识。 */
function readingUnits(pages: KnowledgeBookletPage[], decoration: KnowledgeDecoration, chapterOffset = 0): Unit[] {
  const lexer = new Marked();
  const result: Unit[] = [];
  for (const [index, page] of Array.from(pages.entries())) {
    const start = result.length;
    let heading = page.headline, ordinal = 0, lastHeading = "";
    // 排版块的 note 会以引用块落进正文；只“指向图中位置/说明本处补什么”的编辑提示不是读者正文，不印出。
    // 若一页只剩这类提示，则原样保留，不让章节变空。
    const tokens = lexer.lexer(page.body);
    const readerTokens = tokens.filter(token => !(token.type === "blockquote" && isImagePointerNote((token as {text:string}).text)));
    const kept = readerTokens.some(token => token.type !== "space" && token.type !== "hr" && token.type !== "heading") ? readerTokens : tokens;
    for (const token of kept) {
      if (token.type === "space" || token.type === "hr") continue;
      if (token.type === "heading") { heading = token.text; continue; }
      const title = heading === lastHeading ? "" : `<div class="unit-heading"><span>${String(chapterOffset + index + 1).padStart(2,"0")}</span><h3>${escape(heading)}</h3></div>`;
      const wrap = (html: string, kind: string) => { lastHeading = heading; result.push({ source: page.id, html: `<section class="reading-unit ${kind}" data-source-id="${escape(page.id)}" data-source-headline="${escape(page.headline)}" data-unit="${index}-${ordinal++}">${title}${html}${title ? knowledgeDividerSvg(decoration.divider) : ""}</section>` }); };
      if (token.type === "table") {
        const table = token as typeof token & {header:{text:string}[]; rows:{text:string}[][]};
        // 拆长表时重复表头，保留行序号便于验收。
        const rows=table.rows.flatMap(row=>{
          const cells=row.map(c=>splitLongText(c.text,160));
          return Array.from({length:Math.max(1,...cells.map(c=>c.length))},(_,i)=>cells.map(c=>({text:c[i]||""})));
        });
        for (let start=0; start<rows.length;) {
          let end=start, budget=0;
          while(end<rows.length && end<start+6){
            const cost=Math.max(...rows[end].map(c=>c.text.length),1);
            if(end>start && budget+cost>360)break;
            budget+=cost;end++;
          }
          const html = `<table><thead><tr>${table.header.map(c=>`<th>${renderLayoutBody(c.text,true)}</th>`).join("")}</tr></thead><tbody>${rows.slice(start,end).map((row,n)=>`<tr data-source-row="${start+n}">${row.map(c=>`<td>${renderLayoutBody(c.text,true)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
          wrap(html,"table-unit");start=end;
        }
      } else {
        for(const part of splitLongText(token.raw,600))
          wrap(renderLayoutBody(part,true),token.type === "list" ? "list-unit" : "prose-unit");
      }
    }
    // 空章节保留标题及原始结构，只标记待补齐；不制造正文、不丢掉整册。
    if (result.length === start) result.push({source:page.id,html:`<section class="reading-unit pending-content" data-source-id="${escape(page.id)}" data-source-headline="${escape(page.headline)}"><div class="unit-heading"><h3>${escape(page.headline)}</h3></div>${renderLayoutBody(page.body,true)}<p role="status">本节正文待补齐</p></section>`});
    // 原图已与要点同页置顶，不再在正文中重复穿插；只保留主题插画条。
    const visual = decoration.interleave === "artwork-strip" ? KNOWLEDGE_DECORATION_ART[decoration.artworkId] : "";
    if (decoration.interleave === "original-image" && !page.imageUrl) throw new Error("正文穿插选择了原图，但该章没有配图");
    if (visual) result.splice(Math.min(start + 2, result.length), 0, {source:page.id,html:`<figure class="reading-unit interleaved-visual ${decoration.interleave === "artwork-strip" ? "interleaved-art" : ""}" data-source-id="${escape(page.id)}" data-source-headline="${escape(page.headline)}"><img src="${escape(visual)}" alt="${decoration.interleave === "original-image" ? escape(page.headline) : "主题装饰插画"}"><figcaption>${decoration.interleave === "original-image" ? "图解回看 · " + escape(page.headline) : ""}</figcaption></figure>`});
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

/**
 * imageMode：见 KnowledgeBookletImageMode。
 * next：本片段最后一章之后的下一章（标题、章号），供页尾留白处放「下篇预告」（只印标题＋纹样框，不放图片）；null 表示全书末章；不传则只用纹样补白。
 */
export function buildKnowledgeBookletHtml(input: { title: string; pages: KnowledgeBookletPage[]; theme?: KnowledgeBookletTheme; readingPages?: number; fragment?: boolean; decoration?: KnowledgeDecoration; chapterOffset?: number; imageMode?: KnowledgeBookletImageMode; next?: KnowledgeBookletNext }) {
  if (!input.pages.length) throw new Error("没有可分页的章节，原稿保留");
  if (new Set(input.pages.map(p=>p.id)).size !== input.pages.length) throw new Error("知识卡页编号重复");
  const validImage = (url: string) => /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$|^https:\/\//.test(url);
  if (input.pages.some(p=>p.imageUrl && !validImage(p.imageUrl))) throw new Error("配图地址无效");
  const theme = input.theme || chooseKnowledgeBookletTheme(input.title+input.pages.map(p=>p.body).join("\n"));
  const style = KNOWLEDGE_BOOKLET_THEMES[theme];
  if (!style) throw new Error("请选择已有融合模板");
  const decoration = resolveKnowledgeDecoration(input.decoration,input.title + input.pages.map(p=>p.headline).join(" "));
  const decorationClass = knowledgeDecorationClass(decoration);
  const design=decoration.design;
  const designAttribute=design?` data-content-design="${knowledgeContentDesignKey(design)}"`:"";
  const units = readingUnits(input.pages,decoration,input.chapterOffset ?? 0);
  const ornamentHtml = ornament(theme);
  const artwork = KNOWLEDGE_DECORATION_ART[decoration.artworkId] || "";
  const run = (label: string, n: string) => `<div class="running"><span>${escape(input.title)}</span><span>${label}</span><b>${n}</b></div>`;
  const foot = (label: string) => `<footer><span>${escape(input.title)} <i>·</i> ${label}</span><span class="page-number"></span></footer>`;
  const offset = input.chapterOffset ?? 0;
  const no = (i: number) => String(offset + i + 1).padStart(2, "0");
  const imageAttrs = `data-pdf-max-dim="${KNOWLEDGE_BOOKLET_IMAGE_MAX_DIM}" data-pdf-quality="${KNOWLEDGE_BOOKLET_IMAGE_QUALITY}"`;
  const titleHeader = (p: KnowledgeBookletPage, i: number) => `<header class="image-title"><div><p class="eyebrow"><span class="chapter-no">${no(i)}</span>图文知识</p><h1>${escape(p.headline)}</h1></div>${design?knowledgeMotifSvg(design.motif):ornamentHtml}</header>`;
  const columns = `<div class="reading-columns lead-columns"><div class="reading-column"></div><div class="reading-column"></div></div>`;
  // 直式图文同页：图在上、本章要点在下，同页放不下的才流入续页；不让单图独占一页。
  const images = input.pages.map((p,i)=>p.imageUrl ? `<article class="folio lead-folio" data-variant="inline" data-card-id="${escape(p.id)}" data-focus="${escape(p.headline)}">${run("图文知识",no(i))}${titleHeader(p,i)}<figure class="main-card"><img ${imageAttrs} style="display:block;width:100%!important;height:auto!important;max-height:900px!important;object-fit:contain!important" src="${escape(p.imageUrl)}" alt="${escape(p.headline)}"></figure>${columns}${foot("图文知识")}</article>` : "").join("");
  // 下篇预告：只放下一章标题（站长 2026-11-12：不再放下一章图片的局部裁切条）。片段内下一章取本册下一页，末章取 input.next。
  const nextOf = (i: number): KnowledgeBookletNext | undefined => i + 1 < input.pages.length ? { headline: input.pages[i + 1]!.headline, chapterNo: offset + i + 2 } : input.next;
  const previews = input.pages.map((p, i) => {
    const next = nextOf(i);
    if (next === undefined) return "";
    if (next === null) return `<div class="next-source" data-for="${escape(p.id)}" data-end="true"></div>`;
    return `<div class="next-source" data-for="${escape(p.id)}" data-headline="${escape(next.headline)}" data-no="${String(next.chapterNo).padStart(2, "0")}"></div>`;
  }).join("");
  const fillerOrnament = design ? knowledgeMotifSvg(design.motif) : ornamentHtml;
  // 续页页眉右上角：本章信息图的局部、四周淡出，纯装饰（站长 2026-11-13：可以采用信息图的局部；不要的是把图拆成两半）。
  // 只在单章片段（发布流程逐章渲染）且本章有图时放；低档标记控制体积，不影响首页整图的保清晰档。
  const artWindow = input.pages.length === 1 && input.pages[0]!.imageUrl ? `<figure class="art-window" aria-hidden="true"><img alt="" src="${escape(input.pages[0]!.imageUrl)}" data-pdf-max-dim="1024" data-pdf-quality="0.8"></figure>` : "";
  const readingHeader = `<header class="reading-title"><div><p class="eyebrow">图文对照 <span>／</span> 知识阅读</p><h2>${escape(input.title)}</h2><p class="reading-subtitle">${input.pages.map((p,i)=>`${String((input.chapterOffset ?? 0)+i+1).padStart(2,"0")} ${escape(p.headline)}`).join("　·　")}</p></div>${artWindow||(design?knowledgeMotifSvg(design.motif):ornamentHtml)}</header>`;
  // 同一脚本在预览和PDF环境中测量实际字体与块高，不以overflow:hidden强塞固定页数。
  const pagination = String.raw`
  (()=>{
    const root=document.currentScript.closest('[data-booklet-root]') || document.body;
    const staging=root.querySelector('#reading-source'), units=[...staging.children];
    const template=root.querySelector('#reading-template'),host=root.querySelector('#reading-pages');
    const cards=[...root.querySelectorAll('.lead-folio')];
    // 下篇预告素材在隐藏区（只有标题与章号，不含图片）。
    const nextMap=new Map([...root.querySelectorAll('.next-source')].map(el=>[el.dataset.for,el]));
    const ornamentSvg=(root.querySelector('#filler-ornament')||{innerHTML:''}).innerHTML;
    const place=el=>{el.classList.add('folio','lead-folio');host.append(el);};
    // 未选用的版式移出文档（引用留在脚本里供重排）：不计页、不被页眉/题名查询误取；隐藏区只在首轮排版前供图片载入。
    const park=el=>{el.classList.remove('folio','lead-folio');el.remove();};
    const FILL=${KNOWLEDGE_BOOKLET_FILL_THRESHOLD},MIN_IMAGE_RATIO=${KNOWLEDGE_BOOKLET_IMAGE_MIN_WIDTH_RATIO},MAX_IMAGE_HEIGHT=900;
    // 整图尺寸（站长 2026-11-12）：等比例、完整、居中；显示框严格按原图宽高比（不靠 object-fit 留边），满版心宽（受原 900px 高度上限约束）。
    // 缩小只改显示尺寸，入版像素仍按 data-pdf-max-dim 标记，不降清晰度。
    const innerWidth=folio=>{const cs=getComputedStyle(folio);return folio.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);};
    const fullWidthOf=img=>{const card=img.closest('.main-card'),cs=getComputedStyle(card);const w=card.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);const a=img.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:0;return a?Math.min(w,MAX_IMAGE_HEIGHT*a):w;};
    const sizeImage=(img,width)=>{const a=img.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:0;img.style.setProperty('width',width+'px','important');img.style.setProperty('height',a?(width/a)+'px':'auto','important');img.style.setProperty('max-height','none','important');img.style.setProperty('max-width','100%','important');img.dataset.displayWidth=String(width);};
    // 下限 = max(版心宽 × 85%, 不超过满幅)：原图本身受高度上限约束、满幅已低于 85% 时不再缩。
    const minWidthOf=(folio,img)=>Math.min(fullWidthOf(img),MIN_IMAGE_RATIO*innerWidth(folio));
    let busy=Promise.resolve();
    const layout=async()=>{
      root.dataset.ready='loading';
      await document.fonts.ready;
      for(const unit of units)staging.append(unit);
      // 清掉上一轮的补白块与密度档。
      host.replaceChildren();
      for(const card of cards){for(const column of card.querySelectorAll('.reading-column'))column.replaceChildren();for(const f of [...card.querySelectorAll('.page-filler')])f.remove();delete card.dataset.density;}
      for(const card of cards)park(card);
      await Promise.all([...root.querySelectorAll('.main-card img,.staging img,.decoration-resource')].map(i=>i.decode()));
      // 量尺寸用一张临时续页；图下要点栏与续页栏同宽，块高可共用。
      const probe=template.content.firstElementChild.cloneNode(true);host.append(probe);
      const measure=probe.querySelector('.reading-column'),capacity=measure.clientHeight;
      const heights=new Map(units.map(unit=>{measure.append(unit);const height=unit.offsetHeight+16;staging.append(unit);return [unit,height];}));
      probe.remove();
      const pages=[],readingPages=[];let page=null,col=0,used=0,limit=0;
      const columnsOf=folio=>[...folio.querySelectorAll('.reading-column')];
      const startReading=()=>{const next=template.content.firstElementChild.cloneNode(true);host.append(next);if(readingPages.length||pages.length)next.classList.add('reading-continuation');readingPages.push(next);pages.push(next);page=next;col=0;used=0;limit=capacity;next.dataset.columnLimit=String(limit);};
      const startLead=card=>{place(card);const img=card.querySelector('.main-card img');if(img)sizeImage(img,fullWidthOf(img));pages.push(card);page=card;col=0;used=0;limit=columnsOf(card)[0].clientHeight;card.dataset.columnLimit=String(limit);};
      const unitHeight=u=>u.offsetHeight+parseFloat(getComputedStyle(u).marginBottom||'0');
      const columnUsed=c=>[...c.children].reduce((n,u)=>n+unitHeight(u),0);
      // 图页首块高于图下栏时不能整块让到续页（图会独占一页）：在图下栏可用高度内切开，
      // 段落按句、清单按项、表格按行（续块重复表头），行内标记整体保留；前段留在图下，余段按原顺序继续排。
      // 在副本上切：切不开（首个原子就放不下、或整块都放得下）时原块原样保留，不丢任何行/项/句。
      const splitToFit=(unit,column,max)=>{
        const source=unit.cloneNode(true);
        const kids=[...source.children],heading=kids.find(e=>e.classList.contains('unit-heading'));
        const decor=kids.filter(e=>e.tagName.toLowerCase()==='svg'),content=kids.filter(e=>e!==heading&&!decor.includes(e));
        const atoms=[];
        content.forEach((el,k)=>{
          const tag=el.tagName.toLowerCase();
          if(tag==='table'){const body=el.querySelector('tbody');[...(body?body.children:[])].forEach(n=>atoms.push({k,n}));}
          else if(tag==='ul'||tag==='ol')[...el.children].forEach(n=>atoms.push({k,n}));
          else [...el.childNodes].forEach(n=>{
            if(n.nodeType!==3){atoms.push({k,n});return;}
            for(const piece of n.textContent.match(/[^。！？；!?;]*[。！？；!?;]+[」”’）)]*|[^。！？；!?;]+$/g)||[])atoms.push({k,n:document.createTextNode(piece)});
          });
        });
        if(atoms.length<2)return null;
        const shell=(withHeading)=>{
          const part=unit.cloneNode(false),boxes=content.map(el=>{
            const tag=el.tagName.toLowerCase(),box=el.cloneNode(false);
            if(tag==='table'){for(const c of el.children)if(c.tagName.toLowerCase()!=='tbody')box.append(c.cloneNode(true));const tb=document.createElement('tbody');box.append(tb);return {box,slot:tb};}
            return {box,slot:box};
          });
          if(withHeading&&heading)part.append(heading.cloneNode(true));
          return {part,boxes};
        };
        const first=shell(true),rest=shell(false);
        column.append(first.part);
        let n=0;
        for(;n<atoms.length;n++){
          const {k,n:node}=atoms[n],b=first.boxes[k];
          if(!b.box.parentNode)first.part.append(b.box);
          b.slot.append(node);
          if(unitHeight(first.part)>max+1){node.remove();if(!b.slot.childNodes.length)b.box.remove();break;}
        }
        first.part.remove();
        if(n===0||n===atoms.length)return null;
        unit.remove();
        for(const {k,n:node} of atoms.slice(n)){const b=rest.boxes[k];if(!b.box.parentNode)rest.part.append(b.box);b.slot.append(node);}
        decor.forEach(d=>rest.part.append(d.cloneNode(true)));
        rest.part.dataset.unit=(unit.dataset.unit||'')+'-continued';
        // 余段可能落到常规字号续页：按常规字号量高，留在收紧图页时只会偏保守。
        const folio=column.closest('.folio'),density=folio.dataset.density;delete folio.dataset.density;
        column.append(rest.part);const restHeight=unitHeight(rest.part);rest.part.remove();
        if(density)folio.dataset.density=density;
        column.append(first.part);const firstHeight=unitHeight(first.part);first.part.remove();
        heights.set(first.part,firstHeight);heights.set(rest.part,restHeight);
        return [first.part,rest.part];
      };
      const placed=new Set();let queue=[];
      const flushQueue=()=>{while(queue.length)startLead(queue.shift());};
      for(let index=0;index<units.length;index++){
        let unit=units[index];
        const id=unit.dataset.sourceId,card=cards.find(c=>c.dataset.cardId===id&&!placed.has(c));
        if(card){flushQueue();placed.add(card);queue=[card];startLead(queue.shift());}
        if(!page)startReading();
        let height=heights.get(unit);
        // 图下栏放不下首块：先按原字号切开；切不开（单句/单行过高）再收紧图页一档，必要时收紧后再切。图页必须带要点。
        if(page.classList.contains('lead-folio')&&col===0&&used===0&&height>limit+1){
          const column=columnsOf(page)[0];
          let parts=splitToFit(unit,column,limit);
          if(!parts){
            page.dataset.density='snug';
            column.append(unit);const snugHeight=unitHeight(unit);unit.remove();
            if(snugHeight<=limit+1){heights.set(unit,snugHeight);height=snugHeight;}
            else parts=splitToFit(unit,column,limit);
            if(!parts&&snugHeight>limit+1)delete page.dataset.density;
          }
          if(parts){units.splice(index,1,...parts);unit=parts[0];height=heights.get(unit);}
        }
        if(height>capacity+1)throw new Error('单个内容块超过一页，请拆分长表或长段落后再导出');
        // 顺序填栏：先填满左栏再右栏，再开续页；不把少量内容均摊成两半空栏。
        const fits=()=>used===0?height<=limit+1:used+height<=limit;
        while(!fits()){
          if(col===0){col=1;used=0;continue;}
          if(queue.length)startLead(queue.shift());else startReading();
        }
        columnsOf(page)[col].append(unit);used+=height;
      }
      flushQueue();
      for(const card of cards)if(!placed.has(card)){placed.add(card);place(card);const img=card.querySelector('.main-card img');if(img)sizeImage(img,fullWidthOf(img));pages.push(card);}
      // 每段末页把两栏高度平衡，避免一栏写满、另一栏全空。
      const balance=folio=>{
        const [left,right]=columnsOf(folio);if(!right)return;
        const all=[...left.children,...right.children];if(all.length<2)return;const h=all.map(u=>heights.get(u)||u.offsetHeight+16);
        const max=left.clientHeight;let best=all.length,bestCost=Infinity;
        for(let k=1;k<all.length;k++){const a=h.slice(0,k).reduce((x,y)=>x+y,0),b=h.slice(k).reduce((x,y)=>x+y,0);if(a>max||b>max)continue;const cost=Math.max(a,b);if(cost<bestCost){bestCost=cost;best=k;}}
        if(best<all.length){all.slice(0,best).forEach(u=>left.append(u));all.slice(best).forEach(u=>right.append(u));}
      };
      const ordered=[...host.querySelectorAll('.folio')];
      ordered.forEach((folio,i)=>{const next=ordered[i+1];if(!next||next.classList.contains('lead-folio'))balance(folio);});
      // 顺序填栏已是保序下最省栏的排法；章末续页只剩少量块时（≤35%栏高），保序无法再收回，依次尝试：
      // A 原字号把这几块接到本章前页仍有余白的栏末（同章内，轻微换序）；
      // C 把本章图等比例缩小（站长 2026-11-12，宽度不低于版心 × KNOWLEDGE_BOOKLET_IMAGE_MIN_WIDTH_RATIO），图下栏变高后按原顺序重排；
      // B 本章各页收紧一档字号（图保持满幅）后按原顺序重排；D 缩图＋收紧字号。剩余块再按 A 补位。都放不下才保留续页，图恢复满幅。
      // 图下要点栏高度随内容伸缩（会挤压配图），不能用 scrollHeight 判断；一律按建页时量得的栏高核对块高之和。
      const columnsFit=folio=>{const max=Number(folio.dataset.columnLimit);return max>0&&columnsOf(folio).every(c=>columnUsed(c)<=max+1);};
      const fillGap=(chain,list)=>{
        // 从离原位置最近的栏往前找余白，放得下就接在栏末。
        const slots=chain.slice().reverse().flatMap(f=>columnsOf(f).reverse().map(c=>[f,c]));
        for(const unit of list){
          const slot=slots.find(([f,c])=>{c.append(unit);const ok=columnUsed(c)<=Number(f.dataset.columnLimit)+1;if(!ok)unit.remove();return ok;});
          if(!slot)return false;
        }
        return true;
      };
      const refill=(chain,list)=>{
        let i=0;
        for(const folio of chain)for(const column of columnsOf(folio)){
          const max=Number(folio.dataset.columnLimit);
          while(i<list.length){column.append(list[i]);if(columnUsed(column)<=max+1){i++;continue;}list[i].remove();break;}
        }
        return list.slice(i);
      };
      for(const tail of [...host.querySelectorAll('.reading-continuation')]){
        const next=tail.nextElementSibling;
        if(next&&!next.classList.contains('lead-folio'))continue;
        const chain=[];for(let f=tail.previousElementSibling;f;f=f.previousElementSibling){chain.unshift(f);if(!f.classList.contains('reading-continuation'))break;}
        if(!chain.length)continue;
        const tailUnits=columnsOf(tail).flatMap(c=>[...c.children]);
        if(!tailUnits.length)continue;
        const tailUsed=Math.max(...columnsOf(tail).map(c=>[...c.children].reduce((n,u)=>n+(heights.get(u)||unitHeight(u)),0)));
        // 站长 2026-11-13：每页的图按正文多少等比例缩放来吃留白——只要有续页就先试缩图收回；换序补位与收紧字号仍只在续页很少（≤35% 栏高）时用。
        const small=tailUsed<=capacity*0.35;
        const home=new Map([...chain,tail].flatMap(f=>columnsOf(f).flatMap(c=>[...c.children])).map(u=>[u,u.parentElement]));
        const density=new Map(chain.map(f=>[f,f.dataset.density]));
        const lead=chain[0].classList.contains('lead-folio')?chain[0]:null,img=lead&&lead.querySelector('.main-card img');
        const fullWidth=img?Number(img.dataset.displayWidth)||fullWidthOf(img):0,leadLimit=lead?lead.dataset.columnLimit:'';
        const setWidth=width=>{if(!img)return;sizeImage(img,width);lead.dataset.columnLimit=String(columnsOf(lead)[0].clientHeight);};
        const restore=()=>{for(const f of chain){const d=density.get(f);if(d)f.dataset.density=d;else delete f.dataset.density;}for(const [u,parent] of home)parent.append(u);if(img){sizeImage(img,fullWidth);lead.dataset.columnLimit=leadLimit;}};
        const relayout=(width,snug)=>{
          restore();if(width)setWidth(width);
          if(snug)for(const f of chain)f.dataset.density='snug';
          const all=[...home.keys()];all.forEach(u=>u.remove());
          return fillGap(chain,refill(chain,all))&&chain.every(columnsFit);
        };
        // 缩图候选：按续页内容估算的最小缩幅，再试下限；只取「比满幅小、不低于下限」的宽度。
        const widths=[];
        if(img){
          const min=minWidthOf(lead,img),h=img.getBoundingClientRect().height||1;
          const tailSum=columnsOf(tail).reduce((n,c)=>n+[...c.children].reduce((m,u)=>m+(heights.get(u)||unitHeight(u)),0),0);
          for(const w of [fullWidth*(1-tailSum/(2*h)),min])if(w>=min-0.5&&w<fullWidth-1&&!widths.some(x=>Math.abs(x-w)<1))widths.push(Math.max(min,w));
        }
        if(!small&&!widths.length)continue;
        let done=false;
        for(const w of widths){if(done)break;done=relayout(w,false);}
        if(!done&&small){restore();done=fillGap(chain,tailUnits)&&chain.every(columnsFit);}
        if(!done&&small)done=relayout(0,true);
        if(small)for(const w of widths){if(done)break;done=relayout(w,true);}
        if(done&&chain.every(columnsFit)){readingPages.splice(readingPages.indexOf(tail),1);pages.splice(pages.indexOf(tail),1);tail.remove();}
        else restore();
      }
      // 图文同页要点偏少时放大字号与行距（不改内容），仍放不下则还原；避免图下大片空白。
      for(const card of cards){
        if(card.parentElement!==host)continue;
        const columns=columnsOf(card),next=card.nextElementSibling;
        if(next&&next.classList.contains('reading-folio')&&!next.classList.contains('lead-folio'))continue;
        if(card.dataset.density)continue;
        const used=Math.max(...columns.map(c=>[...c.children].reduce((n,u)=>n+u.offsetHeight+16,0)));
        const room=columns[0].clientHeight;
        if(!used||used>room*0.62)continue;
        for(const level of ['roomy','airy']){
          card.dataset.density=level;
          if(columns.some(c=>c.scrollHeight>c.clientHeight+2)){delete card.dataset.density;break;}
          const now=Math.max(...columns.map(c=>[...c.children].reduce((n,u)=>n+u.offsetHeight+16,0)));
          if(now>room*0.62)break;
        }
        if(card.dataset.density){balance(card);if(columns.some(c=>c.scrollHeight>c.clientHeight+2)){delete card.dataset.density;balance(card);}}
      }
      for(const reading of [...readingPages])if(!reading.querySelector('.reading-unit')){readingPages.splice(readingPages.indexOf(reading),1);reading.remove();}
      // 留白补位（用户 2026-11-11：每页留白 ≤ 版心 1/3）。章内后续内容已由顺序填栏、章末回收、字号档提上来；
      // 仍有明显空栏时按序补：章末页放「下篇预告」（下一章标题，不放图片；站长 2026-11-12 去掉裁切条），其余用主题纹样框。
      // 留白 = 各栏未用高度×栏宽之和 ÷ 版心面积；补白块绝对定位在栏区，不进栏、不改正文顺序与页数。
      const metrics=[];
      const inner=folio=>{const cs=getComputedStyle(folio);return (folio.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight))*(folio.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom));};
      const chapterEnd=new Map();
      for(const folio of host.querySelectorAll('.folio')){const ids=new Set([folio.dataset.cardId,...[...folio.querySelectorAll('.reading-unit')].map(u=>u.dataset.sourceId)].filter(Boolean));for(const id of ids)chapterEnd.set(id,folio);}
      const panel=(cls,top,left,width,height,html)=>{const el=document.createElement('div');el.className='page-filler '+cls;el.style.cssText='top:'+top+'px;left:'+left+'px;width:'+width+'px;height:'+height+'px';el.innerHTML=html;return el;};
      const ornamentPanel=(top,left,width,height,label)=>panel('filler-ornament',top,left,width,height,'<div class="filler-motif">'+ornamentSvg+'</div>'+(label?'<p class="filler-label">'+label+'</p>':''));
      for(const folio of host.querySelectorAll('.folio')){
        const box=folio.querySelector('.reading-columns'),cols=columnsOf(folio);
        if(!box||!cols.length){metrics.push({raw:0,whitespace:0});continue;}
        const max=Number(folio.dataset.columnLimit)||cols[0].clientHeight,area=inner(folio);
        const free=cols.map(c=>Math.max(0,max-columnUsed(c)));
        const raw=free.reduce((n,f,i)=>n+f*cols[i].clientWidth,0)/area;
        let covered=0;
        if(raw>FILL){
          const top0=cols[0].offsetTop,left=cols[0].offsetLeft,right=cols.at(-1).offsetLeft+cols.at(-1).offsetWidth,gap=Math.min(...free);
          const endOf=[...chapterEnd].filter(([,f])=>f===folio).map(([id])=>id);
          const source=endOf.map(id=>nextMap.get(id)).find(Boolean);
          if(gap>=120){
            let top=top0+max-gap+6,height=gap-12;
            if(source&&source.dataset.end!=='true'&&height>=150){
              // 下篇预告：纹样框在上、标题行在下（不放任何图片）。
              const head=124,blockHeight=head;
              if(height-blockHeight>=120){box.append(ornamentPanel(top,left,right-left,height-blockHeight-12,''));top+=height-blockHeight;}
              box.append(panel('next-preview',top,left,right-left,blockHeight,'<p class="next-eyebrow">下篇预告 <b>'+source.dataset.no+'</b></p><h4>'+source.dataset.headline.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c])+'</h4>'));
            }else box.append(ornamentPanel(top,left,right-left,height,source&&source.dataset.end==='true'?'全书完':''));
            covered+=gap*cols.reduce((n,c)=>n+c.clientWidth,0);
          }
          cols.forEach((c,i)=>{const extra=free[i]-(gap>=120?gap:0);if(extra>=120){box.append(ornamentPanel(c.offsetTop+columnUsed(c)+6,c.offsetLeft,c.offsetWidth,extra-12,''));covered+=extra*c.clientWidth;}});
        }
        const whitespace=Math.max(0,raw-covered/area);
        folio.dataset.whitespace=whitespace.toFixed(4);folio.dataset.rawWhitespace=raw.toFixed(4);
        metrics.push({raw:Number(raw.toFixed(4)),whitespace:Number(whitespace.toFixed(4))});
      }
      for(const reading of readingPages){
        const ids=[...new Set([...reading.querySelectorAll('[data-source-id]')].map(el=>el.dataset.sourceId))];
        reading.dataset.focus=reading.querySelector('.unit-heading h3')?.textContent || reading.querySelector('[data-source-headline]')?.dataset.sourceHeadline || '';
        reading.querySelector('.reading-subtitle').textContent=cards.filter(c=>ids.includes(c.dataset.cardId)).map(c=>c.dataset.focus).join(' · ');
      }
      const folios=[...root.querySelectorAll('#reading-pages .folio')];
      const allFolios=[...document.querySelectorAll('[data-booklet-root] #reading-pages .folio')];
      const offset=Number(document.body.dataset.bookletPageOffset||0),totalPages=Number(document.body.dataset.bookletTotalPages||allFolios.length);
      allFolios.forEach((el,i)=>{
        const focus=el.dataset.focus || '',bookTitle=el.closest('[data-booklet-root]').dataset.bookTitle || '';
        const title=offset+i===0?bookTitle:focus;
        el.querySelector('.page-number').textContent=String(offset+i+1).padStart(2,'0')+' / '+String(totalPages).padStart(2,'0');
        el.querySelector('.running span').textContent=title;
        el.querySelector('footer span').textContent=focus;
        const heading=el.querySelector('.reading-title h2');if(heading)heading.textContent=title;
      });
      // 版面审查测量（只读，不改排版）：逐页记录溢出、标题裁切、补白块压字、坏图、裁切图（跨页半张/局部条，新版式应为 0）与整图尺寸，供 auditKnowledgeBookletLayout 判定。
      const hit=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
      const layout=folios.map((el,i)=>{
        const covers=[...el.querySelectorAll('.page-filler')],texts=[...el.querySelectorAll('.reading-unit h3,.reading-unit p,.reading-unit li,.reading-unit table,.reading-title h2')];
        const overlaps=[];for(const c of covers){const r=c.getBoundingClientRect();for(const t of texts){if(c.contains(t))continue;if(hit(r,t.getBoundingClientRect())){overlaps.push({cover:c.classList.contains('next-preview')?'下篇预告':'补白块',target:(t.textContent||'').trim().slice(0,16)});break;}}}
        const clipped=[...el.querySelectorAll('.next-preview h4,.reading-title h2,.unit-heading h3')].filter(h=>{const box=h.closest('.page-filler,.folio').getBoundingClientRect(),r=h.getBoundingClientRect();return h.scrollHeight>h.clientHeight+2||r.bottom>box.bottom+1;}).map(h=>(h.textContent||'').trim().slice(0,24));
        const broken=[...el.querySelectorAll('img')].filter(img=>img.complete&&img.naturalWidth===0).map(img=>img.alt||img.closest('[data-card-id]')?.dataset.cardId||'图片');
        const images=[...el.querySelectorAll('.main-card img')].filter(img=>img.naturalWidth>0).map(img=>{const r=img.getBoundingClientRect(),card=img.closest('.main-card').getBoundingClientRect();return {width:Number(r.width.toFixed(2)),height:Number(r.height.toFixed(2)),naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,fullWidth:Number(fullWidthOf(img).toFixed(2)),minWidth:Number(minWidthOf(el,img).toFixed(2)),contentWidth:Number(innerWidth(el).toFixed(2)),inside:r.left>=card.left-1&&r.right<=card.right+1&&r.top>=card.top-1&&r.bottom<=card.bottom+1};});
        const croppedImages=el.querySelectorAll('.spread-card img,.preview-strip img,.next-preview img').length;
        return {page:offset+i+1,images,croppedImages,whitespace:Number(el.dataset.whitespace||0),overflow:[...el.querySelectorAll('.reading-column')].some(c=>c.scrollHeight>c.clientHeight+2),clippedHeadings:clipped,overlaps,brokenImages:broken,spreadHalves:{a:el.querySelectorAll('.spread-a').length,b:el.querySelectorAll('.spread-b').length}};
      });
      if([...root.querySelectorAll('.reading-column')].some(el=>el.scrollHeight>el.clientHeight+2))throw new Error('正文超出页面，未裁切内容，请调整版式');
      root.dataset.ready='true';
      // imageModes/spreadChapters 保留给旧读取方：新版式一律 inline、跨页 0。
      const imageModes=Object.fromEntries(cards.map(c=>[c.dataset.cardId,'inline']));
      root.__knowledgeBooklet={ready:true,layout,imagePages:cards.length,readingPages:readingPages.length,pages:folios.length,units:units.length,columnCapacity:capacity,overflow:false,imageModes,spreadChapters:0,imageWidths:Object.fromEntries(cards.map(c=>[c.dataset.cardId,Number(c.querySelector('.main-card img')?.dataset.displayWidth||0)])),whitespace:metrics.map(m=>m.whitespace),rawWhitespace:metrics.map(m=>m.raw),maxWhitespace:Math.max(0,...metrics.map(m=>m.whitespace)),pendingContent:${JSON.stringify(input.pages.filter(p=>!hasKnowledgeBody(p.body)).map(p=>({id:p.id,headline:p.headline})))}};
      window.__knowledgeBooklet=root.__knowledgeBooklet;
    };
    root.__layoutBooklet=()=>busy=busy.catch(()=>{}).then(layout).catch(e=>{
      root.dataset.ready='error';root.__knowledgeBooklet={ready:false,error:e.message};window.__knowledgeBooklet=root.__knowledgeBooklet;
      let alert=root.querySelector('.layout-error');if(!alert){alert=document.createElement('p');alert.className='layout-error';root.prepend(alert);}alert.textContent=e.message;throw e;
    });
    root.__layoutBooklet().catch(()=>{});
  })();`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.title)}</title><style>
.theme-${theme}{--paper:${style.paper};--ink:${style.ink};--accent:${style.accent};--line:${style.line};--white:#fffdf8;color:var(--ink);font-family:"PingFang SC","Noto Sans CJK SC",sans-serif}*{box-sizing:border-box}body{margin:0;background:#dcded4;color:var(--ink);font-family:"PingFang SC","Noto Sans CJK SC",sans-serif} .folio{position:relative;width:1600px;height:2240px;margin:28px auto;padding:38px 62px 30px;background:var(--paper);border:1px solid var(--line);outline:1px solid var(--line);outline-offset:-13px;box-shadow:0 12px 48px #29372b15;display:flex;flex-direction:column}.folio::after{content:"";position:absolute;inset:0;z-index:9;pointer-events:none;background-repeat:repeat;background-position:center;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='620' height='400'><text x='310' y='200' text-anchor='middle' font-family='Arial,Helvetica,sans-serif' font-size='44' font-weight='700' fill='%23000000' fill-opacity='0.065' transform='rotate(-28 310 200)'>${KNOWLEDGE_BOOKLET_WATERMARK}</text></svg>")}.folio:before{content:"";position:absolute;inset:5px;border:5px solid transparent;border-image:repeating-linear-gradient(45deg,var(--line) 0 1px,transparent 1px 8px) 5;pointer-events:none}.running{height:35px;flex:none;display:flex;gap:24px;align-items:center;justify-content:space-between;border-bottom:3px double var(--line);font-size:12px;letter-spacing:2px;color:var(--accent)}.running span:first-child{margin-right:auto}.running b{font-family:Georgia,serif;font-size:21px;font-weight:400}.eyebrow{font-size:12px;letter-spacing:3px;color:var(--accent);margin:0 0 10px}.eyebrow span{opacity:.4;margin:0 8px}.image-title{display:flex;align-items:center;justify-content:space-between;gap:30px;margin:24px 0 20px;min-height:92px}.image-title h1{font:700 40px/1.3 "Kaiti SC","STKaiti","Songti SC",serif;letter-spacing:3px;margin:0;text-shadow:1px 1px var(--white)}.seal{display:grid;place-items:center;width:58px;height:58px;flex:none;border:3px double var(--accent);color:var(--accent);font:28px "Songti SC",serif;border-radius:4px;transform:rotate(-3deg)}.main-card{height:auto;flex:none;margin:0;padding:10px;border:3px double var(--line);background:color-mix(in srgb,var(--paper) 45%,var(--white));box-shadow:5px 5px 0 color-mix(in srgb,var(--line) 18%,transparent);display:flex;align-items:center;justify-content:center}.main-card img{display:block;width:100%!important;height:auto!important;max-height:900px!important;object-fit:contain!important}.image-caption{display:flex;align-items:center;gap:18px;flex:1;min-height:68px;position:relative}.caption-index{font:40px/1 Georgia,serif;color:var(--accent);opacity:.65}.image-caption p{font:18px "Songti SC",serif;margin:0;line-height:1.7}.image-caption p span{font:12px sans-serif;display:block;color:var(--ink);opacity:.65}.botanical{width:310px;height:88px;opacity:.27;color:var(--accent);flex:none;pointer-events:none}.image-caption .botanical{margin-left:auto}footer{height:28px;flex:none;display:flex;align-items:end;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px;font-size:11px;letter-spacing:1px;color:var(--accent)}footer i{margin:0 8px;opacity:.5}.page-number{font-family:Georgia,serif;letter-spacing:2px}.reading-folio{height:2240px}.reading-title{height:350px;flex:none;display:flex;justify-content:space-between;align-items:center;gap:30px;margin:12px 0 18px}.reading-title>div:first-child{max-width:840px;flex:1;min-width:0}.reading-title h2{font:700 54px "Songti SC",serif;letter-spacing:3px;margin:0 0 12px}.reading-subtitle{font-size:22.5px;line-height:1.8;margin:0;opacity:.7}.art-window{width:540px;height:340px;position:relative;flex:none;overflow:hidden;mix-blend-mode:multiply;mask-image:radial-gradient(ellipse 48% 58% at 50% 48%,#000 38%,transparent 90%)}.art-window>img{position:absolute;left:50%;top:-85px;width:1200px!important;max-width:none!important;height:675px!important;max-height:none!important;transform:translateX(-50%);object-fit:fill!important;opacity:.85}.art-window .botanical{position:absolute;bottom:0;right:0;width:420px;height:140px;opacity:.5}.theme-fusion_ink_mountains .reading-title .art-window{width:650px;filter:saturate(.25)}.theme-fusion_coastal_lighthouse .reading-title{flex-direction:row-reverse}.theme-fusion_coastal_lighthouse .reading-title>div:first-child{padding-left:35px;border-left:3px double var(--line)}.theme-fusion_glasshouse_garden .art-window{width:500px;mask-image:radial-gradient(ellipse 45% 62% at 50% 48%,#000 40%,transparent 90%)}.theme-fusion_glasshouse_garden .reading-title h2{letter-spacing:8px}.reading-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:34px;flex:none;height:1676px;margin-bottom:19px}.reading-column{height:1676px;min-width:0}.reading-unit{padding:14px 18px 15px;background:color-mix(in srgb,var(--white) 78%,var(--paper));border:3px double color-mix(in srgb,var(--line) 80%,transparent);margin-bottom:16px;border-radius:4px;break-inside:avoid}.unit-heading{display:flex;gap:10px;align-items:center;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid var(--line)}.unit-heading>span{display:grid;place-items:center;flex:none;width:26px;height:26px;border:1px solid var(--line);border-radius:50%;font:13px Georgia,serif;color:var(--accent)}.unit-heading h3{font:700 28.5px/1.4 "Songti SC",serif;letter-spacing:1px;margin:0}.reading-unit p{font-size:24px;line-height:1.75;margin:0}.reading-unit p+p{margin-top:8px}.reading-unit ul,.reading-unit ol{padding-left:21px;margin:0;font-size:24px;line-height:1.7}.list-unit ul{columns:2;column-gap:26px}.reading-unit li{break-inside:avoid;padding:2px 0}.reading-unit strong{color:var(--accent)}.reading-unit table{width:100%;border-collapse:collapse;font-size:22.5px;line-height:1.6}.reading-unit th{background:var(--ink);color:var(--white);font-weight:500;text-align:left;padding:7px 10px}.reading-unit td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}.reading-unit td p,.reading-unit th p{font-size:22.5px;line-height:1.6;margin:0}.reading-unit tr:nth-child(even) td{background:color-mix(in srgb,var(--paper) 65%,var(--white))}.reading-unit tbody tr:last-child td{border-bottom:0}.reading-unit blockquote{margin:0;padding:8px 14px;border-left:2px solid var(--accent)}.reading-unit img{max-width:100%}.prose-unit{background:color-mix(in srgb,var(--paper) 45%,var(--white))}.layout-error{background:#fff;color:#a32424;padding:20px;text-align:center}.staging{position:absolute;left:-10000px;top:0;width:720px;visibility:hidden}
.theme-fusion_ink_mountains .folio{background:linear-gradient(155deg,#fff7 0%,transparent 35%),var(--paper)}.theme-fusion_ink_mountains .seal{border-radius:50%;color:#925f45}.theme-fusion_ink_mountains .main-card{border-width:1px;padding:13px;box-shadow:0 0 0 5px var(--paper),0 0 0 6px var(--line)}.theme-fusion_coastal_lighthouse .image-title{flex-direction:row-reverse;text-align:right}.theme-fusion_coastal_lighthouse .main-card{border-radius:26px 3px 26px 3px;padding:12px}.theme-fusion_coastal_lighthouse .reading-unit{border:1px solid var(--line);border-top:3px solid var(--line);border-radius:10px 2px}.theme-fusion_glasshouse_garden .main-card{border-radius:48px 48px 5px 5px;padding:15px}.theme-fusion_glasshouse_garden .reading-unit{border-radius:16px 3px;border-width:1px;border-left:3px solid var(--line)}.theme-fusion_glasshouse_garden .seal{border-radius:50% 50% 4px 4px}.theme-fusion_maple_bridge .image-title{border-left:4px solid var(--accent);padding-left:22px}.theme-fusion_snow_monastery .main-card{box-shadow:none;border:1px solid var(--line);background:#fff9}.theme-fusion_snow_monastery .seal{transform:none}
.table-unit{position:relative;padding:24px 26px 22px;border:1px solid var(--line)!important;border-radius:14px 3px!important;background:linear-gradient(135deg,color-mix(in srgb,var(--paper) 80%,var(--white)),var(--white) 46%,color-mix(in srgb,var(--paper) 68%,var(--white)))!important;box-shadow:3px 4px 0 color-mix(in srgb,var(--line) 15%,transparent)}.table-unit:before{content:"";position:absolute;inset:7px;border:1px solid color-mix(in srgb,var(--line) 55%,transparent);border-radius:9px 1px;pointer-events:none}.table-unit:after{content:"";position:absolute;right:11px;top:11px;width:13px;height:13px;border-top:2px solid var(--accent);border-right:2px solid var(--accent);opacity:.65;pointer-events:none}.table-unit .unit-heading{border-bottom:3px double var(--line);padding-bottom:13px;margin-bottom:15px}.table-unit .unit-heading>span{background:var(--paper);border:3px double var(--line);width:31px;height:31px}.table-unit th,.table-unit td{min-width:calc(2em + 20px)}.table-unit th{border-bottom:3px double var(--line);letter-spacing:.5px}.table-unit tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--paper) 80%,var(--white))}.table-unit tbody tr:last-child td{border-bottom:1px solid var(--line)}

/* 史记导读手册的做法（站长 2026-11-13）：题签不铺底色、粗体加宽字距；卡片细线框小圆角浅阴影；小标题下只一条细线、编号是小圆徽标；
   表头深色、表格卡右上角小角标；小结条左侧细竖线；页脚单细线。主题色仍由各主题变量决定。 */
.reading-title{border-bottom:1px solid var(--line);background:none;padding:14px 0 18px;border-radius:0}.reading-title h2{border-left:0;padding-left:0;letter-spacing:6px}.reading-title .botanical{opacity:.7;stroke-width:2}.reading-unit{border:1px solid var(--line);border-radius:12px 2px 12px 2px;overflow:hidden;box-shadow:2px 3px 0 color-mix(in srgb,var(--line) 14%,transparent)}.unit-heading{background:none;color:var(--ink);border:0;border-bottom:1px solid var(--line)}.unit-heading h3{color:var(--ink)}.unit-heading>span{background:var(--paper);color:var(--accent);border:1px solid var(--line);border-radius:50%}.table-unit th{background:var(--ink);color:var(--white);border-bottom:0}.table-unit th p{color:var(--white)}.prose-unit blockquote{border-left:3px solid var(--accent);background:none;padding:10px 18px}.reading-folio footer{border-top:1px solid var(--line)}

/* 直式图文同页：图在上，本章要点两栏在下，余下高度全部给要点。 */
.lead-folio .image-title{margin:18px 0 18px;min-height:0}.lead-folio .image-title h1{font-size:46px}.lead-folio .eyebrow .chapter-no{display:inline-grid;place-items:center;width:34px;height:34px;margin-right:12px;border:3px double var(--accent);border-radius:50%;font:15px/1 Georgia,serif;letter-spacing:0;color:var(--accent)}.image-title .content-motif,.image-title .botanical{width:260px!important;height:120px!important;flex:none;opacity:.6;color:var(--accent)}.reading-title .botanical{width:300px;height:110px;flex:none}.lead-columns{flex:1 1 auto!important;height:auto!important;min-height:0;margin:26px 0 19px!important}.lead-columns .reading-column{height:100%!important}
.lead-columns{position:relative}.folio[data-density=snug] .reading-unit p,.folio[data-density=snug] .reading-unit li{font-size:22px!important;line-height:1.66!important}.folio[data-density=snug] .unit-heading h3{font-size:26px!important}.folio[data-density=snug] .reading-unit{padding:12px 16px 13px!important;margin-bottom:12px!important}.folio[data-density=snug] .reading-unit td,.folio[data-density=snug] .reading-unit td p,.folio[data-density=snug] .reading-unit th p{font-size:21px!important}.lead-folio[data-density=roomy] .reading-unit p,.lead-folio[data-density=roomy] .reading-unit li{font-size:26px!important;line-height:1.95!important}.lead-folio[data-density=roomy] .unit-heading h3{font-size:31px!important}.lead-folio[data-density=airy] .reading-unit p,.lead-folio[data-density=airy] .reading-unit li{font-size:28px!important;line-height:2.05!important}.lead-folio[data-density=airy] .unit-heading h3{font-size:33px!important}.lead-folio:is([data-density=roomy],[data-density=airy]) .reading-unit{padding:22px 28px 24px!important;margin-bottom:22px}
/* 页尾补白：下篇预告与纹样框绝对定位在栏区，不进栏、不改正文。 */
.reading-columns{position:relative}.page-filler{position:absolute;box-sizing:border-box;border:3px double var(--line);border-radius:14px 0 14px 0;overflow:hidden;pointer-events:none}.filler-ornament{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--line) 16%,transparent) 0 1px,transparent 1px 14px),color-mix(in srgb,var(--paper) 70%,var(--white))}.filler-motif{width:min(86%,1100px);height:min(72%,340px);display:flex;align-items:center;justify-content:center;color:var(--accent);opacity:.7}.filler-motif svg{width:100%!important;height:100%!important;opacity:1!important;stroke-width:2.2}.filler-ornament:before{content:"";position:absolute;inset:10px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:9px 0 9px 0}.filler-label{margin:0;font:700 30px "Songti SC",serif;letter-spacing:12px;color:var(--accent)}.next-preview{display:flex;flex-direction:column;background:color-mix(in srgb,var(--paper) 55%,var(--white));border-color:var(--accent)}.next-eyebrow{flex:none;margin:14px 22px 2px;font-size:15px;letter-spacing:4px;color:var(--accent)}.next-eyebrow b{font:20px Georgia,serif;margin-left:8px}.next-preview h4{flex:none;margin:0 22px 12px;font:700 32px/1.3 "Songti SC",serif;letter-spacing:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${knowledgeDecorationCss(decoration)}
${design?knowledgeContentDesignCss(design):""}
@media screen and (max-width:1656px){[data-ready="true"] .folio{zoom:calc((100vw - 32px) / 1600px)}}
@page{size:1600px 2240px;margin:0}@page reading{size:1600px 2240px;margin:0}.reading-folio{page:reading}@media print{[data-booklet-root]+[data-booklet-root]{break-before:page}html,body{margin:0;background:var(--paper);print-color-adjust:exact;-webkit-print-color-adjust:exact}.folio{margin:0;zoom:1!important;box-shadow:none;break-after:page;break-inside:avoid}.folio:last-child{break-after:auto}.layout-error{display:block}.staging{display:none}}
</style></head><body data-booklet-root data-image-mode="inline" data-book-title="${escape(input.title)}" class="theme-${theme}" data-decoration="${decorationClass}"${designAttribute} data-booklet-version="${KNOWLEDGE_BOOKLET_VERSION}">${images}<div class="image-variants" style="display:none">${previews}</div><template id="filler-ornament">${fillerOrnament}</template>${artwork ? `<img class="decoration-resource" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none" alt="" src="${artwork}">` : ""}<div id="reading-pages"></div><template id="reading-template"><article class="folio reading-folio">${run("正文阅读","文")}${readingHeader}<div class="reading-columns"><div class="reading-column"></div><div class="reading-column"></div></div>${foot("图文对照 · 正文阅读")}</article></template><div id="reading-source" class="staging">${units.map(u=>u.html).join("")}</div><script>${pagination}</script></body></html>`;
  if (!input.fragment) return html;
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1];
  const content = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  return `<section data-booklet-root data-image-mode="inline" data-book-title="${escape(input.title)}" class="theme-${theme}" data-decoration="${decorationClass}"${designAttribute} data-booklet-version="${KNOWLEDGE_BOOKLET_VERSION}"><style>${css}</style>${content}</section>`;
}
